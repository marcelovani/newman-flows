# Example: My API

A complete, runnable example of a `newman-flows` collection. It demonstrates the three main patterns — a single-persona flow, a multi-persona flow, and one request run as several actors with step variables — using a simple Items API.

---

## Files

| File                             | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `my-api.postman_collection.json` | The Postman collection with all requests and flow definitions |
| `local.postman_environment.json` | Environment variables (points to `http://localhost:8080`)     |
| `mock-server.js`                 | Local mock server — implements all endpoints the flows use    |

---

## Running the examples

Start the included mock server first (no dependencies, plain Node.js):

```bash
node examples/my-api/mock-server.js
```

Then in a second terminal:

```bash
# List available flows
npx newman-flows list --collection ./examples/my-api/my-api.postman_collection.json

# Run a single flow
npx newman-flows run "Create and edit item" \
  --collection ./examples/my-api/my-api.postman_collection.json \
  --env ./examples/my-api/local.postman_environment.json

# Run all flows
npx newman-flows run --all \
  --collection ./examples/my-api/my-api.postman_collection.json \
  --env ./examples/my-api/local.postman_environment.json
```

---

## Collection structure

```
my-api.postman_collection.json
├── Requests/                  ← every request defined exactly once
│   ├── Auth/
│   │   ├── Admin login
│   │   └── Member login
│   ├── Items/
│   │   ├── Create Item
│   │   ├── Edit Item
│   │   ├── View Item
│   │   ├── View Item As Actor ← run once per actor, via step variables
│   │   └── List Items
│   ├── Invitations/
│   │   ├── Invite Member
│   │   └── Accept Invitation
│   └── Members/
│       └── View Members
└── Flows/                     ← each entry is a FLOW-method request
    ├── Create and edit item   ← single-persona flow
    ├── Member invitation      ← multi-persona flow
    └── Item access by actor   ← one request, several actors (step variables)
```

Requests are defined **exactly once**. Flows reference them by name — no duplication.

---

## Environment variables

| Variable          | Set in           | Used by                                |
| ----------------- | ---------------- | -------------------------------------- |
| `base_url`        | Environment file | Every request URL                      |
| `admin_username`  | Environment file | Admin login body                       |
| `admin_password`  | Environment file | Admin login body                       |
| `member_username` | Environment file | Member login body + Invite Member body |
| `member_password` | Environment file | Member login body                      |

---

## Globals (set at runtime by test scripts)

These are not in the environment file — they are written by one step and read by the next.

| Variable              | Set by        | Used by                                                                    |
| --------------------- | ------------- | -------------------------------------------------------------------------- |
| `admin_access_token`  | Admin login   | Create Item, Edit Item, View Item, List Items, Invite Member, View Members |
| `member_access_token` | Member login  | Accept Invitation, View Item As Actor                                      |
| `member_id`           | Member login  | View Members (asserts member appears)                                      |
| `member_email`        | Member login  | Invite Member body                                                         |
| `item_id`             | Create Item   | Edit Item, View Item, Invite Member, View Members                          |
| `invitation_id`       | Invite Member | Accept Invitation                                                          |

---

## Flow 1 — Create and edit item (single persona)

The admin logs in, creates an item, edits it, and views it to verify the change persisted.

```
Admin login  →  Create Item  →  Edit Item  →  View Item
     ↓               ↓
admin_access_token  item_id
```

**What each step tests:**

| Step        | Assertions                                                              |
| ----------- | ----------------------------------------------------------------------- |
| Admin login | 200; `access_token` is a non-empty string; user has `id` and `email`    |
| Create Item | 201; response has `id`; `name` matches input; `status` is a known value |
| Edit Item   | 200; `name` reflects the update                                         |
| View Item   | 200; `id` matches the one we created; `name` reflects the edit          |

---

## Flow 2 — Member invitation (multi-persona)

The admin and member both log in up front (saving separate tokens), the admin creates an item and invites the member, the member accepts, and the admin verifies the member list.

```
Admin login ──→ admin_access_token
Member login ─→ member_access_token, member_id, member_email
                     ↓
               Create Item ──→ item_id
                     ↓
               Invite Member ──→ invitation_id
                     ↓
               Accept Invitation  (uses member_access_token)
                     ↓
               View Members  ──→ asserts member_id is in the list
```

