/**
 * Flow definition extraction from a Postman collection.
 *
 * Flows live in the "Flows/" folder of the collection. Each flow is a leaf
 * request (not a sub-folder) whose pre-request script calls:
 *
 *   steps(['Step One', 'Step Two', ...]);
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
import type { FlowDef, PostmanCollection, PostmanItem } from './types.js';

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

/**
 * Run a flow pre-request script in a vm context and return the captured steps.
 *
 * Applies:
 *   - Pre-flight check for dangerous identifiers
 *   - 1-second hard timeout (prevents infinite loops)
 *   - Runtime validation that steps() receives a non-empty array of non-empty strings
 *
 * Throws a descriptive Error on any violation.
 *
 * @internal — exported for use by validate.ts; not part of the public API.
 */
export function runSandboxed(flowName: string, scriptSrc: string): string[] {
  assertSafeSrc(flowName, scriptSrc);

  let capturedSteps: string[] | null = null;

  try {
    vm.runInNewContext(
      scriptSrc,
      {
        steps: (stepsArray: unknown) => {
          if (!Array.isArray(stepsArray)) {
            throw new Error('steps() argument must be an array');
          }
          for (let i = 0; i < stepsArray.length; i++) {
            const s = stepsArray[i];
            if (typeof s !== 'string') {
              throw new Error(
                `steps() array must contain only strings (index ${i} has type ${typeof s})`,
              );
            }
            if (s === '') {
              throw new Error(
                `steps() array must not contain empty strings (empty string at index ${i})`,
              );
            }
          }
          capturedSteps = stepsArray as string[];
        },
      },
      { timeout: VM_TIMEOUT_MS },
    );
  } catch (e) {
    throw new Error(
      `Failed to evaluate pre-request script in "${flowName}": ${(e as Error).message}`,
    );
  }

  if (!capturedSteps || (capturedSteps as string[]).length === 0) {
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
 * Extract the step names from a flow request's pre-request script.
 * Throws if the script is missing, invalid, or does not call steps().
 */
export function extractFlowDef(flowReq: PostmanItem): FlowDef {
  const preReq = flowReq.event?.find((e) => e.listen === 'prerequest');
  if (!preReq?.script?.exec?.length) {
    throw new Error(`No pre-request script found in flow "${flowReq.name}".`);
  }

  const scriptSrc = preReq.script.exec.join('\n');
  const steps = runSandboxed(flowReq.name, scriptSrc);
  return { name: flowReq.name, steps };
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
