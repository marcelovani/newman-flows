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

Flow definitions live **inside the Postman collection** under a `Flows/` folder. Each flow is a request with method `FLOW`, named after the flow. Its pre-request script calls `steps([...])` with the ordered step names:

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

`newman-flows` finds the matching request in `Flows/`, evaluates the pre-request script in a Node.js `vm` sandbox to capture the steps array, looks up each named request anywhere in the collection, assembles a temporary flat collection, and passes it to `newman.run()`.

Requests are defined **exactly once** in your collection. Flows only reference them by name. No duplication.

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

## Background

For the full story on why this tool exists — the Postman Enterprise paywall, why Newman folders don't solve the problem, and how the temporary-collection approach works — see [medium-post.md](medium-post.md) or the published article on Medium.

---

## License

Apache-2.0
