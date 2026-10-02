/**
 * Integration tests for the newman-flows run command.
 *
 * These tests start the mock server (via setup.ts), load the fixture
 * collection, and run each flow end-to-end through newman.run() to verify
 * that the full pipeline works: step extraction → temp collection assembly →
 * Newman execution → assertions.
 *
 * Results are written to a temp directory so they don't pollute the repo.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_PORT } from './setup.js';

const COLLECTION_PATH = path.resolve(
  __dirname,
  '../../examples/my-api/my-api.postman_collection.json',
);
const ENV_PATH = path.resolve(__dirname, '../../examples/my-api/local.postman_environment.json');

// Write a per-test-run env override so the mock port is always consistent
// with what setup.ts actually bound (in case MOCK_PORT env var is used).
let tmpDir: string;
let envPath: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-integration-'));

  const baseEnv = JSON.parse(fs.readFileSync(ENV_PATH, 'utf8')) as {
    values: Array<{ key: string; value: string }>;
  };
  const env = {
    ...baseEnv,
    values: baseEnv.values.map((v) =>
      v.key === 'base_url' ? { ...v, value: `http://localhost:${MOCK_PORT}` } : v,
    ),
  };
  envPath = path.join(tmpDir, 'env.json');
  fs.writeFileSync(envPath, JSON.stringify(env));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

describe('runFlow', () => {
  it('runs "Create and edit item" flow end-to-end', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    await expect(
      runFlow({
        collection: COLLECTION_PATH,
        flow: 'Create and edit item',
        env: envPath,
      }),
    ).resolves.toBeUndefined();
  }, 30_000);

  it('runs "Member invitation" flow end-to-end', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    await expect(
      runFlow({
        collection: COLLECTION_PATH,
        flow: 'Member invitation',
        env: envPath,
      }),
    ).resolves.toBeUndefined();
  }, 30_000);

  it('runs "Item access by actor" — one request, several actors', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    await expect(
      runFlow({
        collection: COLLECTION_PATH,
        flow: 'Item access by actor',
        env: envPath,
      }),
    ).resolves.toBeUndefined();
  }, 30_000);

  it('rejects when the flow name does not exist', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    await expect(
      runFlow({
        collection: COLLECTION_PATH,
        flow: 'Non-existent flow',
        env: envPath,
      }),
    ).rejects.toThrow('Non-existent flow');
  });
});

// ---------------------------------------------------------------------------
// runAllFlows
// ---------------------------------------------------------------------------

describe('runAllFlows', () => {
  it('runs all flows defined in the fixture collection', async () => {
    const { runAllFlows } = await import('../../src/commands/run.js');
    await expect(
      runAllFlows({
        collection: COLLECTION_PATH,
        env: envPath,
      }),
    ).resolves.toBeUndefined();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// validateCollection
// ---------------------------------------------------------------------------

describe('validateCollection (integration)', () => {
  it('reports no errors for the fixture collection', async () => {
    const { loadCollection } = await import('../../src/lib/collection.js');
    const { validateCollection } = await import('../../src/commands/validate.js');
    const collection = loadCollection(COLLECTION_PATH);
    const result = validateCollection(collection);
    expect(result.errors).toHaveLength(0);
    // Create and edit item + Member invitation + Item access by actor
    expect(Object.keys(result.validFlows)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Step variables
// ---------------------------------------------------------------------------

/**
 * Write a copy of the example collection with one extra request and one extra
 * flow, so each test controls exactly which steps run.
 */
