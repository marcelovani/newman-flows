#!/usr/bin/env node
'use strict';

/**
 * mock-server.ts
 *
 * A lightweight Express server that mocks every API endpoint used by the
 * examples/my-api/ Postman collection. State is held in memory so that
 * variables set by one request (e.g. item_id) are available to subsequent
 * requests in the same flow.
 *
 * Exported as createApp() so Vitest integration tests can start/stop it
 * programmatically. When run directly, it starts on PORT (default 8080).
 *
 * Usage (standalone):
 *   npm run mock          # starts on port 8080
 *   PORT=4000 npm run mock
 */

import express, { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// In-memory state types
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  name: string;
  status: string;
}

interface Invitation {
  id: string;
  itemId: string;
  invitee_email: string;
  status: 'pending' | 'accepted';
}

interface Member {
  id: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function requireAuth(req: Request, res: Response): boolean {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Factory — create a fresh app with its own in-memory state
// ---------------------------------------------------------------------------

export function createApp() {
  const items: Record<string, Item> = {};
  const invitations: Record<string, Invitation> = {};
  const members: Record<string, Member[]> = {}; // keyed by item_id

  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // ---------------------------------------------------------------------------
  // Authentication
  // POST /api/auth/login  — body: { username, password }
  // ---------------------------------------------------------------------------

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const token = `mock-token-${username.replace(/[^a-z0-9]/gi, '-')}-${uid()}`;
    const userId = `user-${username.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    res.status(200).json({ access_token: token, user: { id: userId, email: username } });
  });

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  app.post('/api/items', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const { name, status } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = uid();
    items[id] = { id, name, status: status || 'active' };
    res.status(201).json(items[id]);
  });

  app.get('/api/items', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    res.status(200).json(Object.values(items));
  });

  app.patch('/api/items/:id', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const item = items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.body.name) item.name = req.body.name;
    if (req.body.status) item.status = req.body.status;
    res.status(200).json(item);
  });

  app.get('/api/items/:id', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const item = items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.status(200).json(item);
  });

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  app.post('/api/items/:id/invitations', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const itemId = req.params.id;
    if (!items[itemId]) return res.status(404).json({ error: 'Item not found' });
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    const id = uid();
    invitations[id] = { id, itemId, invitee_email: email, status: 'pending' };
    res.status(201).json(invitations[id]);
  });

  app.post('/api/invitations/:id/accept', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const inv = invitations[req.params.id];
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status === 'accepted') {
      return res.status(409).json({ error: 'Invitation already accepted' });
    }
    inv.status = 'accepted';
    if (!members[inv.itemId]) members[inv.itemId] = [];
    const memberId = `user-${inv.invitee_email.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    members[inv.itemId].push({ id: memberId, email: inv.invitee_email });
    res.status(200).json({ status: 'accepted' });
  });

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  app.get('/api/items/:id/members', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    if (!items[req.params.id]) return res.status(404).json({ error: 'Item not found' });
    res.status(200).json(members[req.params.id] || []);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Standalone entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 8080;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[mock] Server listening at http://localhost:${PORT}`);
    console.log(`[mock] Endpoints:`);
    console.log(`[mock]   GET    /health`);
    console.log(`[mock]   POST   /api/auth/login`);
    console.log(`[mock]   POST   /api/items`);
    console.log(`[mock]   GET    /api/items`);
    console.log(`[mock]   PATCH  /api/items/:id`);
    console.log(`[mock]   GET    /api/items/:id`);
    console.log(`[mock]   POST   /api/items/:id/invitations`);
    console.log(`[mock]   POST   /api/invitations/:id/accept`);
    console.log(`[mock]   GET    /api/items/:id/members`);
  });
}
