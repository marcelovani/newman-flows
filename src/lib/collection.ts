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

const POSTMAN_DIR = path.join('dev', 'Postman');

/**
 * Resolve the collection file path.
 *
 * Resolution order:
 *   1. Explicit override (--collection flag or programmatic option)
 *   2. First *.postman_collection.json in <cwd>/dev/Postman/
 *   3. Throws with a helpful message
 */
export function resolveCollectionPath(override?: string): string {
  if (override) return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);

  const dir = path.join(process.cwd(), POSTMAN_DIR);
  if (fs.existsSync(dir)) {
    const match = fs
      .readdirSync(dir)
      .sort()
      .find((f) => f.endsWith('.postman_collection.json'));
    if (match) return path.join(dir, match);
  }

  throw new Error(
    `No collection file found. Pass --collection <path> or place a *.postman_collection.json in ${POSTMAN_DIR}/`,
  );
}

/**
 * Resolve the Postman environment file path.
 *
 * Resolution order:
 *   1. Explicit override (--env flag or programmatic option)
 *   2. First *.postman_environment.json in <cwd>/dev/Postman/ (alphabetical)
 *   3. undefined (Newman runs without an environment file)
 *
 * When multiple environment files exist (e.g. one per environment), pass
 * --env <path> to select the one you want.
 */
export function resolveEnvironmentPath(override?: string): string | undefined {
  if (override) return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);

  const dir = path.join(process.cwd(), POSTMAN_DIR);
  if (!fs.existsSync(dir)) return undefined;

  const files = fs
    .readdirSync(dir)
    .sort()
    .filter((f) => f.endsWith('.postman_environment.json'));
  if (files.length === 0) return undefined;

  return path.join(dir, files[0]);
}
