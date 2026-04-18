# newman-flows

> Multi-step Postman flow runner for the free plan — no Enterprise required.

`newman-flows` sits on top of [Newman](https://github.com/postmanlabs/newman) and adds the one thing Newman doesn't have: **flows**. A flow is an ordered sequence of named requests drawn from your Postman collection. Each request is defined exactly once; a flow just lists the steps to run and in what order.

```bash
npx newman-flows list
npx newman-flows run "Org admin creates org"
npx newman-flows run --all
npx newman-flows validate
```

---

## How it relates to Newman

Newman runs a collection. `newman-flows` decides _which_ collection to assemble and in _what order_, then hands it to Newman:

```
newman-flows
  └── reads flow definitions from the Postman collection (Flows/ folder)
  └── assembles a temporary flat collection per flow
  └── calls newman.run() for each flow    ← Newman lives here
  └── aggregates and reports pass / fail
```

Newman is a runtime dependency — it updates independently, and `newman-flows` benefits from every Newman bug fix automatically. The relationship is the same as `jest` and `node`.

---

## Installation

```bash
# In your project
npm install --save-dev newman-flows

# Or globally
npm install -g newman-flows
```

Newman itself is a peer dependency and installs automatically.

---

## Usage

### Run a single flow

```bash
npx newman-flows run "Org admin creates org"
```

### Run all flows

```bash
npx newman-flows run --all
```

### Point to a specific collection or environment

```bash
npx newman-flows run "Org admin creates org" \
  --collection ./dev/Postman/my-api.postman_collection.json \
  --env ./dev/Postman/staging.postman_environment.json

npx newman-flows run --all \
  --collection ./dev/Postman/my-api.postman_collection.json
```

### Save reports

```bash
npx newman-flows run --all \
  --reporters cli,junit,htmlextra \
  --reporter-junit-export ./test/results/newman/results.xml \
  --reporter-htmlextra-export ./test/results/newman/report.html
```

### List flows

Prints every flow in the collection with its step count — useful for discovering what's available before running:

```bash
npx newman-flows list
npx newman-flows list --collection ./dev/Postman/my-api.postman_collection.json
```

Example output:

```
Flows in "My API":

  • Org admin creates org       (4 steps)
  • Invite member to org        (5 steps)
  • User Updates password       (4 steps)
```

### Validate the collection

Checks that all flow definitions are well-formed and every step name resolves to a real request:

```bash
npx newman-flows validate
npx newman-flows validate --collection ./dev/Postman/my-api.postman_collection.json
```

### In npm scripts (no `npx` needed)

```json
{
  "scripts": {
    "list:flows": "newman-flows list",
    "test:flow": "newman-flows run",
    "test:flows": "newman-flows run --all",
    "validate:collection": "newman-flows validate"
  }
}
```

```bash
npm run list:flows
npm run test:flow -- "Org admin creates org"
npm run test:flows
npm run validate:collection
```

---

## How flows work

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

Requests are defined **exactly once** in `Requests/`. Flows only reference them by name. No duplication, no copy-paste.

### Flow definitions

Each entry in `Flows/` is a Postman request with:

- **Method:** `FLOW` (type it literally in Postman's method dropdown — it is not a standard HTTP verb, it is a convention that makes flow definitions visually distinct in the sidebar)
- **Name:** the flow name, used to select the flow on the command line
- **Pre-request script:** calls `steps([...])` with the ordered step names

```javascript
// Org admin logs in, creates an organisation, edits it, and views it.
// Run: newman-flows run "Org admin creates org"
steps(['Org admin login', 'Create Organization', 'Edit Organization', 'View Organization']);
```

Step names must **exactly match** request names in `Requests/`.

### What the runner does

`newman-flows` finds the matching `Flows/` request, evaluates the pre-request script in a Node.js `vm` sandbox to capture the steps array, looks up each named request anywhere in the collection, assembles a **temporary flat collection** containing only those requests in that order, and passes it to `newman.run()`.

The temporary collection is never written to disk — it exists only in memory for the duration of the run.

### Variables between steps

Newman runs each step in sequence. Earlier steps can set `pm.globals` variables that later steps consume — the standard Postman variable mechanism works unchanged:

```javascript
// In "Create Organization" test script:
pm.globals.set("org_uuid", pm.response.json().data.id);

// In "Edit Organization" request URL:
{{url}}/api/v1/organization/{{org_uuid}}
```

### Keeping the collection in your repo

Export the collection from Postman desktop (`File → Export → Collection v2.1`) and commit it alongside your code. By convention, `newman-flows` looks for it in `<project>/dev/Postman/` — but you can point it anywhere with `--collection`.

---

## File discovery

`newman-flows` resolves the collection and environment from `process.cwd()` — the directory you run the command from. When used via `npm run`, that is always the project root.

### Collection

Resolution order:

1. `--collection <path>` flag (absolute or relative to cwd)
2. First `*.postman_collection.json` found in `<cwd>/dev/Postman/` (alphabetical — deterministic when multiple files exist)
3. Error with a helpful message

```bash
# Auto-discovered from dev/Postman/
npx newman-flows run --all

# Explicit override
npx newman-flows run --all --collection ./path/to/my.postman_collection.json
```

### Environment

Resolution order:

1. `--env <path>` flag (absolute or relative to cwd)
2. First `*.postman_environment.json` in `<cwd>/dev/Postman/` (alphabetical)
3. No environment file — Newman runs without one

```bash
# Auto-discovered (alphabetically first env file in dev/Postman/)
npx newman-flows run --all

# Explicit path — use this when you have multiple env files
npx newman-flows run --all --env ./dev/Postman/staging.postman_environment.json
```

When your project has multiple environment files (local, staging, CI, etc.), pass `--env` explicitly rather than relying on auto-discovery.

---

## Reports

`newman-flows` does not manage reporters — it passes your reporter configuration straight to Newman. By default only the `cli` reporter runs and nothing is written to disk.

To save reports, pass the same reporter flags you would use with Newman directly:

```bash
# JUnit XML only
npx newman-flows run --all \
  --reporters cli,junit \
  --reporter-junit-export ./test/results/newman/results.xml

# JUnit XML + HTML report
npx newman-flows run --all \
  --reporters cli,junit,htmlextra \
  --reporter-junit-export ./test/results/newman/results.xml \
  --reporter-htmlextra-export ./test/results/newman/report.html

# JSON report
npx newman-flows run --all \
  --reporters cli,json \
  --reporter-json-export ./test/results/newman/results.json
```

The output directory must exist before running, or you can create it in the same command:

```bash
mkdir -p test/results/newman && npx newman-flows run --all \
  --reporters cli,junit \
  --reporter-junit-export ./test/results/newman/results.xml
```

### Programmatic API

Pass `reporters` and `reporter` directly — they map 1-to-1 to Newman's own options:

```typescript
await runAllFlows({
  collection: './dev/Postman/my-api.postman_collection.json',
  reporters: ['cli', 'junit', 'htmlextra'],
  reporter: {
    junit:     { export: './test/results/newman/results.xml' },
    htmlextra: { export: './test/results/newman/report.html' },
  },
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

## Development

### Testing the global install locally

Use `npm link` to symlink the local package into the global bin without touching the npm registry. The `prepare` script builds automatically:

```bash
npm link

newman-flows --version
newman-flows --help
newman-flows run --all --collection ./path/to/collection.json
```

To unlink when done:

```bash
npm unlink -g newman-flows
```

Alternatively, `npm pack` produces a tarball you can install anywhere — useful for testing what consumers will actually receive:

```bash
npm pack                                   # produces newman-flows-x.y.z.tgz
npm install -g ./newman-flows-x.y.z.tgz
newman-flows --version
```

### Tagging and releasing

See [New releases](#new-releases) below.

---

## New releases

Releases are published to npm automatically when a version tag is pushed. The CI pipeline ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) runs the full test suite first — if anything fails, nothing is published.

### Prerequisites (one-time setup)

Add an `NPM_TOKEN` secret to the GitHub repository:

1. Go to [npmjs.com](https://www.npmjs.com) → **Access Tokens → Generate New Token → Automation**
2. Copy the token
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token from step 2

### Releasing a new version

```bash
# 1. Bump the version — updates package.json, commits, and creates a git tag
npm version patch   # or: minor / major

# 2. Push the commit and the tag — this triggers the publish workflow
git push origin newman-flows --follow-tags
```

The workflow builds the package, runs lint + typecheck + unit + integration tests, then publishes to npm with [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) — a verified link between the published package and this exact git commit, shown as a badge on npmjs.com.

### First publish

The automated workflow requires the package name to already exist on npm. Run the first publish manually:

```bash
npm run build
npm publish --access public
```

All subsequent releases go through the tag → CI → npm pipeline.

---

## Background

For the full story on why this tool exists — the Postman Enterprise paywall, why Newman folders don't solve the problem, and how the temporary-collection approach works — see [medium-post.md](medium-post.md) or the published article on Medium.

---

## License

Apache-2.0
