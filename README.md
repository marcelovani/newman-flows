# newman-flows

> Multi-step Postman flow runner for the free plan — no Enterprise required.

`newman-flows` sits on top of [Newman](https://github.com/postmanlabs/newman) and adds the one thing Newman doesn't have: **flows**. A flow is an ordered sequence of named requests drawn from your Postman collection. Each request is defined exactly once; a flow just lists the steps to run and in what order.

```bash
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

### Run against a specific environment

```bash
npx newman-flows run "Org admin creates org" --env docker
npx newman-flows run --all --env docker
```

### Validate the collection

Checks that all flow definitions are well-formed and every step name resolves to a real request:

```bash
npx newman-flows validate
```

### In npm scripts (no `npx` needed)

```json
{
  "scripts": {
    "test:flow": "newman-flows run",
    "test:flows": "newman-flows run --all",
    "validate": "newman-flows validate"
  }
}
```

```bash
npm run test:flow -- "Org admin creates org"
npm run test:flows
npm run validate
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
steps([
  "Org admin login",
  "Create Organization",
  "Edit Organization",
  "View Organization",
]);
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

## Collection path

By default `newman-flows` looks for a `*.postman_collection.json` file in `<cwd>/dev/Postman/`. Override with a flag:

```bash
npx newman-flows run --all --collection ./path/to/my.postman_collection.json
```

---

## Reports

Results are written to `tests/results/newman/`:

| File          | Format                     |
| ------------- | -------------------------- |
| `results.xml` | JUnit XML (consumed by CI) |
| `report.html` | Human-readable HTML report |

---

## CI

```yaml
- name: Run all flows
  run: npx newman-flows run --all

- name: Upload flow reports
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: newman-flows-results
    path: tests/results/newman
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

```bash
# 1. Bump the version (updates package.json and creates a git tag)
npm version patch   # or minor / major

# 2. Push the commit and tag
git push origin newman-flows --follow-tags

# 3. Publish (builds automatically via prepublishOnly, then publishes)
npm publish
```

CI will automate step 3 in Phase 4: a `publish.yml` workflow triggers on `v*` tag pushes, runs the full test suite, then calls `npm publish` using an `NPM_TOKEN` secret stored in the GitHub repository settings.

---

## Background

For the full story on why this tool exists — the Postman Enterprise paywall, why Newman folders don't solve the problem, and how the temporary-collection approach works — see [medium-post.md](medium-post.md) or the published article on Medium.

---

## License

Apache-2.0
