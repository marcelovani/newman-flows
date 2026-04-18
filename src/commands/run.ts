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
import type { FlowDef, PostmanCollection, RunOptions } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the temporary flat collection that Newman will run.
 * Exported for unit-testability.
 */
export function buildTempCollection(
  collection: PostmanCollection,
  flowDef: FlowDef,
): Record<string, unknown> {
  const flowItems = flowDef.steps.map((stepName) => {
    const req = findRequest(collection.item, stepName);
    if (!req) throw new Error(`Step "${stepName}" not found in collection.`);
    return req;
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
    console.log(`  Steps: ${flowDef.steps.join(' → ')}\n`);

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
