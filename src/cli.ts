#!/usr/bin/env node
/**
 * newman-flows CLI entry point.
 *
 * Usage:
 *   newman-flows list                        # list all flows in the collection
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
import pkg from '../package.json';
import { printFlowList } from './commands/list.js';
import { runAllFlows, runFlow } from './commands/run.js';
import { printValidationResult, validateCollection } from './commands/validate.js';
import { loadCollection, resolveCollectionPath } from './lib/collection.js';

const program = new Command();

program
  .name('newman-flows')
  .description('Run multi-step Postman flows via Newman — no Enterprise required.')
  .version(pkg.version, '-V, --version');

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

program
  .command('list')
  .description('List all flows defined in the collection with their step counts')
  .option('--collection <path>', 'path to the Postman collection JSON file')
  .action((opts: { collection?: string }) => {
    try {
      const collectionPath = resolveCollectionPath(opts.collection);
      const collection = loadCollection(collectionPath);
      printFlowList(collection);
    } catch (err) {
      console.error((err as Error).message ?? err);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// run subcommand
// ---------------------------------------------------------------------------

program
  .command('run [flow-name]')
  .description('Run a flow (or all flows with --all)')
  .option('--all', 'run every flow defined in the Flows/ folder')
  .option('--collection <path>', 'path to the Postman collection JSON file')
  .option('--env <path>', 'path to a Postman environment JSON file')
  .option('--reporters <list>', 'comma-separated list of Newman reporters (default: cli)')
  .option('--reporter-junit-export <path>', 'export path for the JUnit XML report')
  .option('--reporter-htmlextra-export <path>', 'export path for the HTML report')
  .option('--reporter-json-export <path>', 'export path for the JSON report')
  .action(
    async (
      flowName: string | undefined,
      opts: {
        all?: boolean;
        collection?: string;
        env?: string;
        reporters?: string;
        reporterJunitExport?: string;
        reporterHtmlextraExport?: string;
        reporterJsonExport?: string;
      },
    ) => {
      try {
        const reporters = opts.reporters
          ? opts.reporters.split(',').map((r) => r.trim())
          : undefined;

        const reporter: Record<string, unknown> = {};
        if (opts.reporterJunitExport) reporter['junit'] = { export: opts.reporterJunitExport };
        if (opts.reporterHtmlextraExport)
          reporter['htmlextra'] = { export: opts.reporterHtmlextraExport };
        if (opts.reporterJsonExport) reporter['json'] = { export: opts.reporterJsonExport };

        if (opts.all) {
          await runAllFlows({
            collection: resolveCollectionPath(opts.collection),
            env: opts.env,
            reporters,
            reporter: Object.keys(reporter).length ? reporter : undefined,
          });
        } else if (flowName) {
          await runFlow({
            collection: resolveCollectionPath(opts.collection),
            flow: flowName,
            env: opts.env,
            reporters,
            reporter: Object.keys(reporter).length ? reporter : undefined,
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
    },
  );

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
      const valid = printValidationResult(result);
      if (!valid) process.exit(1);
    } catch (err) {
      console.error((err as Error).message ?? err);
      process.exit(1);
    }
  });

program.parse(process.argv);
