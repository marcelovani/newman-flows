/**
 * Runs a collection file through the Postman CLI.
 *
 * The CLI is not a dependency of this package: it is a native binary of
 * several hundred megabytes, so it is installed the way Postman documents
 * (https://learning.postman.com/docs/postman-cli/postman-cli-installation/)
 * and found on PATH, or at the path in the POSTMAN_CLI environment variable.
 */

import { spawn } from 'child_process';
import type { Readable, Writable } from 'stream';

export const INSTALL_URL =
  'https://learning.postman.com/docs/postman-cli/postman-cli-installation/';

/**
 * Notices the CLI prints on every run without a Postman login. Runs here are
 * local and never published to Postman cloud, so they say nothing useful, and
 * the CLI has no option to turn them off.
 */
const LOGIN_NOTICES = [
  /^No authorization data found\. Please use the `postman login` command\.$/,
  /^Refer:\s*https:\/\/learning\.postman\.com\/docs\/postman-cli\/postman-cli-options\/#postman-login$/,
  /^Postman credentials are required for publishing run details to Postman cloud\.$/,
  /^Please specify it by using the `postman login` command$/,
];

export interface CliRunOptions {
  /** Path to the collection file to run. */
  collectionPath: string;
  /** Path to a Postman environment file. */
  envPath?: string;
  /** Reporters to activate. Defaults to `cli`. */
  reporters?: string | string[];
  /** Per-reporter options; only `export` is passed on. */
  reporter?: Record<string, unknown>;
}

/** newman's htmlextra reporter is the CLI's built-in html one. */
function reporterName(name: string): string {
  return name === 'htmlextra' ? 'html' : name;
}

/** Build the `postman` arguments for a run. Exported for unit-testability. */
export function buildCliArgs(opts: CliRunOptions): string[] {
  const args = ['collection', 'run', opts.collectionPath];
  if (opts.envPath) args.push('-e', opts.envPath);
  // Same as newman's `insecure: true`: local stacks use self-signed certificates.
  args.push('-k', '--no-report-events');

  const reporters = [opts.reporters ?? 'cli'].flat().map(reporterName);
  args.push('-r', [...new Set(reporters)].join(','));

  for (const [name, config] of Object.entries(opts.reporter ?? {})) {
    const exportPath = (config as { export?: unknown } | undefined)?.export;
    if (typeof exportPath === 'string') {
      args.push(`--reporter-${reporterName(name)}-export`, exportPath);
    }
  }
  return args;
}

/** Copy a stream line by line, leaving out the login notices. */
function pipeFiltered(from: Readable, to: Writable): void {
  let pending = '';
  from.setEncoding('utf8');
  from.on('data', (chunk: string) => {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!LOGIN_NOTICES.some((re) => re.test(line.trim()))) to.write(line + '\n');
    }
  });
  from.on('end', () => {
    if (pending && !LOGIN_NOTICES.some((re) => re.test(pending.trim()))) to.write(pending);
  });
}

/**
 * Run the CLI and resolve with its exit code: 0 when every test passed.
 *
 * @throws {Error} If the CLI is not installed.
 */
export function runPostmanCli(opts: CliRunOptions): Promise<number> {
  const bin = process.env.POSTMAN_CLI || 'postman';
  return new Promise((resolve, reject) => {
    const child = spawn(bin, buildCliArgs(opts), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, POSTMAN_CLI_SKIP_UPDATE_CHECK: '1' },
    });
    pipeFiltered(child.stdout, process.stdout);
    pipeFiltered(child.stderr, process.stderr);

    child.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `Postman CLI not found ("${bin}"). Install it (${INSTALL_URL}) ` +
              'or set POSTMAN_CLI to its path.',
          ),
        );
        return;
      }
      reject(err);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