**Why two named tokens?** If both logins stored their result in the same `access_token` variable, the second login would overwrite it. Each persona gets its own variable (`admin_access_token`, `member_access_token`) and every request explicitly uses the correct one.

---

## Flow 3 — Item access by actor (step variables)

One request, `View Item As Actor`, run three times. Each step passes the actor making the call and the status that actor should get, instead of keeping a copy of the request per actor.

```javascript
steps([
  'Admin login',
  'Member login',
  'Create Item',
  { step: 'View Item As Actor', vars: { actor: 'admin', expected_status: 200 } },
  { step: 'View Item As Actor', vars: { actor: 'member', expected_status: 200 } },
  { step: 'View Item As Actor', vars: { actor: 'anonymous', expected_status: 401 } },
]);
```

The request's pre-request script picks the `<actor>_access_token` global, or sends no `Authorization` header when there is none, and its test asserts `expected_status` (200 by default). The report lists each run separately, e.g. `View Item As Actor [actor=anonymous, expected_status=401]`.

| Step                                   | Assertions |
| -------------------------------------- | ---------- |
| View Item As Actor `[actor=admin]`     | 200        |
| View Item As Actor `[actor=member]`    | 200        |
| View Item As Actor `[actor=anonymous]` | 401        |

---

## Request anatomy

Each request in `Requests/` follows the same three-part structure:

### 1. URL and headers

Use `{{variable_name}}` for any value that changes between environments or that a previous step sets at runtime:

```
{{base_url}}/api/items/{{item_id}}
Authorization: Bearer {{admin_access_token}}
```

### 2. Body (for POST / PATCH)

Same rule — no hardcoded IDs:

```json
{
  "email": "{{member_username}}"
}
```

### 3. Tests tab

Declare `const json` once, then one `pm.test()` per logical assertion. Store globals inside the test that validates the value — if the value is wrong, the set is skipped and later steps fail with a clear message rather than silently using a bad value:

```javascript
pm.test('Status code is 201', () => pm.response.to.have.status(201));

const json = pm.response.json();

pm.test('Response has an id', () => {
  pm.expect(json.id).to.be.a('string').and.not.empty;
  pm.globals.set('item_id', json.id);
});

pm.test('Name matches input', () => {
  pm.expect(json.name).to.equal('Test item');
});
```

---

## Flow definition anatomy

Each flow lives in the `Flows/` folder as a request with method `FLOW`. The pre-request script calls `steps([...])` with the ordered step names. Names must match request names in `Requests/` exactly.

```javascript
// Multi-persona flow: admin creates an item and invites a member;
// member logs in and accepts; admin verifies the member list.
// Run: npx newman-flows run "Member invitation"
steps([
  'Admin login', // sets admin_access_token
  'Member login', // sets member_access_token + member_id + member_email
  'Create Item', // uses admin_access_token → sets item_id
  'Invite Member', // uses admin_access_token + item_id + member_email → sets invitation_id
  'Accept Invitation', // uses member_access_token + invitation_id
  'View Members', // uses admin_access_token + item_id — asserts member_id appears
]);
```

Comments on each step show which globals it reads and which it sets. This makes the data flow visible without opening each request.

---

## Running against the mock server

A ready-to-use mock server is included at `mock-server.js`. It implements all the endpoints the two flows exercise, including auth, invitations, and member state. No dependencies — it runs with plain Node.js.

**To reproduce the full example from scratch:**

```bash
# 1. Clone the repo and install
git clone https://github.com/your-org/newman-flows.git
cd newman-flows
npm install

# 2. Start the mock server (leave this running in one terminal)
node examples/my-api/mock-server.js

# 3. In a second terminal, run all flows
npx newman-flows run --all \
  --collection ./examples/my-api/my-api.postman_collection.json \
  --env ./examples/my-api/local.postman_environment.json
```

Expected output:

```
✅ Flow "Create and edit item" passed.
✅ Flow "Member invitation" passed.
✅ All flows passed.
```

The mock resets its in-memory state on each restart, so every run starts clean.
