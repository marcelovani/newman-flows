/**
 * Unit tests for src/lib/flows.ts
 *
 * All functions are pure (no I/O). The vm sandbox is exercised with real
 * scripts to verify step extraction works exactly as it would at runtime.
 */

import { describe, expect, it } from 'vitest';
import { extractFlowDef, findFlowRequest, listFlows } from '../../src/lib/flows.js';
import type { PostmanCollection, PostmanItem } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlowRequest(name: string, steps: string[]): PostmanItem {
  return {
    name,
    request: { method: 'FLOW', url: { raw: 'about:blank' } },
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [`steps(${JSON.stringify(steps)});`],
        },
      },
    ],
  };
}

function makeCollection(flowItems: PostmanItem[], extraItems: PostmanItem[] = []): PostmanCollection {
  return {
    info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      ...extraItems,
      { name: 'Flows', item: flowItems },
    ],
  };
}

// ---------------------------------------------------------------------------
// listFlows
// ---------------------------------------------------------------------------

describe('listFlows', () => {
  it('returns all direct request items in the Flows/ folder', () => {
    const collection = makeCollection([
      makeFlowRequest('Onboarding', ['Login', 'Create Org']),
      makeFlowRequest('Member invitation', ['Login', 'Invite']),
    ]);
    expect(listFlows(collection)).toHaveLength(2);
  });

  it('skips sub-folders inside Flows/', () => {
    const collection = makeCollection([
      makeFlowRequest('Flow A', ['Step 1']),
      { name: 'SubFolder', item: [makeFlowRequest('Nested', ['Step 2'])] },
    ]);
    expect(listFlows(collection)).toHaveLength(1);
    expect(listFlows(collection)[0].name).toBe('Flow A');
  });

  it('returns an empty array when Flows/ folder is empty', () => {
    const collection = makeCollection([]);
    expect(listFlows(collection)).toHaveLength(0);
  });

  it('throws when there is no Flows/ folder', () => {
    const collection: PostmanCollection = {
      info: { name: 'No Flows', schema: 'x' },
      item: [{ name: 'Requests', item: [] }],
    };
    expect(() => listFlows(collection)).toThrow('"Flows" folder not found');
  });
});

// ---------------------------------------------------------------------------
// extractFlowDef
// ---------------------------------------------------------------------------

describe('extractFlowDef', () => {
  it('extracts the flow name and steps array', () => {
    const req = makeFlowRequest('Onboarding', ['Login', 'Create Org', 'View Org']);
    const def = extractFlowDef(req);
    expect(def.name).toBe('Onboarding');
    expect(def.steps).toEqual(['Login', 'Create Org', 'View Org']);
  });

  it('handles multi-line pre-request scripts', () => {
    const req: PostmanItem = {
      name: 'Multi-line',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
      event: [
        {
          listen: 'prerequest',
          script: {
            type: 'text/javascript',
            exec: [
              '// Run: newman-flows run "Multi-line"',
              'steps([',
              '  "Step One",',
              '  "Step Two"',
              ']);',
            ],
          },
        },
      ],
    };
    const def = extractFlowDef(req);
    expect(def.steps).toEqual(['Step One', 'Step Two']);
  });

  it('throws when the pre-request script is missing', () => {
    const req: PostmanItem = {
      name: 'No Script',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
    };
    expect(() => extractFlowDef(req)).toThrow('No pre-request script found');
  });

  it('throws when the script has no steps() call', () => {
    const req: PostmanItem = {
      name: 'No Steps',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
      event: [
        {
          listen: 'prerequest',
          script: { type: 'text/javascript', exec: ['// no steps() here'] },
        },
      ],
    };
    expect(() => extractFlowDef(req)).toThrow('No valid steps() call');
  });

  it('throws when steps() is called with an empty array', () => {
    const req = makeFlowRequest('Empty', []);
    expect(() => extractFlowDef(req)).toThrow('No valid steps() call');
  });

  it('throws when the script has a syntax error', () => {
    const req: PostmanItem = {
      name: 'Bad Script',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
      event: [
        {
          listen: 'prerequest',
          script: { type: 'text/javascript', exec: ['steps([broken syntax;;;'] },
        },
      ],
    };
    expect(() => extractFlowDef(req)).toThrow('Failed to evaluate');
  });
});

// ---------------------------------------------------------------------------
// findFlowRequest
// ---------------------------------------------------------------------------

describe('findFlowRequest', () => {
  it('finds a flow by exact name', () => {
    const collection = makeCollection([
      makeFlowRequest('Onboarding', ['Login']),
      makeFlowRequest('Member invitation', ['Login', 'Invite']),
    ]);
    expect(findFlowRequest(collection, 'Member invitation').name).toBe('Member invitation');
  });

  it('throws with available names when not found', () => {
    const collection = makeCollection([makeFlowRequest('Onboarding', ['Login'])]);
    expect(() => findFlowRequest(collection, 'Non-existent')).toThrow(
      'Available flows: Onboarding',
    );
  });
});

// ---------------------------------------------------------------------------
// buildTempCollection (via src/commands/run.ts)
// ---------------------------------------------------------------------------

describe('buildTempCollection', () => {
  it('assembles steps in the declared order', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const stepA: PostmanItem = {
      name: 'Step A',
      request: { method: 'GET', url: { raw: 'http://x/a' } },
    };
    const stepB: PostmanItem = {
      name: 'Step B',
      request: { method: 'POST', url: { raw: 'http://x/b' } },
    };
    const collection = makeCollection([], [
      { name: 'Requests', item: [stepA, stepB] },
    ]);
    const temp = buildTempCollection(collection, { name: 'My Flow', steps: ['Step A', 'Step B'] });
    expect((temp.item as PostmanItem[])[0].name).toBe('Step A');
    expect((temp.item as PostmanItem[])[1].name).toBe('Step B');
  });

  it('strips _flow_steps events from collection-level events', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const collection: PostmanCollection = {
      info: { name: 'Test', schema: 'x' },
      item: [
        { name: 'Requests', item: [
          { name: 'Step A', request: { method: 'GET', url: { raw: 'http://x/a' } } },
        ]},
        { name: 'Flows', item: [] },
      ],
      event: [
        { listen: 'prerequest', script: { type: 'text/javascript', exec: ['var x = _flow_steps;'] } },
        { listen: 'test', script: { type: 'text/javascript', exec: ['pm.test("ok", () => {});'] } },
      ],
    };
    const temp = buildTempCollection(collection, { name: 'My Flow', steps: ['Step A'] });
    const events = temp.event as typeof collection.event;
    expect(events).toHaveLength(1);
    expect(events?.[0].listen).toBe('test');
  });

  it('throws when a step name is not found in the collection', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const collection = makeCollection([]);
    expect(() =>
      buildTempCollection(collection, { name: 'Bad Flow', steps: ['Missing Step'] }),
    ).toThrow('Step "Missing Step" not found');
  });
});
