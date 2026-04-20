/**
 * Mock server for the my-api example collection.
 * Implements exactly the endpoints the two flows exercise.
 *
 * Exports createServer() so integration tests can start and stop it
 * programmatically. When run directly, it starts on PORT (default 8080).
 *
 * Usage (standalone):
 *   node examples/my-api/mock-server.js
 *   # then in another terminal:
 *   npx newman-flows run --all \
 *     --collection ./examples/my-api/my-api.postman_collection.json \
 *     --env ./examples/my-api/local.postman_environment.json
 */

'use strict';

const http = require('http');

// Known users — login validates against this table.
const USERS = {
  'admin@example.com': { id: 'user-admin', email: 'admin@example.com', password: 'password' },
  'member@example.com': { id: 'user-member', email: 'member@example.com', password: 'password' },
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function hasAuth(req) {
  return (req.headers.authorization || '').startsWith('Bearer ');
}

/**
 * Create a new http.Server with its own fresh in-memory state.
 * Each call returns an independent server instance — safe for parallel tests.
 */
function createServer() {
  const items = [];
  const invitations = [];
  const members = {}; // { [item_id]: [{id, email}, ...] }

  return http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;

    // GET /health
    if (method === 'GET' && url === '/health') {
      return send(res, 200, { status: 'ok' });
    }

    // POST /api/auth/login
    if (method === 'POST' && url === '/api/auth/login') {
      const body = await readBody(req);
      if (!body.username || !body.password) {
        return send(res, 400, { error: 'username and password are required' });
      }
      const user = USERS[body.username];
      if (!user || user.password !== body.password) {
        return send(res, 401, { error: 'Invalid credentials' });
      }
      return send(res, 200, {
        access_token: `mock-token-${user.id}-${uid()}`,
        user: { id: user.id, email: user.email },
      });
    }

    // All routes below require a Bearer token.
    if (!hasAuth(req)) {
      return send(res, 401, { error: 'Missing or invalid Authorization header' });
    }

    // POST /api/items
    if (method === 'POST' && url === '/api/items') {
      const body = await readBody(req);
      if (!body.name) return send(res, 400, { error: 'name is required' });
      const item = { id: uid(), name: body.name, status: body.status || 'active' };
      items.push(item);
      return send(res, 201, item);
    }

    // GET /api/items
    if (method === 'GET' && url === '/api/items') {
      return send(res, 200, items);
    }

    // PATCH /api/items/:id
    const patchItem = url.match(/^\/api\/items\/([^/]+)$/);
    if (method === 'PATCH' && patchItem) {
      const body = await readBody(req);
      const item = items.find((i) => i.id === patchItem[1]);
      if (!item) return send(res, 404, { error: 'Not found' });
      Object.assign(item, body);
      return send(res, 200, item);
    }

    // GET /api/items/:id
    const getItem = url.match(/^\/api\/items\/([^/]+)$/);
    if (method === 'GET' && getItem) {
      const item = items.find((i) => i.id === getItem[1]);
      if (!item) return send(res, 404, { error: 'Not found' });
      return send(res, 200, item);
    }

    // POST /api/items/:id/invitations
    const createInvitation = url.match(/^\/api\/items\/([^/]+)\/invitations$/);
    if (method === 'POST' && createInvitation) {
      const body = await readBody(req);
      if (!items.find((i) => i.id === createInvitation[1])) {
        return send(res, 404, { error: 'Not found' });
      }
      if (!body.email) return send(res, 400, { error: 'email is required' });
      const inv = {
        id: uid(),
        item_id: createInvitation[1],
        invitee_email: body.email,
        status: 'pending',
      };
      invitations.push(inv);
      return send(res, 201, inv);
    }

    // POST /api/invitations/:id/accept
    const acceptInvitation = url.match(/^\/api\/invitations\/([^/]+)\/accept$/);
    if (method === 'POST' && acceptInvitation) {
      const inv = invitations.find((i) => i.id === acceptInvitation[1]);
      if (!inv) return send(res, 404, { error: 'Not found' });
      if (inv.status === 'accepted') {
        return send(res, 409, { error: 'Invitation already accepted' });
      }
      inv.status = 'accepted';
      const invitedUser = Object.values(USERS).find((u) => u.email === inv.invitee_email);
      if (invitedUser) {
        if (!members[inv.item_id]) members[inv.item_id] = [];
        if (!members[inv.item_id].find((m) => m.id === invitedUser.id)) {
          members[inv.item_id].push({ id: invitedUser.id, email: invitedUser.email });
        }
      }
      return send(res, 200, { status: 'accepted' });
    }

    // GET /api/items/:id/members
    const getMembers = url.match(/^\/api\/items\/([^/]+)\/members$/);
    if (method === 'GET' && getMembers) {
      return send(res, 200, members[getMembers[1]] || []);
    }

    send(res, 404, { error: 'Not found' });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  createServer().listen(PORT, () => {
    console.log(`Mock server running on http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop.');
  });
}
