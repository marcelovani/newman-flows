#!/usr/bin/env node
'use strict';

/**
 * run-flow.js
 *
 * Runs a named Postman flow against a live API using Newman.
 *
 * A "flow" is defined as a JSON file in dev/Postman/flows/ that lists the
 * names of requests to execute in order. Each request is looked up by name
 * in the main Postman collection — no duplication required.
 *
 * Usage:
 *   node dev/Postman/run-flow.js "Organisation creation"
 *   node dev/Postman/run-flow.js "Member invitation" --env ci
 *
 * Or via Make:
 *   make test-newman FLOW="Organisation creation"
 *   make test-newman-flows
 */

const fs   = require('fs');
const path = require('path');
const newman = require('newman');

// ---------------------------------------------------------------------------
// Resolve arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node run-flow.js "<Flow name>" [--env local|ci]');
  process.exit(1);
}

const flowName = args[0];
const envFlag  = args.indexOf('--env') !== -1 ? args[args.indexOf('--env') + 1] : null;
const envKey   = envFlag || process.env.ENV || 'local';

// ---------------------------------------------------------------------------
// Resolve file paths
// ---------------------------------------------------------------------------

const root           = path.resolve(__dirname, '../..');
const collectionFile = path.join(__dirname, 'collection/my-api.postman_collection.json');
const envFile        = path.join(__dirname, `environments/environment.${envKey}.postman_environment.json`);
const flowsDir       = path.join(__dirname, 'flows');
const resultsDir     = path.join(root, 'tests/results/newman');

if (!fs.existsSync(collectionFile)) {
  console.error(`Collection not found: ${collectionFile}`);
  process.exit(1);
}

if (!fs.existsSync(envFile)) {
  console.error(`Environment file not found: ${envFile}`);
  console.error(`Expected one of: environments/environment.local.postman_environment.json, environments/environment.ci.postman_environment.json`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Find the flow definition
// ---------------------------------------------------------------------------

const flowFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith('.json'));
let flowDef = null;

for (const file of flowFiles) {
  const candidate = JSON.parse(fs.readFileSync(path.join(flowsDir, file), 'utf8'));
  if (candidate.name === flowName) {
    flowDef = candidate;
    break;
  }
}

if (!flowDef) {
  console.error(`Flow "${flowName}" not found in ${flowsDir}`);
  console.error(`Available flows: ${flowFiles.map(f => require(path.join(flowsDir, f)).name).join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the collection
// ---------------------------------------------------------------------------

const collection = JSON.parse(fs.readFileSync(collectionFile, 'utf8'));

// ---------------------------------------------------------------------------
// Find a request by name anywhere in the collection (recursive)
// ---------------------------------------------------------------------------

function findRequest(items, name) {
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
// Assemble a temporary flat collection from the flow's step list
// ---------------------------------------------------------------------------

console.log(`\n▶ Running flow: ${flowDef.name}`);
console.log(`  Steps: ${flowDef.steps.join(' → ')}\n`);

const flowItems = flowDef.steps.map(stepName => {
  const req = findRequest(collection.item, stepName);
  if (!req) {
    console.error(`  ✗ Step "${stepName}" not found in the collection.`);
    console.error(`    Check that the request name matches exactly (case-sensitive).`);
    process.exit(1);
  }
  return req;
});

const tempCollection = {
  info: {
    ...collection.info,
    name: `${collection.info.name} — Flow: ${flowDef.name}`,
  },
  // Do NOT carry over collection-level variables. If we include them (even with
  // empty values), they shadow globals set by pm.globals.set() in test scripts,
  // because collection scope has higher priority than global scope in Newman's
  // variable resolution. Omitting them lets globals resolve correctly.
  auth: collection.auth,
  item: flowItems,
};

// ---------------------------------------------------------------------------
// Ensure output directory exists
// ---------------------------------------------------------------------------

fs.mkdirSync(resultsDir, { recursive: true });

const safeFlowName = flowDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ---------------------------------------------------------------------------
// Run with Newman
// ---------------------------------------------------------------------------

newman.run(
  {
    collection:  tempCollection,
    environment: envFile,
    reporters:   ['cli', 'junit', 'htmlextra'],
    reporter: {
      junit: {
        export: path.join(resultsDir, `${safeFlowName}.xml`),
      },
      htmlextra: {
        export: path.join(resultsDir, `${safeFlowName}.html`),
      },
    },
  },
  (err, summary) => {
    if (err) {
      console.error(`Newman error: ${err.message}`);
      process.exit(1);
    }

    const failures = summary.run.failures.length;
    if (failures > 0) {
      console.error(`\n✗ Flow "${flowDef.name}" failed (${failures} assertion failure${failures > 1 ? 's' : ''}).`);
      process.exit(1);
    }

    console.log(`\n✅ Flow "${flowDef.name}" passed.`);
  }
);
