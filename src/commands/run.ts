/**
 * Run command — assembles a temporary flat collection for a flow and passes
 * it to newman.run().
 *
 * The temporary collection is built in memory and never written to disk.
 * It contains only the requests belonging to the flow, in the declared order,
 * and strips any collection-level scripts that reference `_flow_steps` (a
 * routing helper that is unnecessary when running a flat sequence).
 *
 * Reporter configuration is passed straight through to newman.run() — this
 * package does not add or default any reporters beyond Newman's own defaults.
 */

import newman, { type NewmanRunOptions } from 'newman';
import {
  findRequest,
  loadCollection,
  resolveCollectionPath,
  resolveEnvironmentPath,
} from '../lib/collection.js';
import { extractFlowDef, findFlowRequest, listFlows } from '../lib/flows.js';
import type {
  FlowDef,
  FlowStep,
  PostmanCollection,
  PostmanEvent,
  PostmanItem,
  RunOptions,
  StepVarValue,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The name a step runs and reports under: `View Item [actor=member]`. */
export function stepLabel(step: FlowStep): string {
  if (!step.vars) return step.step;
  const pairs = Object.entries(step.vars).map(([k, v]) => `${k}=${v}`);
  return `${step.step} [${pairs.join(', ')}]`;
}

/** Where a step's variables park the values they replaced, until the next step. */
const SAVED_VAR = '__newman_flows_saved';

/**
 * Put back whatever the previous step's variables replaced: unset each one,
 * and set it again only if it held something the unset did not reveal —
 * a value from a lower scope (environment, globals) comes back by itself.
 */
const RESTORE_SCRIPT = [
  "// newman-flows: restore what the previous step's variables replaced.",
  `const saved = pm.variables.get('${SAVED_VAR}');`,
  'if (saved !== undefined) {',
  `  pm.variables.unset('${SAVED_VAR}');`,
  '  for (const [key, prev] of Object.entries(JSON.parse(saved))) {',
  '    pm.variables.unset(key);',
  '    if (prev.had && pm.variables.get(key) !== prev.value) pm.variables.set(key, prev.value);',
  '  }',
  '}',
];

/** Record what each variable holds now, then set the step's values. */
function setScript(vars: Record<string, StepVarValue>): string[] {
  return [
    "// newman-flows: this step's variables.",
    `const vars = ${JSON.stringify(vars)};`,
    'const saved = {};',
    'for (const key of Object.keys(vars)) {',
    '  saved[key] = { had: pm.variables.has(key), value: pm.variables.get(key) };',
    '}',
    `pm.variables.set('${SAVED_VAR}', JSON.stringify(saved));`,
    'for (const [key, value] of Object.entries(vars)) pm.variables.set(key, value);',
  ];
}

function prerequest(exec: string[]): PostmanEvent {
  return { listen: 'prerequest', script: { type: 'text/javascript', exec } };
}

/**
 * Copy a request for one step, adding pre-request events ahead of its own:
 * one restoring what the previous step's variables replaced, and, when this
 * step has variables, one setting them.
 *
 * The restore runs at the start of the *next* step rather than after this
 * step's tests, because nothing after a test script is guaranteed to run — it
 * can throw, or the request can be skipped — and `pm.variables` lives for the
 * whole run, so a missed clean-up would reach every step after it. They are
 * separate events so that an error in the request's own script cannot stop them.
 */
function withStepVars(req: PostmanItem, step: FlowStep, restore: boolean): PostmanItem {
  if (!step.vars && !restore) return req;

  const item = structuredClone(req);
  const added: PostmanEvent[] = [];
  if (restore) added.push(prerequest(RESTORE_SCRIPT));
  if (step.vars) {
    added.push(prerequest(setScript(step.vars)));
    item.name = stepLabel(step);
  }
  item.event = [...added, ...(item.event ?? [])];
  return item;
}

/**
 * Build the temporary flat collection that Newman will run.
 * Exported for unit-testability.
 */
export function buildTempCollection(
  collection: PostmanCollection,
  flowDef: FlowDef,
): Record<string, unknown> {
  const stepDefs: FlowStep[] = flowDef.stepDefs ?? flowDef.steps.map((step) => ({ step }));
  const flowItems = stepDefs.map((step, i) => {
    const req = findRequest(collection.item, step.step);
    if (!req) throw new Error(`Step "${step.step}" not found in collection.`);
    // Only a step after one with variables has anything to restore.
    const restore = stepDefs.slice(0, i).some((s) => s.vars);
    return withStepVars(req, step, restore);
  });

  return {
    info: {
      ...collection.info,
      name: `${collection.info.name} — Flow: ${flowDef.name}`,
    },
    // Strip collection-level scripts that reference _flow_steps as an identifier.
    // Those are routing helpers for running the whole collection; they are
    // unnecessary (and break flow isolation) when running a flat sequence.
    // String literals are stripped first so that a pm.test() label like
    // "check _flow_steps is not set" doesn't cause a false-positive match.
    event: (collection.event ?? []).filter((e) => {
      const src = (e.script?.exec ?? []).join('\n');
      const stripped = src.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
      return !/\b_flow_steps\b/.test(stripped);
    }),
    item: flowItems,
  };
}

/** Run a single pre-resolved flow definition. */
async function runFlowDef(
  collection: PostmanCollection,
  flowDef: FlowDef,
  envPath: string | undefined,
  reporters: string | string[] | undefined,
  reporter: Record<string, unknown> | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempCollection = buildTempCollection(collection, flowDef);

    console.log(`\n▶ Running flow: ${flowDef.name}`);
    const labels = flowDef.stepDefs?.map(stepLabel) ?? flowDef.steps;
    console.log(`  Steps: ${labels.join(' → ')}\n`);

    newman.run(
      {
        collection: tempCollection as NewmanRunOptions['collection'],
        environment: envPath,
        insecure: true,
        reporters: reporters ?? 'cli',
        reporter: reporter ?? {},
      },
      (err, summary) => {
        if (err) return reject(err);
        const failed = summary.run.failures.length;
        if (failed > 0) {
          console.error(`\n❌ Flow "${flowDef.name}" had ${failed} failure(s).`);
          return reject(new Error(`${failed} failure(s)`));
        }
        console.log(`\n✅ Flow "${flowDef.name}" passed.`);
        resolve();
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single named flow from a Postman collection.
 *
 * @param opts.collection - Path to the `.postman_collection.json` file, or
 *   `undefined` to auto-discover from `<cwd>/dev/Postman/`.
 * @param opts.flow      - Exact name of the flow to run (case-sensitive).
 * @param opts.env       - Path to a `.postman_environment.json` file, or
 *   `undefined` to auto-discover / run without an environment.
 * @param opts.reporters - Newman reporters to activate (e.g. `['cli', 'junit']`).
 *   Defaults to `'cli'`.
 * @param opts.reporter  - Per-reporter options passed directly to `newman.run()`
 *   (e.g. `{ junit: { export: './results.xml' } }`).
 *
 * @throws {Error} If the collection or environment file cannot be resolved.
 * @throws {Error} If the named flow does not exist in the collection.
 * @throws {Error} If any Newman test assertion fails.
 */
export async function runFlow(opts: RunOptions & { flow: string }): Promise<void> {
  const collectionPath = resolveCollectionPath(opts.collection);
  const envPath = resolveEnvironmentPath(opts.env);
  const collection = loadCollection(collectionPath);
  const flowReq = findFlowRequest(collection, opts.flow);
  const flowDef = extractFlowDef(flowReq);
  await runFlowDef(collection, flowDef, envPath, opts.reporters, opts.reporter);
}

/**
 * Run every flow defined in the collection's `Flows/` folder, in declaration order.
 *
 * @param opts.collection - Path to the `.postman_collection.json` file, or
 *   `undefined` to auto-discover from `<cwd>/dev/Postman/`.
 * @param opts.env       - Path to a `.postman_environment.json` file, or
 *   `undefined` to auto-discover / run without an environment.
 * @param opts.reporters - Newman reporters to activate (e.g. `['cli', 'junit']`).
 *   Defaults to `'cli'`.
 * @param opts.reporter  - Per-reporter options passed directly to `newman.run()`
 *   (e.g. `{ junit: { export: './results.xml' } }`).
 *
 * @throws {Error} If the collection or environment file cannot be resolved.
 * @throws {Error} If the collection contains no flows.
 * @throws {Error} If any Newman test assertion fails (fails-fast on first failing flow).
 */
export async function runAllFlows(opts: RunOptions): Promise<void> {
  const collectionPath = resolveCollectionPath(opts.collection);
  const envPath = resolveEnvironmentPath(opts.env);
  const collection = loadCollection(collectionPath);
  const flowRequests = listFlows(collection);

  if (flowRequests.length === 0) {
    throw new Error('No flows found in collection Flows/ folder.');
  }

  for (const flowReq of flowRequests) {
    const flowDef = extractFlowDef(flowReq);
    await runFlowDef(collection, flowDef, envPath, opts.reporters, opts.reporter);
  }

  console.log('\n✅ All flows passed.');
}
