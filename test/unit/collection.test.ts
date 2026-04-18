/**
 * Unit tests for src/lib/collection.ts
 *
 * Tests pure tree-traversal functions (findFolder, findRequest) without any
 * I/O. resolveCollectionPath / resolveEnvironmentPath are tested by asserting
 * on their error messages and return values using a temporary directory.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findFolder,
  findRequest,
  loadCollection,
  resolveCollectionPath,
  resolveEnvironmentPath,
} from '../../src/lib/collection.js';
import type { PostmanItem } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const items: PostmanItem[] = [
  {
    name: 'Requests',
    item: [
      {
        name: 'Authentication',
        item: [
          { name: 'Login', request: { method: 'POST', url: { raw: 'http://x/login' } } },
        ],
      },
      { name: 'Get User', request: { method: 'GET', url: { raw: 'http://x/user' } } },
    ],
  },
  {
    name: 'Flows',
    item: [
      { name: 'Onboarding', request: { method: 'FLOW', url: { raw: 'about:blank' } } },
    ],
  },
];

// ---------------------------------------------------------------------------
// findFolder
// ---------------------------------------------------------------------------

describe('findFolder', () => {
  it('finds a top-level folder by name', () => {
    const result = findFolder(items, 'Requests');
    expect(result?.name).toBe('Requests');
  });

  it('finds a nested folder', () => {
    const result = findFolder(items, 'Authentication');
    expect(result?.name).toBe('Authentication');
  });

  it('finds the Flows folder', () => {
    const result = findFolder(items, 'Flows');
    expect(result?.name).toBe('Flows');
  });

  it('returns null for a non-existent folder', () => {
    expect(findFolder(items, 'NonExistent')).toBeNull();
  });

  it('returns null for an empty items array', () => {
    expect(findFolder([], 'Flows')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findRequest
// ---------------------------------------------------------------------------

describe('findRequest', () => {
  it('finds a deeply nested request', () => {
    const result = findRequest(items, 'Login');
    expect(result?.name).toBe('Login');
  });

  it('finds a request at folder level (not deeply nested)', () => {
    const result = findRequest(items, 'Get User');
    expect(result?.name).toBe('Get User');
  });

  it('returns null for an unknown request name', () => {
    expect(findRequest(items, 'Missing')).toBeNull();
  });

  it('does not return a folder item', () => {
    // "Requests" is a folder — should not be returned by findRequest
    expect(findRequest(items, 'Requests')).toBeNull();
  });

  it('returns the first match (depth-first — Requests/ before Flows/)', () => {
    const ambiguousItems: PostmanItem[] = [
      {
        name: 'Requests',
        item: [{ name: 'Duplicate', request: { method: 'GET', url: { raw: 'http://x/a' } } }],
      },
      {
        name: 'Flows',
        item: [{ name: 'Duplicate', request: { method: 'FLOW', url: { raw: 'about:blank' } } }],
      },
    ];
    const result = findRequest(ambiguousItems, 'Duplicate');
    expect(result?.request?.method).toBe('GET'); // Requests/ found first
  });
});

// ---------------------------------------------------------------------------
// loadCollection
// ---------------------------------------------------------------------------

describe('loadCollection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads and parses a valid collection file', () => {
    const col = { info: { name: 'Test', schema: 'x' }, item: [] };
    const filePath = path.join(tmpDir, 'test.json');
    fs.writeFileSync(filePath, JSON.stringify(col));
    expect(loadCollection(filePath).info.name).toBe('Test');
  });

  it('throws when the file does not exist', () => {
    expect(() => loadCollection(path.join(tmpDir, 'missing.json'))).toThrow('not found');
  });

  it('throws on invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{invalid');
    expect(() => loadCollection(filePath)).toThrow('parse');
  });
});

// ---------------------------------------------------------------------------
// resolveCollectionPath
// ---------------------------------------------------------------------------

describe('resolveCollectionPath', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-test-')));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an absolute path when an explicit override is given', () => {
    const result = resolveCollectionPath('/absolute/path/col.json');
    expect(result).toBe('/absolute/path/col.json');
  });

  it('resolves a relative override against cwd', () => {
    const result = resolveCollectionPath('relative/col.json');
expect(result).toBe(path.join(tmpDir, 'relative/col.json'));
  });

  it('auto-discovers a *.postman_collection.json in dev/Postman/', () => {
    const dir = path.join(tmpDir, 'dev', 'Postman');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'My API.postman_collection.json'), '{}');
    expect(resolveCollectionPath()).toContain('My API.postman_collection.json');
  });

  it('returns the alphabetically first collection when multiple exist', () => {
    const dir = path.join(tmpDir, 'dev', 'Postman');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'beta.postman_collection.json'), '{}');
    fs.writeFileSync(path.join(dir, 'alpha.postman_collection.json'), '{}');
    expect(resolveCollectionPath()).toContain('alpha.postman_collection.json');
  });

  it('throws when no collection can be found', () => {
    expect(() => resolveCollectionPath()).toThrow('No collection file found');
  });
});

// ---------------------------------------------------------------------------
// resolveEnvironmentPath
// ---------------------------------------------------------------------------

describe('resolveEnvironmentPath', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-test-')));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the explicit override when given', () => {
    expect(resolveEnvironmentPath('/abs/env.json')).toBe('/abs/env.json');
  });

  it('returns undefined when no dev/Postman/ dir and no override', () => {
    expect(resolveEnvironmentPath()).toBeUndefined();
  });

  it('auto-discovers the first *.postman_environment.json', () => {
    const dir = path.join(tmpDir, 'dev', 'Postman');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-env.postman_environment.json'), '{}');
    expect(resolveEnvironmentPath()).toContain('my-env.postman_environment.json');
  });

  it('returns the alphabetically first file when multiple exist', () => {
    const dir = path.join(tmpDir, 'dev', 'Postman');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'staging.postman_environment.json'), '{}');
    fs.writeFileSync(path.join(dir, 'local.postman_environment.json'), '{}');
    expect(resolveEnvironmentPath()).toContain('local.postman_environment.json');
  });
});
