#!/usr/bin/env node
'use strict';

/**
 * test.js
 *
 * Starts the mock server, runs every flow in dev/Postman/flows/ in order,
 * then shuts down the server.
 *
 * Usage:
 *   npm test
 *   node test.js
 */

const { spawn, spawnSync } = require('child_process');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT        = process.env.PORT || 3000;
const FLOWS_DIR   = path.join(__dirname, 'dev/Postman/flows');
const MAX_WAIT_MS = 10_000;
const POLL_MS     = 250;

// ---------------------------------------------------------------------------
// Start mock server
// ---------------------------------------------------------------------------

console.log(`[test] Starting mock server on port ${PORT}...`);

const server = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) },
});

let exitCode = 0;

function cleanup() {
  if (!server.killed) {
    console.log('\n[test] Stopping mock server...');
    server.kill();
  }
}

process.on('exit', cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// ---------------------------------------------------------------------------
// Poll /health until the server is ready
// ---------------------------------------------------------------------------

function waitForServer(deadline) {
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) {
        return reject(new Error('Mock server did not start in time.'));
      }
      http.get(`http://localhost:${PORT}/health`, res => {
        if (res.statusCode === 200) return resolve();
        setTimeout(attempt, POLL_MS);
      }).on('error', () => setTimeout(attempt, POLL_MS));
    }
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Run all flows
// ---------------------------------------------------------------------------

(async () => {
  try {
    await waitForServer(Date.now() + MAX_WAIT_MS);
    console.log('[test] Server is ready.\n');
  } catch (err) {
    console.error(`[test] ${err.message}`);
    process.exit(1);
  }

  const flowFiles = fs.readdirSync(FLOWS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  for (const file of flowFiles) {
    const flowDef = JSON.parse(fs.readFileSync(path.join(FLOWS_DIR, file), 'utf8'));

    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'dev/Postman/run-flow.js'), flowDef.name],
      {
        stdio: 'inherit',
        env: { ...process.env, ENV: 'mock', PORT: String(PORT) },
      }
    );

    if (result.status !== 0) {
      exitCode = result.status || 1;
      break;
    }
  }

  cleanup();
  process.exit(exitCode);
})();
