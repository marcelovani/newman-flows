#!/usr/bin/env node
/**
 * newman-flows CLI entry point.
 *
 * Usage:
 *   newman-flows run "Flow name"             # run one flow
 *   newman-flows run --all                   # run all flows in Flows/ folder
 *   newman-flows run "Flow name" --env docker
 *   newman-flows run --all --collection ./my.postman_collection.json
 *   newman-flows validate                    # validate the collection
 *   newman-flows validate --collection ./my.postman_collection.json
 *   newman-flows --version
 *   newman-flows --help
 */

import { Command } from 'commander';
import { runAllFlows, runFlow } from './commands/run.js';
import { loadCollection, resolveCollectionPath } from './lib/collection.js';
import { printValidationResult, validateCollection } from './commands/validate.js';
import pkg from '../package.json';

const program = new Command();

program
  .name('newman-flows')
  .description('Run multi-step Postman flows via Newman — no Enterprise required.')
  .version(pkg.version, '-V, --version');

// ---------------------------------------------------------------------------
// run subcommand
// ---------------------------------------------------------------------------

program
  .command('run [flow-name]')
  .description('Run a flow (or all flows with --all)')
  .option('--all', 'run every flow defined in the Flows/ folder')
  .option('--collection <path>', 'path to the Postman collection JSON file')
  .option('--env <path>', 'path to a Postman environment JSON file')
  .option('--results-dir <path>', 'directory for junit XML and HTML reports')
  .action(async (flowName: string | undefined, opts: {
    all?: boolean;
    collection?: string;
    env?: string;
    resultsDir?: string;
  }) => {
    try {
      if (opts.all) {
        await runAllFlows({
          collection: resolveCollectionPath(opts.collection),
          env: opts.env,
          resultsDir: opts.resultsDir,
        });
      } else if (flowName) {
        await runFlow({
          collection: resolveCollectionPath(opts.collection),
          flow: flowName,
          env: opts.env,
          resultsDir: opts.resultsDir,
        });
      } else {
        console.error('Provide a flow name or --all.\n');
        program.commands.find((c) => c.name() === 'run')?.help();
        process.exit(1);
      }
    } catch (err) {
      console.error((err as Error).message ?? err);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// validate subcommand
// ---------------------------------------------------------------------------

program
  .command('validate')
  .description('Validate the collection structure and all flow definitions')
  .option('--collection <path>', 'path to the Postman collection JSON file')
  .action((opts: { collection?: string }) => {
    try {
      const collectionPath = resolveCollectionPath(opts.collection);
      const collection = loadCollection(collectionPath);
      const result = validateCollection(collection);
      const valid = printValidationResult(result, collection);
      if (!valid) process.exit(1);
    } catch (err) {
      console.error((err as Error).message ?? err);
      process.exit(1);
    }
  });

program.parse(process.argv);
