/**
 * Unit tests for src/lib/flows.ts
 *
 * All functions are pure (no I/O). The vm sandbox is exercised with real
 * scripts to verify step extraction works exactly as it would at runtime.
 */

import { describe, expect, it } from 'vitest';
import { extractFlowDef, findFlowRequest, listFlows, runSandboxed } from '../../src/lib/flows.js';
import type { PostmanCollection, PostmanItem } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlowRequest(name: string, steps: string[], execLines?: string[]): PostmanItem {
  const exec = execLines ?? [`steps(${JSON.stringify(steps)});`];
  return {
    name,
    request: { method: 'FLOW', url: { raw: 'about:blank' } },
    event: [
      {
        listen: 'prerequest',
        script: { type: 'text/javascript', exec },
      },
    ],
  };
}

function makeCollection(
  flowItems: PostmanItem[],
  extraItems: PostmanItem[] = [],
): PostmanCollection {
  return {
    info: {
      name: 'Test',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [...extraItems, { name: 'Flows', item: flowItems }],
  };
}

// ---------------------------------------------------------------------------
// runSandboxed — vm hardening
// ---------------------------------------------------------------------------

describe('runSandboxed', () => {
  it('captures a valid steps() call', () => {
    expect(runSandboxed('My Flow', "steps(['Login', 'Create Org']);")).toEqual([
      'Login',
      'Create Org',
    ]);
  });

  it('rejects scripts that reference "constructor"', () => {
    expect(() =>
      runSandboxed('Attack', "steps.constructor.constructor('return process')();"),
    ).toThrow('forbidden identifier');
  });

  it('rejects scripts that reference "process"', () => {
    expect(() => runSandboxed('Attack', 'var p = process; steps(["a"]);')).toThrow(
      'forbidden identifier',
    );
  });

  it('rejects scripts that reference "require"', () => {
    expect(() => runSandboxed('Attack', 'require("fs"); steps(["a"]);')).toThrow(
      'forbidden identifier',
    );
  });

  it('rejects scripts that reference "eval"', () => {
    expect(() => runSandboxed('Attack', 'eval("steps([\'a\'])");')).toThrow('forbidden identifier');
  });

  it('rejects scripts that reference "Function"', () => {
    expect(() => runSandboxed('Attack', 'new Function("return process")();')).toThrow(
      'forbidden identifier',
    );
  });

  it('allows step names that contain forbidden words as substrings inside strings', () => {
    // "Create prototype" — "prototype" is inside a string literal, not an identifier
    expect(runSandboxed('My Flow', "steps(['Create prototype', 'Login']);")).toEqual([
      'Create prototype',
      'Login',
    ]);
  });

  it('enforces a 1-second timeout on infinite loops', () => {
    expect(() => runSandboxed('Hang', 'while(true){}')).toThrow(); // script timed out or forbidden pattern match
  }, 3000);

  it('throws when steps() receives a non-array', () => {
    expect(() => runSandboxed('Bad', 'steps("not an array");')).toThrow('must be an array');
  });

  it('throws when steps() receives an array with non-string elements', () => {
    expect(() => runSandboxed('Bad', 'steps([123, "Login"]);')).toThrow(
      'must contain only strings',
    );
  });

  it('throws when steps() receives an array with an empty string', () => {
    expect(() => runSandboxed('Bad', 'steps(["Login", "", "View"]);')).toThrow(
      'must not contain empty strings',
    );
  });

  it('throws when steps() is not called', () => {
    expect(() => runSandboxed('Bad', '// just a comment')).toThrow('No valid steps() call');
  });

  it('throws when steps() is called with an empty array', () => {
    expect(() => runSandboxed('Bad', 'steps([]);')).toThrow('No valid steps() call');
  });

  it('throws on a syntax error in the script', () => {
    expect(() => runSandboxed('Bad', 'steps([broken;;;')).toThrow('Failed to evaluate');
  });
});

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
    const req = makeFlowRequest(
      'Multi-line',
      [],
      ['// Run: newman-flows run "Multi-line"', 'steps([', '  "Step One",', '  "Step Two"', ']);'],
    );
    expect(extractFlowDef(req).steps).toEqual(['Step One', 'Step Two']);
  });

  it('throws when the pre-request script is missing', () => {
    const req: PostmanItem = {
      name: 'No Script',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
    };
    expect(() => extractFlowDef(req)).toThrow('No pre-request script found');
  });

  it('throws when the script has no steps() call', () => {
    const req = makeFlowRequest('No Steps', [], ['// no steps() here']);
    expect(() => extractFlowDef(req)).toThrow('No valid steps() call');
  });

  it('throws when steps() is called with an empty array', () => {
    const req = makeFlowRequest('Empty', []);
    expect(() => extractFlowDef(req)).toThrow('No valid steps() call');
  });

  it('throws when steps() contains a non-string value', () => {
    const req = makeFlowRequest('Bad', [], ['steps([123, "Login"]);']);
    expect(() => extractFlowDef(req)).toThrow('must contain only strings');
  });

  it('throws when steps() contains an empty string', () => {
    const req = makeFlowRequest('Bad', [], ['steps(["Login", ""]);']);
    expect(() => extractFlowDef(req)).toThrow('must not contain empty strings');
  });

  it('throws when the script references a forbidden identifier', () => {
    const req = makeFlowRequest('Bad', [], ['steps.constructor.constructor("return process")();']);
    expect(() => extractFlowDef(req)).toThrow('forbidden identifier');
  });

  it('throws when the script has a syntax error', () => {
    const req = makeFlowRequest('Bad', [], ['steps([broken syntax;;;']);
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
    const collection = makeCollection([], [{ name: 'Requests', item: [stepA, stepB] }]);
    const temp = buildTempCollection(collection, { name: 'My Flow', steps: ['Step A', 'Step B'] });
    expect((temp.item as PostmanItem[])[0].name).toBe('Step A');
    expect((temp.item as PostmanItem[])[1].name).toBe('Step B');
  });

  it('strips events whose script references _flow_steps as an identifier', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const collection: PostmanCollection = {
      info: { name: 'Test', schema: 'x' },
      item: [
        {
          name: 'Requests',
          item: [{ name: 'Step A', request: { method: 'GET', url: { raw: 'http://x/a' } } }],
        },
        { name: 'Flows', item: [] },
      ],
      event: [
        {
          listen: 'prerequest',
          script: { type: 'text/javascript', exec: ['var x = _flow_steps;'] },
        },
        { listen: 'test', script: { type: 'text/javascript', exec: ['pm.test("ok", () => {});'] } },
      ],
    };
    const temp = buildTempCollection(collection, { name: 'My Flow', steps: ['Step A'] });
    const events = temp.event as typeof collection.event;
    expect(events).toHaveLength(1);
    expect(events?.[0].listen).toBe('test');
  });

  it('does NOT strip events that mention _flow_steps inside a string literal', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const collection: PostmanCollection = {
      info: { name: 'Test', schema: 'x' },
      item: [
        {
          name: 'Requests',
          item: [{ name: 'Step A', request: { method: 'GET', url: { raw: 'http://x/a' } } }],
        },
        { name: 'Flows', item: [] },
      ],
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'pm.test("check _flow_steps is not set", () => { pm.expect(pm.globals.get("_flow_steps")).to.be.undefined; });',
            ],
          },
        },
      ],
    };
    const temp = buildTempCollection(collection, { name: 'My Flow', steps: ['Step A'] });
    const events = temp.event as typeof collection.event;
    expect(events).toHaveLength(1); // should NOT be filtered out
  });

  it('throws when a step name is not found in the collection', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const collection = makeCollection([]);
    expect(() =>
      buildTempCollection(collection, { name: 'Bad Flow', steps: ['Missing Step'] }),
    ).toThrow('Step "Missing Step" not found');
  });
});
