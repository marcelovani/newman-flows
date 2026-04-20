/**
 * Collection loading and request lookup helpers.
 *
 * All path resolution uses process.cwd() so the CLI binary works from any
 * consumer project directory, regardless of where the package is installed.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PostmanCollection, PostmanItem } from './types.js';

// ---------------------------------------------------------------------------
// Tree traversal
// ---------------------------------------------------------------------------

/** Depth-first search for a folder (item with sub-items) by name. */
export function findFolder(items: PostmanItem[], name: string): PostmanItem | null {
  for (const item of items) {
    if (item.item && item.name === name) return item;
    if (item.item) {
      const found = findFolder(item.item, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Depth-first search for a request (leaf item) by name.
 * Folders are traversed but never returned. The first match wins, which
 * means Requests/ items are found before any same-named entry in Flows/.
 */
export function findRequest(items: PostmanItem[], name: string): PostmanItem | null {
  for (const item of items) {
    if (item.item) {
      const found = findRequest(item.item, name);
      if (found) return found;
    } else if (item.name === name) {
      return item;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collection loading
// ---------------------------------------------------------------------------

/** Read and parse a collection file. Throws on missing file or bad JSON. */
export function loadCollection(filePath: string): PostmanCollection {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch {
    throw new Error(`Collection file not found: ${resolved}`);
  }
  try {
    return JSON.parse(raw) as PostmanCollection;
  } catch (e) {
    throw new Error(`Failed to parse collection JSON at ${resolved}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Path auto-discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.nyc_output',
  '.turbo',
  'vendor',
]);

/**
 * Recursively find all files ending with `suffix` under `rootDir`,
 * skipping common non-source directories.
 *
 * Results are sorted shallower-first, then alphabetically, so a file at
 * `postman/col.json` is preferred over `src/tests/postman/col.json`.
 */
function findFilesRecursively(rootDir: string, suffix: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  walk(rootDir);
  results.sort((a, b) => {
    const depthDiff = a.split(path.sep).length - b.split(path.sep).length;
    return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
  });
  return results;
}

/**
 * Resolve the collection file path.
 *
 * Resolution order:
 *   1. Explicit override (--collection flag or programmatic option)
 *   2. First *.postman_collection.json found recursively under cwd
 *      (shallower paths preferred; alphabetical on ties)
 *   3. Throws with a helpful message
 */
export function resolveCollectionPath(override?: string): string {
  if (override) return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);

  const matches = findFilesRecursively(process.cwd(), '.postman_collection.json');

  if (matches.length > 1) {
    const rel = matches.map((f) => path.relative(process.cwd(), f));
    console.warn(
      `Warning: multiple collection files found:\n` +
        rel.map((f) => `  ${f}`).join('\n') +
        `\nUsing "${rel[0]}". Pass --collection <path> to select a different one.`,
    );
  }
  if (matches.length > 0) return matches[0];

  throw new Error(
    `No collection file found. Pass --collection <path> or add a *.postman_collection.json anywhere in your project.`,
  );
}

/**
 * Resolve the Postman environment file path.
 *
 * Resolution order:
 *   1. Explicit override (--env flag or programmatic option)
 *   2. First *.postman_environment.json found recursively under cwd
 *      (shallower paths preferred; alphabetical on ties)
 *   3. undefined (Newman runs without an environment file)
 *
 * When multiple environment files exist (e.g. one per environment), pass
 * --env <path> to select the one you want.
 */
export function resolveEnvironmentPath(override?: string): string | undefined {
  if (override) return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);

  const files = findFilesRecursively(process.cwd(), '.postman_environment.json');
  if (files.length === 0) return undefined;

  if (files.length > 1) {
    const rel = files.map((f) => path.relative(process.cwd(), f));
    console.warn(
      `Warning: multiple environment files found:\n` +
        rel.map((f) => `  ${f}`).join('\n') +
        `\nUsing "${rel[0]}". Pass --env <path> to select a different one.`,
    );
  }
  return files[0];
}
