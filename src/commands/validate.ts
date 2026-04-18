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
 * The core validateCollection() function is pure — it returns errors and
 * warnings without printing or exiting. The CLI wrapper decides what to do
 * with the result.
 */

import * as path from 'path';
import * as vm from 'vm';
import { findFolder } from '../lib/collection.js';
import type { PostmanCollection, PostmanItem } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Pure validation logic
// ---------------------------------------------------------------------------

export function validateCollection(collection: PostmanCollection): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

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

      // Reject legacy syntax
      if (/var\s+FLOW\s*=/.test(scriptSrc) || /\brun\s*\(/.test(scriptSrc)) {
        errors.push(
          `"${flowReq.name}": pre-request script uses legacy syntax — update to "steps([...])"`,
        );
        continue;
      }

      // Extract steps via sandbox
      let capturedSteps: string[] | null = null;
      try {
        vm.runInNewContext(scriptSrc, {
          steps: (stepsArray: string[]) => {
            capturedSteps = stepsArray;
          },
        });
      } catch (e) {
        errors.push(
          `"${flowReq.name}": pre-request script failed to evaluate: ${(e as Error).message}`,
        );
        continue;
      }

      if (!capturedSteps) {
        errors.push(`"${flowReq.name}": pre-request script does not call steps()`);
        continue;
      }
      if ((capturedSteps as string[]).length === 0) {
        errors.push(`"${flowReq.name}": steps() must be called with a non-empty array`);
        continue;
      }

      // Resolve each step name
      for (const step of capturedSteps as string[]) {
        if (!requestNames.has(step)) {
          errors.push(`"${flowReq.name}": step "${step}" not found in collection`);
        }
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Console output helper (used by CLI)
// ---------------------------------------------------------------------------

/**
 * Print the validation result to stdout/stderr.
 * Returns true if the collection is valid (no errors), false otherwise.
 */
export function printValidationResult(
  result: ValidationResult,
  collection: PostmanCollection,
): boolean {
  const flowsFolder = findFolder(collection.item, 'Flows');
  if (flowsFolder) {
    const flowRequests = (flowsFolder.item ?? []).filter((r) => !r.item);
    for (const flowReq of flowRequests) {
      const preReq = flowReq.event?.find((e) => e.listen === 'prerequest');
      if (preReq?.script?.exec?.length) {
        const scriptSrc = preReq.script.exec.join('\n');
        let stepCount = 0;
        try {
          vm.runInNewContext(scriptSrc, {
            steps: (arr: string[]) => {
              stepCount = arr.length;
            },
          });
        } catch {
          // already captured in errors
        }
        if (stepCount > 0) {
          console.log(`  ✅ Flow "${flowReq.name}" — ${stepCount} steps`);
        }
      }
    }
  }

  console.log();
  if (result.warnings.length > 0) {
    result.warnings.forEach((w) => console.warn(`⚠️  ${w}`));
    console.log();
  }
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`❌ ${e}`));
    console.error(`\n${result.errors.length} error(s) found. Fix before importing or running flows.`);
    return false;
  }
  console.log('✅ Collection valid.');
  return true;
}
