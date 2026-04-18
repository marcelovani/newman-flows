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
  '../fixtures/collection/my-api.postman_collection.json',
);
const ENV_PATH = path.resolve(
  __dirname,
  '../fixtures/environments/environment.mock.postman_environment.json',
);

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
  it('runs "Organisation creation" flow end-to-end', async () => {
    const { runFlow } = await import('../../src/commands/run.js');
    await expect(
      runFlow({
        collection: COLLECTION_PATH,
        flow: 'Organisation creation',
        env: envPath,
        resultsDir: path.join(tmpDir, 'results-org'),
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
        resultsDir: path.join(tmpDir, 'results-inv'),
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
        resultsDir: path.join(tmpDir, 'results-all'),
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
    expect(Object.keys(result.validFlows)).toHaveLength(2); // Organisation creation + Member invitation
  });
});