function collectionWithFlow(steps: string, extraRequests: unknown[] = []): string {
  const col = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8')) as {
    item: Array<{ name: string; item: unknown[] }>;
  };
  col.item.find((i) => i.name === 'Requests')!.item.push(...extraRequests);
  col.item.find((i) => i.name === 'Flows')!.item = [
    {
      name: 'Under test',
      request: { method: 'FLOW', url: { raw: 'about:blank' } },
      event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: [steps] } }],
    },
  ];
  const file = path.join(tmpDir, `col-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(col));
  return file;
}

/** A GET /health request with the given pre-request and test scripts. */
function healthRequest(name: string, scripts: { pre?: string[]; test?: string[] }): unknown {
  const event = [];
  if (scripts.pre) {
    event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: scripts.pre } });
  }
  if (scripts.test) {
    event.push({ listen: 'test', script: { type: 'text/javascript', exec: scripts.test } });
  }
  return {
    name,
    request: {
      method: 'GET',
      url: { raw: '{{base_url}}/health', host: ['{{base_url}}'], path: ['health'] },
    },
    event,
  };
}

const ASSERT_NO_STEP_VARS = healthRequest('Assert no step vars', {
  test: [
    "pm.test('actor is not left over', () => pm.expect(pm.variables.has('actor')).to.be.false);",
    "pm.test('expected_status is not left over', () => pm.expect(pm.variables.has('expected_status')).to.be.false);",
  ],
});

/** Run a flow, writing a JSON report, and return each assertion with its outcome. */
async function runAndReport(collection: string): Promise<{
  failed: boolean;
  assertions: Array<{ step: string; assertion: string; ok: boolean }>;
}> {
  const { runFlow } = await import('../../src/commands/run.js');
  const report = path.join(tmpDir, `report-${Math.random().toString(36).slice(2)}.json`);
  let failed = false;
  await runFlow({
    collection,
    flow: 'Under test',
    env: envPath,
    reporters: ['json'],
    reporter: { json: { export: report } },
  }).catch(() => {
    failed = true;
  });
  const json = JSON.parse(fs.readFileSync(report, 'utf8')) as {
    run: {
      executions: Array<{
        item: { name: string };
        assertions?: Array<{ assertion: string; error?: unknown }>;
      }>;
    };
  };
  const assertions = json.run.executions.flatMap((e) =>
    (e.assertions ?? []).map((a) => ({ step: e.item.name, assertion: a.assertion, ok: !a.error })),
  );
  return { failed, assertions };
}

describe('step variables', () => {
  it('drives the request: a wrong expected status fails the flow', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    const collection = collectionWithFlow(
      "steps(['Admin login', 'Create Item', { step: 'View Item As Actor', vars: { actor: 'anonymous', expected_status: 200 } }]);",
    );
    await expect(runFlow({ collection, flow: 'Under test', env: envPath })).rejects.toThrow(
      'failure',
    );
  }, 30_000);

  it('does not leak into the steps after it', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    const collection = collectionWithFlow(
      "steps(['Admin login', 'Create Item', { step: 'View Item As Actor', vars: { actor: 'admin', expected_status: 200 } }, 'Assert no step vars']);",
      [ASSERT_NO_STEP_VARS],
    );
    await expect(
      runFlow({ collection, flow: 'Under test', env: envPath }),
    ).resolves.toBeUndefined();
  }, 30_000);

  it('names each step after its variables in the report', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    const collection = collectionWithFlow(
      "steps(['Admin login', 'Create Item', { step: 'View Item As Actor', vars: { actor: 'admin' } }, { step: 'View Item As Actor', vars: { actor: 'anonymous', expected_status: 401 } }]);",
    );
    const report = path.join(tmpDir, 'report.json');
    await runFlow({
      collection,
      flow: 'Under test',
      env: envPath,
      reporters: ['json'],
      reporter: { json: { export: report } },
    });
    const json = JSON.parse(fs.readFileSync(report, 'utf8')) as {
      run: { executions: Array<{ item: { name: string } }> };
    };
    expect(json.run.executions.map((e) => e.item.name)).toEqual([
      'Admin login',
      'Create Item',
      'View Item As Actor [actor=admin]',
      'View Item As Actor [actor=anonymous, expected_status=401]',
    ]);
  }, 30_000);

  it("is cleaned up even when the step's own test script throws", async () => {
    const collection = collectionWithFlow(
      "steps([{ step: 'Throws in tests', vars: { actor: 'admin', expected_status: 200 } }, 'Assert no step vars']);",
      [
        healthRequest('Throws in tests', { test: ["throw new Error('boom');"] }),
        ASSERT_NO_STEP_VARS,
      ],
    );
    const { failed, assertions } = await runAndReport(collection);
    expect(failed).toBe(true); // the throw is still reported
    expect(assertions.filter((a) => a.step === 'Assert no step vars')).toEqual([
      { step: 'Assert no step vars', assertion: 'actor is not left over', ok: true },
      { step: 'Assert no step vars', assertion: 'expected_status is not left over', ok: true },
    ]);
  }, 30_000);

  it('is cleaned up even when the step skips its request', async () => {
    const collection = collectionWithFlow(
      "steps([{ step: 'Skips itself', vars: { actor: 'admin', expected_status: 200 } }, 'Assert no step vars']);",
      [
        healthRequest('Skips itself', { pre: ['pm.execution.skipRequest();'] }),
        ASSERT_NO_STEP_VARS,
      ],
    );
    const { failed, assertions } = await runAndReport(collection);
    expect(failed).toBe(false);
    expect(assertions.every((a) => a.ok)).toBe(true);
    expect(assertions.map((a) => a.assertion)).toContain('actor is not left over');
  }, 30_000);

  it('puts back a value it replaced, from the local scope or from globals', async () => {
    const collection = collectionWithFlow(
      "steps(['Set earlier values', { step: 'View Item As Actor', vars: { actor: 'anonymous', expected_status: 401, tier: 'step' } }, 'Assert earlier values']);",
      [
        healthRequest('Set earlier values', {
          pre: ["pm.variables.set('actor', 'kept');", "pm.globals.set('tier', 'global');"],
        }),
        healthRequest('Assert earlier values', {
          test: [
            "pm.test('local value is back', () => pm.expect(pm.variables.get('actor')).to.equal('kept'));",
            "pm.test('global value is back', () => pm.expect(pm.variables.get('tier')).to.equal('global'));",
            "pm.test('global itself untouched', () => pm.expect(pm.globals.get('tier')).to.equal('global'));",
            "pm.test('new variable is gone', () => pm.expect(pm.variables.has('expected_status')).to.be.false);",
            "pm.globals.unset('tier');",
          ],
        }),
      ],
    );
    const { failed, assertions } = await runAndReport(collection);
    expect(assertions.filter((a) => !a.ok)).toEqual([]);
    expect(failed).toBe(false);
  }, 30_000);
});
