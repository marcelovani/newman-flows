import { afterEach, describe, expect, it } from 'vitest';
import { buildCliArgs, runPostmanCli } from '../../src/lib/postman-cli.js';

describe('buildCliArgs', () => {
  it('runs the collection with the cli reporter by default', () => {
    expect(buildCliArgs({ collectionPath: 'flow.json' })).toEqual([
      'collection',
      'run',
      'flow.json',
      '-k',
      '--no-report-events',
      '-r',
      'cli',
    ]);
  });

  it('passes the environment', () => {
    expect(buildCliArgs({ collectionPath: 'flow.json', envPath: 'env.json' })).toContain('-e');
    expect(buildCliArgs({ collectionPath: 'flow.json', envPath: 'env.json' })).toContain(
      'env.json',
    );
  });

  it('passes reporters and their export paths', () => {
    const args = buildCliArgs({
      collectionPath: 'flow.json',
      reporters: ['cli', 'json', 'junit'],
      reporter: { json: { export: 'out/' }, junit: { export: 'out/results.xml' } },
    });
    expect(args.slice(args.indexOf('-r'))).toEqual([
      '-r',
      'cli,json,junit',
      '--reporter-json-export',
      'out/',
      '--reporter-junit-export',
      'out/results.xml',
    ]);
  });

  it('takes htmlextra as the built-in html reporter', () => {
    const args = buildCliArgs({
      collectionPath: 'flow.json',
      reporters: 'cli,htmlextra'.split(','),
      reporter: { htmlextra: { export: 'report.html' } },
    });
    expect(args).toContain('cli,html');
    expect(args).toContain('--reporter-html-export');
    expect(args).not.toContain('htmlextra');
  });

  it('ignores reporter options with no export path', () => {
    const args = buildCliArgs({ collectionPath: 'flow.json', reporter: { json: {} } });
    expect(args.some((a) => a.startsWith('--reporter-'))).toBe(false);
  });
});

describe('runPostmanCli', () => {
  const saved = process.env.POSTMAN_CLI;
  afterEach(() => {
    if (saved === undefined) delete process.env.POSTMAN_CLI;
    else process.env.POSTMAN_CLI = saved;
  });

  it('says how to install the CLI when it is missing', async () => {
    process.env.POSTMAN_CLI = '/nonexistent/postman';
    await expect(runPostmanCli({ collectionPath: 'flow.json' })).rejects.toThrow(
      /Postman CLI not found.*POSTMAN_CLI/,
    );
  });
});
