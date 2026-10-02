/**
 * Flow definition extraction from a Postman collection.
 *
 * Flows live in the "Flows/" folder of the collection. Each flow is a leaf
 * request (not a sub-folder) whose pre-request script calls:
 *
 *   steps(['Step One', 'Step Two', ...]);
 *
 * A step can also be an object, to run the same request with different
 * variables — a different user, a different expected status:
 *
 *   steps(['Admin login', { step: 'View Item', vars: { actor: 'member' } }]);
 *
 * The steps array is captured by running the script in a Node.js vm context.
 *
 * SECURITY NOTE: vm.runInNewContext() is NOT a security sandbox — it cannot
 * fully isolate untrusted code. This implementation adds a pre-flight check
 * for the most common escape patterns and a hard timeout, but is intended
 * only for collections you control or trust. Do not run collections from
 * untrusted sources.
 */

import * as vm from 'vm';
import { findFolder } from './collection.js';
import type { FlowDef, FlowStep, PostmanCollection, PostmanItem, StepVarValue } from './types.js';

// ---------------------------------------------------------------------------
// Sandbox helpers
// ---------------------------------------------------------------------------

/**
 * Identifiers that indicate an attempt to escape the vm context.
 * Checked against the script source after stripping string literals, so that
 * step names containing these words (e.g. "Create prototype") are allowed.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\bconstructor\b/,
  /\b__proto__\b/,
  /\bprototype\b/,
  /\bprocess\b/,
  /\brequire\b/,
  /\bglobal\b/,
  /\bFunction\b/,
  /\beval\b/,
];

const VM_TIMEOUT_MS = 1000;

/** Replace quoted string literals with empty placeholders to avoid false-positive pattern matches on step names. */
function stripStringLiterals(src: string): string {
  return src.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Throw if the script source references a forbidden identifier outside a string literal. */
function assertSafeSrc(flowName: string, src: string): void {
  const stripped = stripStringLiterals(src);
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(stripped)) {
      throw new Error(
        `Pre-request script in "${flowName}" references a forbidden identifier ` +
          `(matched: ${pattern.source}). Only steps([...]) calls are permitted in flow scripts.`,
      );
    }
  }
}

/** A variable name usable as `{{name}}` and with `pm.variables.get()`. */
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Turn one element of the steps() array into a FlowStep, or throw.
 * Objects come from the vm context, so they are copied rather than kept.
 */
function parseStep(s: unknown, i: number): FlowStep {
  if (typeof s === 'string') {
    if (s === '') {
      throw new Error(`steps() array must not contain empty strings (empty string at index ${i})`);
    }
    return { step: s };
  }

  if (typeof s !== 'object' || s === null || Array.isArray(s)) {
    throw new Error(
      `steps() array must contain only strings or { step, vars } objects (index ${i} has type ${s === null ? 'null' : Array.isArray(s) ? 'array' : typeof s})`,
    );
  }

  const obj = s as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((k) => k !== 'step' && k !== 'vars');
  if (unknownKeys.length > 0) {
    throw new Error(
      `steps() object at index ${i} has unknown key(s): ${unknownKeys.join(', ')} — only "step" and "vars" are allowed`,
    );
  }
  if (typeof obj.step !== 'string' || obj.step === '') {
    throw new Error(`steps() object at index ${i} needs a non-empty "step" string`);
  }
  if (obj.vars === undefined) return { step: obj.step };

  if (typeof obj.vars !== 'object' || obj.vars === null || Array.isArray(obj.vars)) {
    throw new Error(`steps() object at index ${i}: "vars" must be an object`);
  }
  const vars: Record<string, StepVarValue> = {};
  for (const [key, value] of Object.entries(obj.vars as Record<string, unknown>)) {
    if (!VAR_NAME.test(key)) {
      throw new Error(`steps() object at index ${i}: "${key}" is not a valid variable name`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(
        `steps() object at index ${i}: vars.${key} must be a string, number or boolean`,
      );
    }
    vars[key] = value;
  }
  return Object.keys(vars).length > 0 ? { step: obj.step, vars } : { step: obj.step };
}

/**
 * Run a flow pre-request script in a vm context and return the captured steps.
 *
 * Applies:
 *   - Pre-flight check for dangerous identifiers
 *   - 1-second hard timeout (prevents infinite loops)
 *   - Runtime validation that steps() receives a non-empty array of step
 *     names or { step, vars } objects
 *
 * Throws a descriptive Error on any violation.
 *
 * @internal — exported for use by validate.ts; not part of the public API.
 */
export function runSandboxed(flowName: string, scriptSrc: string): FlowStep[] {
  assertSafeSrc(flowName, scriptSrc);

  let capturedSteps: FlowStep[] | null = null;

  try {
    vm.runInNewContext(
      scriptSrc,
      {
        steps: (stepsArray: unknown) => {
          if (!Array.isArray(stepsArray)) {
            throw new Error('steps() argument must be an array');
          }
          capturedSteps = stepsArray.map(parseStep);
        },
      },
      { timeout: VM_TIMEOUT_MS },
    );
  } catch (e) {
    throw new Error(
      `Failed to evaluate pre-request script in "${flowName}": ${(e as Error).message}`,
    );
  }

  if (!capturedSteps || (capturedSteps as FlowStep[]).length === 0) {
    throw new Error(`No valid steps() call found in pre-request script of "${flowName}".`);
  }

  return capturedSteps;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Return all flow requests from the Flows/ folder.
 * Sub-folders inside Flows/ are skipped — only leaf items (requests) count.
 */
export function listFlows(collection: PostmanCollection): PostmanItem[] {
  const folder = findFolder(collection.item, 'Flows');
  if (!folder) {
    throw new Error('"Flows" folder not found in collection.');
  }
  return (folder.item ?? []).filter((r) => !r.item);
}

/**
 * Extract the steps from a flow request's pre-request script.
 * Throws if the script is missing, invalid, or does not call steps().
 */
export function extractFlowDef(flowReq: PostmanItem): FlowDef {
  const preReq = flowReq.event?.find((e) => e.listen === 'prerequest');
  if (!preReq?.script?.exec?.length) {
    throw new Error(`No pre-request script found in flow "${flowReq.name}".`);
  }

  const scriptSrc = preReq.script.exec.join('\n');
  const stepDefs = runSandboxed(flowReq.name, scriptSrc);
  return { name: flowReq.name, steps: stepDefs.map((s) => s.step), stepDefs };
}

/**
 * Find a flow request by name in the Flows/ folder.
 * Throws with available flow names if not found.
 */
export function findFlowRequest(collection: PostmanCollection, flowName: string): PostmanItem {
  const flowRequests = listFlows(collection);
  const flowReq = flowRequests.find((r) => r.name === flowName);
  if (!flowReq) {
    const available = flowRequests.map((r) => r.name).join(', ');
    throw new Error(`Flow "${flowName}" not found.\nAvailable flows: ${available}`);
  }
  return flowReq;
}
