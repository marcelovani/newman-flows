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
      { step: 'Login' },
      { step: 'Create Org' },
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
      { step: 'Create prototype' },
      { step: 'Login' },
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

describe('runSandboxed — step objects', () => {
  it('accepts { step, vars } alongside plain names', () => {
    expect(
      runSandboxed(
        'My Flow',
        "steps(['Login', { step: 'View', vars: { actor: 'member', expected_status: 403, strict: true } }]);",
      ),
    ).toEqual([
      { step: 'Login' },
      { step: 'View', vars: { actor: 'member', expected_status: 403, strict: true } },
    ]);
  });

  it('accepts an object with no vars, and drops an empty vars', () => {
    expect(runSandboxed('My Flow', "steps([{ step: 'A' }, { step: 'B', vars: {} }]);")).toEqual([
      { step: 'A' },
      { step: 'B' },
    ]);
  });

  it('returns plain objects, not objects from the vm context', () => {
    const [step] = runSandboxed('My Flow', "steps([{ step: 'A', vars: { x: 1 } }]);");
    expect(Object.getPrototypeOf(step)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(step.vars)).toBe(Object.prototype);
  });

  it('rejects an object without a step', () => {
    expect(() => runSandboxed('F', 'steps([{ vars: { a: 1 } }]);')).toThrow(
      'needs a non-empty "step" string',
    );
  });

  it('rejects an empty step name in an object', () => {
    expect(() => runSandboxed('F', "steps([{ step: '' }]);")).toThrow(
      'needs a non-empty "step" string',
    );
  });

  it('rejects unknown keys, naming them', () => {
    expect(() => runSandboxed('F', "steps([{ step: 'A', expect: 403 }]);")).toThrow(
      'unknown key(s): expect',
    );
  });

  it('rejects vars that is not an object', () => {
    expect(() => runSandboxed('F', "steps([{ step: 'A', vars: 'x' }]);")).toThrow(
      '"vars" must be an object',
    );
    expect(() => runSandboxed('F', "steps([{ step: 'A', vars: [1] }]);")).toThrow(
      '"vars" must be an object',
    );
  });

  it('rejects a var value that is not a string, number or boolean', () => {
    expect(() => runSandboxed('F', "steps([{ step: 'A', vars: { a: { b: 1 } } }]);")).toThrow(
      'vars.a must be a string, number or boolean',
    );
    expect(() => runSandboxed('F', "steps([{ step: 'A', vars: { a: null } }]);")).toThrow(
      'vars.a must be a string, number or boolean',
    );
  });

  it('rejects a var name that cannot be used as a variable', () => {
    expect(() => runSandboxed('F', "steps([{ step: 'A', vars: { 'has space': 1 } }]);")).toThrow(
      'is not a valid variable name',
    );
  });

  it('rejects null and arrays as steps', () => {
    expect(() => runSandboxed('F', 'steps([null]);')).toThrow('index 0 has type null');
    expect(() => runSandboxed('F', "steps([['A']]);")).toThrow('index 0 has type array');
  });
});

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

  it('keeps step names in steps and the variables in stepDefs', () => {
    const req = makeFlowRequest(
      'Mixed',
      [],
      ["steps(['Login', { step: 'View', vars: { actor: 'member' } }, 'View']);"],
    );
    const def = extractFlowDef(req);
    expect(def.steps).toEqual(['Login', 'View', 'View']);
    expect(def.stepDefs).toEqual([
      { step: 'Login' },
      { step: 'View', vars: { actor: 'member' } },
      { step: 'View' },
    ]);
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

  it("adds the step's variables as a pre-request event ahead of the request's own", async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const view: PostmanItem = {
      name: 'View',
      request: { method: 'GET', url: { raw: 'http://x/v' } },
      event: [
        { listen: 'prerequest', script: { type: 'text/javascript', exec: ['own();'] } },
        { listen: 'test', script: { type: 'text/javascript', exec: ['pm.test("t", () => {});'] } },
      ],
    };
    const collection = makeCollection([], [{ name: 'Requests', item: [view] }]);
    const temp = buildTempCollection(collection, {
      name: 'F',
      steps: ['View'],
      stepDefs: [{ step: 'View', vars: { actor: 'member', expected_status: 403 } }],
    });
    const item = (temp.item as PostmanItem[])[0];
    expect(item.name).toBe('View [actor=member, expected_status=403]');
    expect(item.event?.map((e) => e.listen)).toEqual(['prerequest', 'prerequest', 'test']);
    const setExec = item.event![0].script.exec.join('\n');
    expect(setExec).toContain('const vars = {"actor":"member","expected_status":403};');
    expect(item.event![1].script.exec).toEqual(['own();']);
    // Nothing is added to the test script: an error there must not skip the clean-up.
    expect(item.event![2].script.exec).toEqual(['pm.test("t", () => {});']);
  });

  it('serialises values as JSON, so quotes in a value cannot break the script', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const bare: PostmanItem = {
      name: 'Bare',
      request: { method: 'GET', url: { raw: 'http://x' } },
    };
    const collection = makeCollection([], [{ name: 'Requests', item: [bare] }]);
    const temp = buildTempCollection(collection, {
      name: 'F',
      steps: ['Bare'],
      stepDefs: [{ step: 'Bare', vars: { q: 'it\'s "quoted"' } }],
    });
    const exec = (temp.item as PostmanItem[])[0].event![0].script.exec.join('\n');
    expect(exec).toContain(`const vars = ${JSON.stringify({ q: 'it\'s "quoted"' })};`);
  });

  it('restores at the start of every step after the first step with variables, and only there', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const view: PostmanItem = {
      name: 'View',
      request: { method: 'GET', url: { raw: 'http://x' } },
    };
    const collection = makeCollection([], [{ name: 'Requests', item: [view] }]);
    const temp = buildTempCollection(collection, {
      name: 'F',
      steps: ['View', 'View', 'View', 'View'],
      stepDefs: [
        { step: 'View' },
        { step: 'View', vars: { actor: 'admin' } },
        { step: 'View', vars: { actor: 'member' } },
        { step: 'View' },
      ],
    });
    const items = temp.item as PostmanItem[];
    expect(items.map((i) => i.name)).toEqual([
      'View',
      'View [actor=admin]',
      'View [actor=member]',
      'View',
    ]);
    const firstLines = items.map((i) => (i.event ?? []).map((e) => e.script.exec[0]));
    expect(firstLines).toEqual([
      [],
      ["// newman-flows: this step's variables."],
      [
        "// newman-flows: restore what the previous step's variables replaced.",
        "// newman-flows: this step's variables.",
      ],
      ["// newman-flows: restore what the previous step's variables replaced."],
    ]);
    // The collection's own request is untouched — each step got a copy.
    expect(view.event).toBeUndefined();
  });

  it('leaves a flow without variables exactly as before', async () => {
    const { buildTempCollection } = await import('../../src/commands/run.js');
    const view: PostmanItem = {
      name: 'View',
      request: { method: 'GET', url: { raw: 'http://x' } },
    };
    const collection = makeCollection([], [{ name: 'Requests', item: [view] }]);
    const temp = buildTempCollection(collection, { name: 'F', steps: ['View', 'View'] });
    expect(temp.item).toEqual([view, view]);
  });
});
