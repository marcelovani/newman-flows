/**
 * Validate command — checks a Postman collection for structural issues that
 * would cause the runner to fail silently or produce wrong results.
 *
 * Checks performed:
 *   - Required info fields present (name, schema, _postman_id)
 *   - No absolute file paths in body.file.src or body.formdata[].src
 *   - All flow pre-request scripts call steps([...]) correctly (new syntax)
 *   - All step names in flow definitions resolve to a real request
 *   - No duplicate request names (causes ambiguous step resolution)
 *
 * The core validateCollection() function is pure — it returns errors,
 * warnings, and per-flow step counts without printing or exiting. The CLI
 * wrapper (printValidationResult) decides what to do with the result.
 */

import * as path from 'path';
import { findFolder } from '../lib/collection.js';
import { runSandboxed } from '../lib/flows.js';
import type { PostmanCollection, PostmanItem } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /**
   * Maps each valid flow name to its step count.
   * Used by printValidationResult() to display per-flow summaries without
   * re-running the vm sandbox a second time.
   */
  validFlows: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Pure validation logic
// ---------------------------------------------------------------------------

/**
 * Validate a loaded Postman collection for structural correctness.
 *
 * This function is pure — it never prints or exits. Callers decide what to do
 * with the result. For CLI use, pass the result to {@link printValidationResult}.
 *
 * @returns A {@link ValidationResult} with any errors, warnings, and a map of
 *   valid flow names to their step counts.
 *
 * @throws Never — all problems are reported via `errors` / `warnings` in the result.
 */
export function validateCollection(collection: PostmanCollection): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validFlows: Record<string, number> = {};

  // ── Info fields ──────────────────────────────────────────────────────────
  const info = collection.info ?? {};
  if (!info.name) errors.push('info.name is missing');
  if (!info._postman_id) errors.push('info._postman_id is missing');
  if (!info.schema) errors.push('info.schema is missing');

  // ── Collect all requests (flat) ──────────────────────────────────────────
  const allRequests: PostmanItem[] = [];
  const requestNames = new Map<string, number>();

  function collectRequests(items: PostmanItem[]): void {
    for (const item of items) {
      if (item.item) {
        collectRequests(item.item);
      } else {
        allRequests.push(item);
        requestNames.set(item.name, (requestNames.get(item.name) ?? 0) + 1);
      }
    }
  }
  collectRequests(collection.item);

  // ── Duplicate request names ───────────────────────────────────────────────
  for (const [name, count] of requestNames) {
    if (count > 1) {
      warnings.push(
        `Duplicate request name "${name}" (${count} occurrences) — flow step resolution will be ambiguous`,
      );
    }
  }

  // ── Absolute file paths ───────────────────────────────────────────────────
  for (const req of allRequests) {
    const body = req.request?.body;
    if (!body) continue;

    if (body.mode === 'file' && body.file?.src) {
      if (path.isAbsolute(body.file.src)) {
        errors.push(
          `"${req.name}": body.file.src is an absolute path: ${body.file.src} — use a relative path under dev/Postman/fixtures/`,
        );
      }
    }

    if (body.mode === 'formdata') {
      for (const field of body.formdata ?? []) {
        if (field.type === 'file' && field.src && path.isAbsolute(field.src)) {
          errors.push(
            `"${req.name}": formdata field "${field.key}" src is an absolute path: ${field.src} — use a relative path under dev/Postman/fixtures/`,
          );
        }
      }
    }
  }

  // ── Flows folder ──────────────────────────────────────────────────────────
  const flowsFolder = findFolder(collection.item, 'Flows');
  if (!flowsFolder) {
    errors.push('"Flows" folder not found in collection');
  } else {
    const flowRequests = (flowsFolder.item ?? []).filter((r) => !r.item);

    if (flowRequests.length === 0) {
      warnings.push('No flow requests found in Flows/ folder');
    }

    for (const flowReq of flowRequests) {
      const preReq = flowReq.event?.find((e) => e.listen === 'prerequest');

      if (!preReq?.script?.exec?.length) {
        errors.push(`"${flowReq.name}": missing pre-request script`);
        continue;
      }

      const scriptSrc = preReq.script.exec.join('\n');

      // Reject legacy syntax before hitting the sandbox
      if (/var\s+FLOW\s*=/.test(scriptSrc) || /\brun\s*\(/.test(scriptSrc)) {
        errors.push(
          `"${flowReq.name}": pre-request script uses legacy syntax — update to "steps([...])"`,
        );
        continue;
      }

      // Extract and validate steps via the shared hardened sandbox
      let steps: string[];
      try {
        steps = runSandboxed(flowReq.name, scriptSrc);
      } catch (e) {
        errors.push(`"${flowReq.name}": ${(e as Error).message}`);
        continue;
      }

      // Resolve each step name against the request index
      let allStepsValid = true;
      for (const step of steps) {
        if (!requestNames.has(step)) {
          errors.push(`"${flowReq.name}": step "${step}" not found in collection`);
          allStepsValid = false;
        }
      }

      // Only record as valid if all steps resolve — used by printValidationResult
      if (allStepsValid) {
        validFlows[flowReq.name] = steps.length;
      }
    }
  }

  return { errors, warnings, validFlows };
}

// ---------------------------------------------------------------------------
// Console output helper (used by CLI)
// ---------------------------------------------------------------------------

/**
 * Print the validation result to stdout/stderr.
 * Uses pre-computed step counts from the ValidationResult — does not re-run
 * the vm sandbox.
 * Returns true if the collection is valid (no errors), false otherwise.
 */
export function printValidationResult(result: ValidationResult): boolean {
  for (const [name, count] of Object.entries(result.validFlows)) {
    console.log(`  ✅ Flow "${name}" — ${count} steps`);
  }

  console.log();
  if (result.warnings.length > 0) {
    result.warnings.forEach((w) => console.warn(`⚠️  ${w}`));
    console.log();
  }
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`❌ ${e}`));
    console.error(
      `\n${result.errors.length} error(s) found. Fix before importing or running flows.`,
    );
    return false;
  }
  console.log('✅ Collection valid.');
  return true;
}
