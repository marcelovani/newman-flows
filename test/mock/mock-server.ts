#!/usr/bin/env node
'use strict';

/**
 * mock-server.ts
 *
 * A lightweight Express server that mocks every API endpoint used by the
 * Postman collection. State (organisations, invitations) is held in memory
 * so that variables set by one request (e.g. organisation_id) are available
 * to subsequent requests in the same flow.
 *
 * Exported as createApp() so Vitest integration tests can start/stop it
 * programmatically. When run directly, it starts on PORT (default 3000).
 *
 * Usage (standalone):
 *   npm run mock          # starts on port 3000
 *   PORT=4000 npm run mock
 */

import express, { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

interface Org {
  id: string;
  name: string;
  members: { id: string; email: string }[];
}

interface Invitation {
  id: string;
  orgId: string;
  email: string;
  status: 'pending' | 'accepted';
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
  const orgs: Record<string, Org> = {};
  const invitations: Record<string, Invitation> = {};

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
    res.status(200).json({ access_token: token, user: { id: `user-${uid()}`, email: username } });
  });

  // ---------------------------------------------------------------------------
  // Organisations
  // ---------------------------------------------------------------------------

  app.post('/api/organisations', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = `org-${uid()}`;
    orgs[id] = { id, name, members: [{ id: `user-${uid()}`, email: 'admin@example.com' }] };
    res.status(201).json(orgs[id]);
  });

  app.patch('/api/organisations/:id', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const org = orgs[req.params.id];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (req.body.name) org.name = req.body.name;
    res.status(200).json(org);
  });

  app.get('/api/organisations/:id', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const org = orgs[req.params.id];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    res.status(200).json(org);
  });

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  app.post('/api/organisations/:id/invitations', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const org = orgs[req.params.id];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    const id = `inv-${uid()}`;
    invitations[id] = { id, orgId: req.params.id, email, status: 'pending' };
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
    const org = orgs[inv.orgId];
    if (org) org.members.push({ id: `user-${uid()}`, email: inv.email });
    res.status(200).json({ status: 'accepted', invitationId: inv.id });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Standalone entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[mock] Server listening at http://localhost:${PORT}`);
    console.log(`[mock] Endpoints:`);
    console.log(`[mock]   GET    /health`);
    console.log(`[mock]   POST   /api/auth/login`);
    console.log(`[mock]   POST   /api/organisations`);
    console.log(`[mock]   PATCH  /api/organisations/:id`);
    console.log(`[mock]   GET    /api/organisations/:id`);
    console.log(`[mock]   POST   /api/organisations/:id/invitations`);
    console.log(`[mock]   POST   /api/invitations/:id/accept`);
  });
}
