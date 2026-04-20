# newman-flows

[![npm version](https://img.shields.io/npm/v/newman-flows)](https://www.npmjs.com/package/newman-flows)
[![npm downloads](https://img.shields.io/npm/dm/newman-flows)](https://www.npmjs.com/package/newman-flows)
[![license](https://img.shields.io/npm/l/newman-flows)](LICENSE)

> Multi-step Postman flow runner for the free plan — no Enterprise required.

`newman-flows` sits on top of [Newman](https://github.com/postmanlabs/newman) and adds the one thing Newman doesn't have: **flows**. A flow is an ordered sequence of named requests drawn from your Postman collection. Each request is defined exactly once; a flow just lists the steps to run and in what order.

---

## Installation

```bash
npm install --save-dev newman-flows
```

Newman itself is a peer dependency and installs automatically.

---

## How it works

### Collection structure

Organise your Postman collection into two top-level folders:

```
My API (collection)
├── Requests/          ← every request lives here exactly once
│   ├── Auth/
│   ├── Users/
│   └── Orders/
└── Flows/             ← flat; each entry is a flow definition
    ├── Create order
    └── Cancel order
```

Requests are defined **exactly once** in `Requests/`. Flows only reference them by name — no duplication, no copy-paste.

### Flow definitions

Each entry in `Flows/` is a Postman request with:

- **Method:** `FLOW` (type it literally in Postman's method dropdown)
- **Name:** the flow name, used on the command line
- **Pre-request script:** calls `steps([...])` with the ordered step names

```javascript
// Run: newman-flows run "Create and edit item"
steps(['Admin login', 'Create Item', 'Edit Item', 'View Item']);
```

Step names must **exactly match** request names in `Requests/`.

### Variables between steps

Earlier steps set `pm.globals` variables that later steps consume:

```javascript
// In "Create Item" test script:
pm.globals.set('item_id', pm.response.json().id);

// In "Edit Item" request URL:
{{base_url}}/api/items/{{item_id}}
```

### A complete request

Every request has three parts. Here is a POST that creates a resource, saves its ID, and validates the response:

**URL:** `{{base_url}}/api/items`

**Headers:**

```
Authorization: Bearer {{admin_access_token}}
Content-Type: application/json
```

**Body:**

```json
{
  "name": "My test item",
  "status": "active"
}
```

**Tests tab:**

```javascript
pm.test('Status code is 201', () => pm.response.to.have.status(201));

const json = pm.response.json();

pm.test('Response has an id', () => {
  pm.expect(json.id).to.be.a('string').and.not.empty;
  pm.globals.set('item_id', json.id);
});

pm.test('Name matches input', () => {
  pm.expect(json.name).to.equal('My test item');
});

pm.test('Status is a known value', () => {
  const validStatuses = ['active', 'inactive', 'pending'];
  pm.expect(validStatuses).to.include(json.status);
});
```

Rules:

- Declare `const json = pm.response.json()` once; reference it in every test below
- One named `pm.test()` per logical assertion — names appear in the test report
- Store globals _inside_ the test that validates the value; if the value is bad, the set is skipped
- Bodies must use `{{variable_name}}` — never hardcode IDs

### Multi-persona flows

When a flow involves two actors, each needs its own named token. If both logins write to the same `access_token`, the second overwrites the first and earlier requests fail with 401.

Each login step saves a distinct variable:

```javascript
// "Admin login" — Tests tab:
pm.test('Status code is 200', () => pm.response.to.have.status(200));

const json = pm.response.json();

pm.test('Access token present', () => {
  pm.expect(json.access_token).to.be.a('string').and.not.empty;
  pm.globals.set('admin_access_token', json.access_token);
});
```

```javascript
// "Member login" — Tests tab:
// same pattern, different variable name:
pm.globals.set('member_access_token', json.access_token);
```

Each request then uses the correct token explicitly:

- `Authorization: Bearer {{admin_access_token}}`
- `Authorization: Bearer {{member_access_token}}`

The flow definition comments make the data flow visible at a glance:

```javascript
// Run: newman-flows run "Member invitation"
steps([
  'Admin login', // sets admin_access_token
  'Member login', // sets member_access_token + member_id
  'Create Item', // uses admin_access_token → sets item_id
  'Invite Member', // uses admin_access_token + item_id → sets invitation_id
  'Accept Invitation', // uses member_access_token + invitation_id
  'View Members', // asserts member_id appears in the list
]);
```

---

## Running flows

Export your collection from Postman (`File → Export → Collection v2.1`) and commit it to your repo.

`newman-flows` auto-discovers your collection and environment files by scanning all subdirectories of your project (skipping `node_modules`, `dist`, etc.) — just run:

```bash
# List available flows
npx newman-flows list

# Run one flow
npx newman-flows run "My flow name"

# Run all flows
npx newman-flows run --all

# Validate — checks every step name resolves to a real request
npx newman-flows validate
```

Both files can be overridden when needed (e.g. staging, CI, multiple env files):

```bash
npx newman-flows run --all \
  --collection ./postman/my-api.postman_collection.json \
  --env ./postman/staging.postman_environment.json
```

**In npm scripts:**

```json
{
  "scripts": {
    "test:flow": "newman-flows run",
    "test:flows": "newman-flows run --all"
  }
}
```

```bash
npm run test:flows
npm run test:flow -- "My flow name"
```

---

## Reports

`newman-flows` passes reporter flags straight to Newman:

```bash
mkdir -p test/results/newman && npx newman-flows run --all \
  --reporters cli,junit,htmlextra \
  --reporter-junit-export ./test/results/newman/results.xml \
  --reporter-htmlextra-export ./test/results/newman/report.html
```

Programmatic API:

```typescript
await runAllFlows({
  collection: './postman/my-api.postman_collection.json',
  reporters: ['cli', 'junit'],
  reporter: {
    junit: { export: './test/results/newman/results.xml' },
  },
});
```

---

## Testing against a mock server

Run flows without a real backend using [json-server](https://github.com/typicode/json-server):

```bash
npm install --save-dev json-server
```

Create `dev/mock/db.json`:

```json
{
  "items": [{ "id": "abc-123", "name": "Test item", "status": "active" }],
  "members": []
}
```

Start the mock and run your flows:

```bash
npx json-server --watch dev/mock/db.json --port 3001 &
npx newman-flows run --all --env ./postman/local.postman_environment.json
```

Set `base_url` to `http://localhost:3001` in your environment file.

---

## JavaScript test patterns

All assertions go in the **Tests** tab of a Postman request. Declare `const json` once, then one named `pm.test()` per logical assertion.

### Login response

```javascript
pm.test('Status code is 200', () => pm.response.to.have.status(200));

const json = pm.response.json();

pm.test('Access token present', () => {
  pm.expect(json.access_token).to.be.a('string').and.not.empty;
  pm.globals.set('admin_access_token', json.access_token);
});

pm.test('User email looks valid', () => {
  pm.expect(json.user.email).to.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});
```

### List response

```javascript
pm.test('Status code is 200', () => pm.response.to.have.status(200));

const json = pm.response.json();

pm.test('Response is a non-empty array', () => {
  pm.expect(json).to.be.an('array').that.is.not.empty;
});

pm.test('Each record has id and name', () => {
  json.forEach((record) => {
    pm.expect(record.id).to.be.a('string').and.not.empty;
    pm.expect(record.name).to.be.a('string').and.not.empty;
  });
});
```

### Assert a specific item appears in a list

```javascript
pm.test('Invited member appears in members list', () => {
  const ids = json.map((m) => m.id);
  pm.expect(ids).to.include(pm.globals.get('member_id'));
});
```

### Cross-step value check

```javascript
pm.test('Invitee email matches the member we invited', () => {
  pm.expect(json.invitee_email).to.equal(pm.globals.get('member_email'));
});
```

### Negative test

```javascript
pm.test('Forbidden', () => pm.response.to.have.status(403));

pm.test('No data leaked in error response', () => {
  pm.expect(pm.response.json()).to.not.have.property('data');
});
```

---

## CI

```yaml
- name: Run all flows
  run: |
    mkdir -p test/results/newman
    npx newman-flows run --all \
      --reporters cli,junit \
      --reporter-junit-export ./test/results/newman/results.xml

- name: Upload flow reports
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: newman-flows-results
    path: test/results/newman
    retention-days: 7
```

---

## Examples

A complete, runnable example collection is in [`examples/my-api/`](examples/my-api/). It demonstrates both a single-persona and a multi-persona flow with full test scripts. See the [example README](examples/my-api/README.md) for a step-by-step walkthrough.

---

## Development

Use `npm link` to test the package locally without publishing:

```bash
npm link
newman-flows --version
newman-flows run --all --collection ./path/to/collection.json
npm unlink -g newman-flows
```

Or use `npm pack` to produce a tarball and install it anywhere:

```bash
npm pack
npm install -g ./newman-flows-x.y.z.tgz
```

### Releasing

```bash
# Bump version, commit, and tag
npm version patch   # or: minor / major

# Push commit + tag — triggers the publish workflow
git push origin main --follow-tags
```

The CI pipeline runs the full test suite then publishes to npm. The first publish must be done manually (`npm run build && npm publish --access public`); all subsequent releases are automated.

---

## Background

For the full story on why this tool exists — the Postman Enterprise paywall, why Newman folders don't solve the problem, and how the temporary-collection approach works — see [medium-post.md](medium-post.md).

---

## License

Apache-2.0
