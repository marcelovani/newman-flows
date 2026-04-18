/**
 * Unit tests for src/commands/list.ts
 *
 * Verifies that getFlowSummaries() returns correct names and step counts,
 * and that printFlowList() produces the expected console output without
 * touching the network or disk.
 */

import { describe, expect, it, vi } from 'vitest';
import { getFlowSummaries, printFlowList } from '../../src/commands/list.js';
import type { PostmanCollection } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Fixture
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
          { name: 'Upload File', request: { method: 'POST', url: { raw: 'http://x/upload' } } },
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
          {
            name: 'Upload',
            request: { method: 'FLOW', url: { raw: 'about:blank' } },
            event: [
              {
                listen: 'prerequest',
                script: { type: 'text/javascript', exec: ["steps(['Login', 'Upload File']);"] },
              },
            ],
          },
          {
            name: 'Single step flow',
            request: { method: 'FLOW', url: { raw: 'about:blank' } },
            event: [
              {
                listen: 'prerequest',
                script: { type: 'text/javascript', exec: ["steps(['Login']);"] },
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
// getFlowSummaries
// ---------------------------------------------------------------------------

describe('getFlowSummaries', () => {
  it('returns one summary per flow', () => {
    const result = getFlowSummaries(makeCollection());
    expect(result).toHaveLength(3);
  });

  it('returns the correct name for each flow', () => {
    const result = getFlowSummaries(makeCollection());
    expect(result.map((s) => s.name)).toEqual(['Onboarding', 'Upload', 'Single step flow']);
  });

  it('returns the correct step count for each flow', () => {
    const result = getFlowSummaries(makeCollection());
    expect(result[0].steps).toBe(3); // Onboarding: Login, Create Org, View Org
    expect(result[1].steps).toBe(2); // Upload: Login, Upload File
    expect(result[2].steps).toBe(1); // Single step flow: Login
  });

  it('throws when the Flows/ folder is missing', () => {
    const col = makeCollection({ item: [{ name: 'Requests', item: [] }] });
    expect(() => getFlowSummaries(col)).toThrow('"Flows" folder not found');
  });

  it('throws when a flow pre-request script is missing', () => {
    const col = makeCollection();
    col.item[1].item![0].event = [];
    expect(() => getFlowSummaries(col)).toThrow();
  });

  it('returns an empty array when Flows/ folder has no flow requests', () => {
    const col = makeCollection({ item: [{ name: 'Flows', item: [] }] });
    expect(getFlowSummaries(col)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// printFlowList
// ---------------------------------------------------------------------------

describe('printFlowList', () => {
  it('returns true when flows are present', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = printFlowList(makeCollection());
    expect(result).toBe(true);
    vi.restoreAllMocks();
  });

  it('returns false when no flows are found', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const col = makeCollection({ item: [{ name: 'Flows', item: [] }] });
    expect(printFlowList(col)).toBe(false);
    vi.restoreAllMocks();
  });

  it('prints the collection name in the header', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFlowList(makeCollection());
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('My API');
    vi.restoreAllMocks();
  });

  it('prints each flow name', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFlowList(makeCollection());
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Onboarding');
    expect(output).toContain('Upload');
    expect(output).toContain('Single step flow');
    vi.restoreAllMocks();
  });

  it('uses plural "steps" for counts > 1', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFlowList(makeCollection());
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('3 steps');
    expect(output).toContain('2 steps');
    vi.restoreAllMocks();
  });

  it('uses singular "step" for a single-step flow', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFlowList(makeCollection());
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('1 step');
    expect(output).not.toContain('1 steps');
    vi.restoreAllMocks();
  });

  it('right-aligns step counts by padding shorter names', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFlowList(makeCollection());
    // "Single step flow" is the longest name (16 chars); "Onboarding" (10) and
    // "Upload" (6) should be padded to the same width so columns align.
    const lines = logSpy.mock.calls
      .flat()
      .join('\n')
      .split('\n')
      .filter((l) => l.includes('•'));
    const colPositions = lines.map((l) => l.indexOf('('));
    expect(new Set(colPositions).size).toBe(1); // all '(' at the same column
    vi.restoreAllMocks();
  });
});
