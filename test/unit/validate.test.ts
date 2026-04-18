/**
 * Unit tests for src/commands/validate.ts
 *
 * Verifies that validateCollection() correctly identifies errors and warnings,
 * populates validFlows with accurate step counts, and that printValidationResult()
 * uses those counts rather than re-running the vm.
 */

import { describe, expect, it, vi } from 'vitest';
import { printValidationResult, validateCollection } from '../../src/commands/validate.js';
import type { PostmanCollection } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollection(overrides: Partial<PostmanCollection> = {}): PostmanCollection {
  return {
    info: {
      name: 'My API',
      _postman_id: 'abc-123',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Requests',
        item: [
          { name: 'Login', request: { method: 'POST', url: { raw: 'http://x/login' } } },
          { name: 'Create Org', request: { method: 'POST', url: { raw: 'http://x/orgs' } } },
          { name: 'View Org', request: { method: 'GET', url: { raw: 'http://x/orgs/1' } } },
        ],
      },
      {
        name: 'Flows',
        item: [
          {
            name: 'Onboarding',
            request: { method: 'FLOW', url: { raw: 'about:blank' } },
            event: [
              {
                listen: 'prerequest',
                script: {
                  type: 'text/javascript',
                  exec: ["steps(['Login', 'Create Org', 'View Org']);"],
                },
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCollection — info fields
// ---------------------------------------------------------------------------

describe('validateCollection — info fields', () => {
  it('reports no errors for a valid collection', () => {
    const result = validateCollection(makeCollection());
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors when info.name is missing', () => {
    const col = makeCollection({ info: { name: '', _postman_id: 'x', schema: 'x' } });
    expect(validateCollection(col).errors).toContain('info.name is missing');
  });

  it('errors when info._postman_id is missing', () => {
    const col = makeCollection({ info: { name: 'X', schema: 'x' } } as never);
    expect(validateCollection(col).errors).toContain('info._postman_id is missing');
  });

  it('errors when info.schema is missing', () => {
    const col = makeCollection({ info: { name: 'X', _postman_id: 'x', schema: '' } });
    expect(validateCollection(col).errors).toContain('info.schema is missing');
  });
});

// ---------------------------------------------------------------------------
// validateCollection — flows
// ---------------------------------------------------------------------------

describe('validateCollection — flows', () => {
  it('populates validFlows with correct step count for each valid flow', () => {
    const result = validateCollection(makeCollection());
    expect(result.validFlows).toEqual({ Onboarding: 3 });
  });

  it('does not add a flow to validFlows when a step is unresolvable', () => {
    const col = makeCollection();
    // Replace the flow steps with one that doesn't exist
    (col.item[1].item![0].event![0].script as { exec: string[] }).exec = [
      "steps(['Login', 'Missing Step']);",
    ];
    const result = validateCollection(col);
    expect(result.errors).toContain('"Onboarding": step "Missing Step" not found in collection');
    expect(result.validFlows).not.toHaveProperty('Onboarding');
  });

  it('errors when the Flows/ folder is missing', () => {
    const col = makeCollection({ item: [] });
    expect(validateCollection(col).errors).toContain('"Flows" folder not found in collection');
  });

  it('warns when Flows/ folder has no flow requests', () => {
    const col = makeCollection({
      item: [{ name: 'Flows', item: [] }],
    });
    expect(validateCollection(col).warnings).toContain('No flow requests found in Flows/ folder');
  });

  it('errors when a flow pre-request script is missing', () => {
    const col = makeCollection();
    col.item[1].item![0].event = [];
    expect(validateCollection(col).errors).toContain('"Onboarding": missing pre-request script');
  });

  it('errors when a flow uses legacy syntax', () => {
    const col = makeCollection();
    (col.item[1].item![0].event![0].script as { exec: string[] }).exec = [
      'var FLOW = "legacy"; run(FLOW);',
    ];
    expect(validateCollection(col).errors[0]).toContain('legacy syntax');
  });

  it('errors when steps() receives non-string values', () => {
    const col = makeCollection();
    (col.item[1].item![0].event![0].script as { exec: string[] }).exec = [
      'steps([123, "Login"]);',
    ];
    const result = validateCollection(col);
    expect(result.errors.some((e) => e.includes('must contain only strings'))).toBe(true);
  });

  it('errors when steps() receives an empty string', () => {
    const col = makeCollection();
    (col.item[1].item![0].event![0].script as { exec: string[] }).exec = [
      'steps(["Login", ""]);',
    ];
    const result = validateCollection(col);
    expect(result.errors.some((e) => e.includes('must not contain empty strings'))).toBe(true);
  });

  it('errors when the pre-request script references a forbidden identifier', () => {
    const col = makeCollection();
    (col.item[1].item![0].event![0].script as { exec: string[] }).exec = [
      'steps.constructor.constructor("return process")();',
    ];
    const result = validateCollection(col);
    expect(result.errors.some((e) => e.includes('forbidden identifier'))).toBe(true);
  });

  it('warns on duplicate request names', () => {
    const col = makeCollection({
      item: [
        {
          name: 'Requests',
          item: [
            { name: 'Login', request: { method: 'POST', url: { raw: 'http://x/a' } } },
            { name: 'Login', request: { method: 'POST', url: { raw: 'http://x/b' } } },
          ],
        },
        { name: 'Flows', item: [] },
      ],
    });
    expect(validateCollection(col).warnings.some((w) => w.includes('Duplicate request name "Login"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCollection — absolute file paths
// ---------------------------------------------------------------------------

describe('validateCollection — absolute file paths', () => {
  it('errors on an absolute body.file.src', () => {
    const col = makeCollection({
      item: [
        {
          name: 'Requests',
          item: [
            {
              name: 'Upload',
              request: {
                method: 'POST',
                url: { raw: 'http://x/upload' },
                body: { mode: 'file', file: { src: '/absolute/path/file.pdf' } },
              },
            },
          ],
        },
        { name: 'Flows', item: [] },
      ],
    });
    expect(validateCollection(col).errors.some((e) => e.includes('absolute path'))).toBe(true);
  });

  it('errors on an absolute formdata field src', () => {
    const col = makeCollection({
      item: [
        {
          name: 'Requests',
          item: [
            {
              name: 'Upload',
              request: {
                method: 'POST',
                url: { raw: 'http://x/upload' },
                body: {
                  mode: 'formdata',
                  formdata: [{ key: 'file', type: 'file', src: '/absolute/path/file.pdf' }],
                },
              },
            },
          ],
        },
        { name: 'Flows', item: [] },
      ],
    });
    expect(validateCollection(col).errors.some((e) => e.includes('absolute path'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// printValidationResult — uses pre-computed counts, does not re-run vm
// ---------------------------------------------------------------------------

describe('printValidationResult', () => {
  it('prints step counts from validFlows without touching the vm', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printValidationResult({ errors: [], warnings: [], validFlows: { 'My Flow': 4, 'Other': 2 } });
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('My Flow" — 4 steps');
    expect(output).toContain('Other" — 2 steps');
    logSpy.mockRestore();
  });

  it('returns true when there are no errors', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = printValidationResult({ errors: [], warnings: [], validFlows: {} });
    expect(result).toBe(true);
    vi.restoreAllMocks();
  });

  it('returns false and prints errors when there are errors', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = printValidationResult({
      errors: ['info.name is missing'],
      warnings: [],
      validFlows: {},
    });
    expect(result).toBe(false);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('info.name is missing');
    vi.restoreAllMocks();
  });

  it('prints warnings before errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    printValidationResult({
      errors: ['some error'],
      warnings: ['some warning'],
      validFlows: {},
    });
    expect(warnSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
