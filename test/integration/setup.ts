/**
 * Vitest integration test setup.
 *
 * Starts the mock server before all tests in the integration project and
 * shuts it down afterwards. The server binds to a random free port (or the
 * port in MOCK_PORT env var) so it never conflicts with other local services.
 * The actual port and base URL are exported as live `let` bindings — test
 * files that use them inside callbacks will always see the resolved values.
 */

import * as http from 'http';
import { afterAll, beforeAll } from 'vitest';
import { createApp } from '../mock/mock-server';

export let MOCK_PORT = Number(process.env.MOCK_PORT) || 0;
export let MOCK_BASE_URL = '';

let server: http.Server;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(MOCK_PORT, () => {
      const addr = server.address();
      MOCK_PORT = typeof addr === 'object' && addr !== null ? addr.port : MOCK_PORT;
      MOCK_BASE_URL = `http://localhost:${MOCK_PORT}`;
      resolve();
    });
    server.once('error', reject);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});
