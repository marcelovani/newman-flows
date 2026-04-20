/**
 * Integration tests for the mock server.
 *
 * These tests validate that the mock API behaves correctly end-to-end.
 * They run against the server started in setup.ts and serve as the
 * foundation for Phase 1 flow-runner integration tests.
 */

import { describe, expect, it } from 'vitest';
import { MOCK_BASE_URL } from './setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${MOCK_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, token: string) {
  return fetch(`${MOCK_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token: string) {
  return fetch(`${MOCK_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('health', () => {
  it('returns ok', async () => {
    const res = await fetch(`${MOCK_BASE_URL}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns an access_token', async () => {
    const res = await post('/api/auth/login', {
      username: 'admin@example.com',
      password: 'secret',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('access_token');
    expect(typeof json.access_token).toBe('string');
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await post('/api/auth/login', {});
    expect(res.status).toBe(400);
  });

  it('returns distinct tokens for different users', async () => {
    const [a, b] = await Promise.all([
      post('/api/auth/login', { username: 'admin@example.com', password: 'secret' }),
      post('/api/auth/login', { username: 'member@example.com', password: 'secret' }),
    ]);
    const [jsonA, jsonB] = await Promise.all([a.json(), b.json()]);
    expect(jsonA.access_token).not.toBe(jsonB.access_token);
  });
});

// ---------------------------------------------------------------------------
// Item creation flow
// ---------------------------------------------------------------------------

describe('Item creation flow', () => {
  it('logs in → creates → edits → views', async () => {
    const loginRes = await post('/api/auth/login', {
      username: 'admin@example.com',
      password: 'secret',
    });
    const { access_token } = await loginRes.json();

    const createRes = await post('/api/items', { name: 'Test Item' }, access_token);
    expect(createRes.status).toBe(201);
    const item = await createRes.json();
    expect(item).toHaveProperty('id');
    expect(item.name).toBe('Test Item');

    const editRes = await patch(
      `/api/items/${item.id}`,
      { name: 'Test Item (updated)' },
      access_token,
    );
    expect(editRes.status).toBe(200);
    const edited = await editRes.json();
    expect(edited.name).toBe('Test Item (updated)');

    const viewRes = await get(`/api/items/${item.id}`, access_token);
    expect(viewRes.status).toBe(200);
    const viewed = await viewRes.json();
    expect(viewed.id).toBe(item.id);
    expect(viewed.name).toBe('Test Item (updated)');
  });

  it('returns 401 without auth token', async () => {
    const res = await post('/api/items', { name: 'Test Item' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown item', async () => {
    const loginRes = await post('/api/auth/login', {
      username: 'admin@example.com',
      password: 'secret',
    });
    const { access_token } = await loginRes.json();
    const res = await get('/api/items/does-not-exist', access_token);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Member invitation flow
// ---------------------------------------------------------------------------

describe('Member invitation flow', () => {
  it('admin invites member → member accepts → member appears in members list', async () => {
    const [adminLogin, memberLogin] = await Promise.all([
      post('/api/auth/login', { username: 'admin@example.com', password: 'secret' }),
      post('/api/auth/login', { username: 'member@example.com', password: 'secret' }),
    ]);
    const { access_token: adminToken } = await adminLogin.json();
    const { access_token: memberToken } = await memberLogin.json();

    const item = await (await post('/api/items', { name: 'Invite Test Item' }, adminToken)).json();

    const invRes = await post(
      `/api/items/${item.id}/invitations`,
      { email: 'member@example.com' },
      adminToken,
    );
    expect(invRes.status).toBe(201);
    const inv = await invRes.json();
    expect(inv).toHaveProperty('id');
    expect(inv.status).toBe('pending');

    const acceptRes = await post(`/api/invitations/${inv.id}/accept`, {}, memberToken);
    expect(acceptRes.status).toBe(200);
    const accepted = await acceptRes.json();
    expect(accepted.status).toBe('accepted');

    const membersRes = await get(`/api/items/${item.id}/members`, adminToken);
    expect(membersRes.status).toBe(200);
    const membersList = await membersRes.json();
    expect(membersList.some((m: { email: string }) => m.email === 'member@example.com')).toBe(true);
  });

  it('returns 409 if invitation already accepted', async () => {
    const loginRes = await post('/api/auth/login', {
      username: 'admin@example.com',
      password: 'secret',
    });
    const { access_token } = await loginRes.json();

    const item = await (
      await post('/api/items', { name: 'Double Accept Item' }, access_token)
    ).json();
    const inv = await (
      await post(`/api/items/${item.id}/invitations`, { email: 'x@example.com' }, access_token)
    ).json();

    await post(`/api/invitations/${inv.id}/accept`, {}, access_token);
    const res = await post(`/api/invitations/${inv.id}/accept`, {}, access_token);
    expect(res.status).toBe(409);
  });
});
