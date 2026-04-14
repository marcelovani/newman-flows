# Running Postman Flows in CI Without Paying for Enterprise — Our Workaround

We hit a wall. We had a perfectly organised Postman collection, a clean CI pipeline,
and a desire to run multi-step API flows automatically on every pull request. The only
thing standing between us and that goal was a paywall.

Here's how we got around it — without duplicating a single request.

---

## The Problem: We Wanted Flows, Not Just Folders

Our backend exposes a JSON REST API. We use Postman to document and test every endpoint.
After a while, we noticed that individual endpoint tests were only telling half the story.
What we really needed to validate was *sequences* — the kind of flows a real client goes
through:

- An organisation admin logs in
- Creates an organisation
- Edits it
- Views it to confirm the changes persisted

Or the invitation flow:

- An organisation admin logs in and creates an organisation
- An organisation member logs in
- The organisation admin invites the member to join the organisation
- The member accepts the invitation

These aren't just endpoint tests. They're *user journeys* expressed as API calls.

Postman has a feature built for exactly this: **Flows**. It's a separate mode in the
desktop app — a visual canvas, distinct from the Collections view — where you drag
saved requests onto a board, connect them with arrows, and define the sequence without
writing any orchestration code. Each node represents a request from your collection;
variables pipe automatically from one step to the next.

<!-- SCREENSHOT 1: The Postman Flows canvas showing the "Organisation creation" flow.
     Open Postman → FLOWS section in the left sidebar → click the Organisation creation flow.
     The canvas should show the request nodes (Organisation admin login, Create Organisation,
     Edit Organisation, View Organisation) connected by arrows, with the variable
     bindings visible between steps. Capture the full canvas area. -->

We started building flows there. They were clear, they were maintainable, and they
made it immediately obvious how the API was meant to be used. Life was good.

Then we tried to run them in CI.

---

## The Limitation: Postman Flows Require Enterprise to Run from CLI

Postman has a separate CLI tool (distinct from Newman) that includes a
`postman flows run` command. We got excited. We [read the docs][flows-docs]. Then we hit this:

> `postman flows run` requires a Postman Enterprise plan.

<!-- SCREENSHOT 2: The Postman documentation or pricing page showing that
     "postman flows run" requires an Enterprise plan. Go to
     https://learning.postman.com/docs/postman-cli/postman-cli-options/ or the
     Postman pricing page and capture the section that mentions Enterprise as a
     requirement for running Flows from the CLI. -->


We're a small team. Enterprise pricing for a test-runner felt like a lot.

We searched for workarounds. The [community thread on running Flows in CI/CD][thread]
had been open since 2023 with no free solution in sight. The [GitHub issue][gh-issue]
requesting Newman support for Flows had accumulated plenty of 👍 reactions but no
resolution.

The fallback recommendation everywhere was: *convert your Flows to a Collection and
use Newman*.

Which brings us to the real problem.

---

## Why "Just Use a Folder" Doesn't Work

Newman runs Postman Collections. You can organise requests into folders and run a
specific folder with `--folder`. The obvious approach: create a folder per flow,
put the requests in the right order, and run each folder. Sounds like the answer, right?

There are two problems.

**First, there's no sequencing across folders.** If your flow needs requests that live
in different folders — a login request from `Authentication/`, a create request from
`Groups/` — you can't compose them into a sequence without copying them. There's no
concept of "run this request from over there, then this one from here." You'd have to
duplicate every request that appears in more than one flow.

**Second, that duplication compounds fast.** Our collection had duplicate "Invite User"
requests — one under `Organisation`, one under `Groups`. That's already two copies of
the same request definition. Every time the endpoint changed, we'd have to update
multiple places. Scale that across login requests, setup steps, and teardown, and
you have a maintenance nightmare.

<!-- SCREENSHOT 3: The Postman collection sidebar showing the old folder structure
     with duplicate requests. Expand the collection tree so both copies of "Invite User"
     are visible side by side under different parent folders. This illustrates the
     duplication problem directly. -->

Postman Flows solve this elegantly on the canvas — you drag the same request block
into multiple flows without duplicating anything. But in a Collection, there's no
concept of a reference or alias. A request can only live in one place.

---

## What We Tried First: `setNextRequest()`

Newman supports a lesser-known API called `pm.execution.setNextRequest()`. Call it
from a test script and Newman will jump to a different request — even one in a
different folder — instead of continuing sequentially.

The idea: keep all requests in a `Requests/` folder (defined once), add a `Flows/`
folder with lightweight "entry point" requests, and have each entry point set up a
sequence of step names, then jump to the first one. A collection-level test script
(the Tests tab at the Collection level, which runs after every request in the run)
would read the sequence and route each step to the next.

```javascript
// Collection-level test script — the "flow router"
const stepsJson = pm.globals.get('_flow_steps');
if (!stepsJson) return;

const steps = JSON.parse(stepsJson);
const idx = steps.indexOf(pm.info.requestName);

if (idx === -1) return;

const nextIdx = idx + 1;
if (nextIdx < steps.length) {
    pm.execution.setNextRequest(steps[nextIdx]);
} else {
    pm.globals.unset('_flow_steps');
    pm.execution.setNextRequest(null);
}
```

Each flow's entry point request writes the step list into a global variable and jumps
to the first step. The router above then takes over, advancing through the list after
each request completes:

```javascript
// "Start: Organisation creation" entry point — test script
const steps = [
    'Organisation admin login',
    'Create Organisation',
    'Edit Organisation',
    'View Organisation'
];
pm.globals.set('_flow_steps', JSON.stringify(steps));
pm.execution.setNextRequest(steps[0]);
```

We got excited. We ran it. This appeared in the terminal:

```
Attempting to set next request to Organisation admin login
```

And then Newman stopped. One request executed.

<!-- SCREENSHOT 4: Terminal output showing Newman running with --folder and stopping
     after the first request. The key thing to show is the "Attempting to set next
     request to Organisation admin login" line followed by Newman exiting with a summary of
     only 1 request executed (not the expected 4). Crop to show the relevant output. -->


The issue: when you pass `--folder "Organisation creation"` to Newman, it only *loads* the
requests in that folder. `setNextRequest()` can reference any loaded request — but
`Organisation admin login` was in `Requests/User/`, a completely separate folder. From Newman's
perspective, that request didn't exist in the current run.

`setNextRequest()` works across folders when you run the *entire* collection without
`--folder`. But then you have no way to run just one flow — you'd have to run
everything, and the router would need to somehow skip requests that aren't in the
active flow. The state management quickly becomes unmanageable.

---

## The Collection Structure

Before diving into the solution, it helps to understand how the collection and
repository are set up — this is the foundation everything else builds on.

The Postman collection is cleanly split into two top-level folders:

```
My API
├── Requests/          ← every request lives here exactly once
│   ├── User/
│   ├── Groups/
│   │   ├── Organisation/
│   │   └── Team/
│   ├── Authentication/
│   └── Media/
└── Flows/             ← documentation only, visible in Postman sidebar
    ├── Organisation creation/
    │   └── Start: Organisation creation
    └── Member invitation/
        └── Start: Member invitation
```

<!-- SCREENSHOT 5: The Postman collection sidebar showing this structure —
     the top-level "Requests/" folder expanded to show its sub-folders, and the
     "Flows/" folder expanded to show the "Organisation creation" documentation entry. -->

The `Flows/` folder exists purely for discoverability in the Postman desktop app.
Anyone opening the collection can see what flows exist and what steps they contain.
The actual execution comes from JSON files in the repository — one per flow.

On the repository side, the structure is equally minimal. The collection and
environment files are exported from Postman desktop and committed to version control —
the same files you would use with a plain Newman run:

```
project-root/
├── mock-server.js                               ← local Express mock API (npm run mock)
├── test.js                                      ← starts mock, runs all flows, stops mock (npm test)
└── dev/
    └── Postman/
        ├── collection/
        │   └── my-api.postman_collection.json   ← exported from Postman (File → Export → Collection v2.1)
        ├── environments/
        │   ├── environment.local.postman_environment.json
        │   ├── environment.ci.postman_environment.json
        │   └── environment.mock.postman_environment.json
        ├── flows/
        │   ├── org-creation.json               ← Organisation creation flow
        │   └── member-invitation.json          ← Member invitation flow
        └── run-flow.js                          ← assembles and runs a named flow
```

---

## The Solution: Generate a Temporary Collection

We stepped back and asked a simpler question: *what does Newman actually need?*

Newman needs a collection file. It doesn't care where that file came from. So instead
of trying to make the collection aware of flows at runtime, we generate a
**temporary, flat collection** containing exactly the requests for a given flow —
pulled from the main collection — and run Newman against that.

Requests are still defined exactly once. The flow definition is a tiny JSON file
listing step names in order. A Node.js script does the assembly.

### The flow definition

```json
// dev/Postman/flows/org-creation.json
{
  "name": "Organisation creation",
  "description": "Organisation admin logs in, creates an organisation, edits it, and views it.",
  "steps": [
    "Organisation admin login",
    "Create Organisation",
    "Edit Organisation",
    "View Organisation"
  ]
}
```

```json
// dev/Postman/flows/member-invitation.json
{
  "name": "Member invitation",
  "description": "Organisation admin creates an organisation, a member logs in separately, the admin sends an invitation, and the member accepts.",
  "steps": [
    "Organisation admin login",
    "Create Organisation",
    "Organisation member login",
    "Invite member",
    "Accept invitation"
  ]
}
```

### The runner script

`run-flow.js` takes two inputs that already exist in any Postman project:

- **The collection JSON** — exported from the Postman desktop app (`File → Export →
  Collection v2.1`). This is the file you'd normally pass to Newman directly. It
  contains every request definition, test script, and variable.
- **The environment JSON** — also exported from Postman. It holds the base URL,
  credentials, and any other environment-specific values Newman needs to run.

The script reads both files, looks up the named requests, assembles a temporary
collection, and hands it to Newman:

```javascript
// dev/Postman/run-flow.js (abridged)
const flowDef = JSON.parse(fs.readFileSync(flowFile, 'utf8'));

// Find each named request anywhere in the collection — no duplication needed
function findRequest(items, name) {
  for (const item of items) {
    if (item.item) {
      const found = findRequest(item.item, name);
      if (found) return found;
    } else if (item.name === name) {
      return item;
    }
  }
  return null;
}

const flowItems = flowDef.steps.map(stepName => {
  const req = findRequest(collection.item, stepName);
  if (!req) { console.error(`Step "${stepName}" not found`); process.exit(1); }
  return req;
});

// Assemble a flat, temporary collection
const tempCollection = {
  info: { ...collection.info, name: `Flow: ${flowDef.name}` },
  item: flowItems,
};

// Run Newman programmatically
newman.run({ collection: tempCollection, environment: envFile, ... });
```

### Running the flows

```bash
# Run all flows (starts and stops the mock server automatically)
npm test

# Run a single flow (requires mock server already running via `npm run mock`)
ENV=mock node dev/Postman/run-flow.js "Organisation creation"
```

### The output

<!-- SCREENSHOT 6: Terminal output of a passing npm test run. Run
     `npm test` locally and capture the full output — the mock server startup lines,
     both flow runs with their request lines and green tick assertions, and the
     final "Stopping mock server" line. -->

```
[test] Starting mock server on port 3000...
[mock] Server listening at http://localhost:3000
[mock] Endpoints:
[mock]   POST   /api/auth/login
[mock]   POST   /api/organisations
[mock]   PATCH  /api/organisations/:id
[mock]   GET    /api/organisations/:id
[mock]   POST   /api/organisations/:id/invitations
[mock]   POST   /api/invitations/:id/accept
[test] Server is ready.

▶ Running flow: Member invitation
  Steps: Organisation admin login → Create Organisation → Organisation member login → Invite member → Accept invitation

newman

My API — Flow: Member invitation

→ Organisation admin login
  POST http://localhost:3000/api/auth/login [200 OK, 366B, 23ms]
  ✓  Status code is 200
  ✓  Response has access_token

→ Create Organisation
  POST http://localhost:3000/api/organisations [201 Created, 368B, 3ms]
  ✓  Status code is 201
  ✓  Response has organisation id

→ Organisation member login
  POST http://localhost:3000/api/auth/login [200 OK, 368B, 1ms]
  ✓  Status code is 200
  ✓  Response has access_token

→ Invite member
  POST http://localhost:3000/api/organisations/org-8v7h0dxwmnyo0shv/invitations [201 Created, 349B, 2ms]
  ✓  Status code is 201
  ✓  Invitation created

→ Accept invitation
  POST http://localhost:3000/api/invitations/inv-i12wpdmtmnyo0sil/accept [200 OK, 294B, 3ms]
  ✓  Status code is 200

┌─────────────────────────┬─────────────────┬─────────────────┐
│                         │        executed │          failed │
├─────────────────────────┼─────────────────┼─────────────────┤
│              iterations │               1 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│                requests │               5 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│            test-scripts │               5 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│      prerequest-scripts │               0 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│              assertions │               9 │               0 │
├─────────────────────────┴─────────────────┴─────────────────┤
│ total run duration: 100ms                                   │
├─────────────────────────────────────────────────────────────┤
│ total data received: 556B (approx)                          │
├─────────────────────────────────────────────────────────────┤
│ average response time: 6ms [min: 1ms, max: 23ms, s.d.: 8ms] │
└─────────────────────────────────────────────────────────────┘

✅ Flow "Member invitation" passed.

▶ Running flow: Organisation creation
  Steps: Organisation admin login → Create Organisation → Edit Organisation → View Organisation

newman

My API — Flow: Organisation creation

→ Organisation admin login
  POST http://localhost:3000/api/auth/login [200 OK, 366B, 16ms]
  ✓  Status code is 200
  ✓  Response has access_token

→ Create Organisation
  POST http://localhost:3000/api/organisations [201 Created, 368B, 2ms]
  ✓  Status code is 201
  ✓  Response has organisation id

→ Edit Organisation
  PATCH http://localhost:3000/api/organisations/org-02v22y3pmnyo0sx9 [200 OK, 373B, 2ms]
  ✓  Status code is 200
  ✓  Name was updated

→ View Organisation
  GET http://localhost:3000/api/organisations/org-02v22y3pmnyo0sx9 [200 OK, 373B, 1ms]
  ✓  Status code is 200
  ✓  Creator is a member

┌─────────────────────────┬─────────────────┬─────────────────┐
│                         │        executed │          failed │
├─────────────────────────┼─────────────────┼─────────────────┤
│              iterations │               1 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│                requests │               4 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│            test-scripts │               4 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│      prerequest-scripts │               0 │               0 │
├─────────────────────────┼─────────────────┼─────────────────┤
│              assertions │               8 │               0 │
├─────────────────────────┴─────────────────┴─────────────────┤
│ total run duration: 78ms                                    │
├─────────────────────────────────────────────────────────────┤
│ total data received: 531B (approx)                          │
├─────────────────────────────────────────────────────────────┤
│ average response time: 5ms [min: 1ms, max: 16ms, s.d.: 6ms] │
└─────────────────────────────────────────────────────────────┘

✅ Flow "Organisation creation" passed.

[test] Stopping mock server...
```

---

## CI Integration

In GitHub Actions, the flows run automatically with a single command:

```yaml
- name: Run Newman — all flows
  run: npm test

- name: Store Newman artifacts
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: newman-results
    path: tests/results/newman
    retention-days: 5
```

Adding a new flow requires no changes to `run-flow.js` or the CI workflow. Drop a
new `.json` file into `dev/Postman/flows/` and it's automatically picked up on the
next run.

<!-- SCREENSHOT 7: A passing GitHub Actions run showing the two Newman steps
     ("Run Newman — all requests" and "Run Newman — all flows") both with green
     ticks, and the "newman-results" artifact listed in the Summary tab.
     Go to the Actions tab in your repo, open a successful run of the build-test
     workflow, and capture the job step list and the artifacts section. -->

---

## What We Gained

- **No duplication.** Requests are defined once. Flows are just ordered lists of names.
- **Works on the free plan.** No Newman patches, no Enterprise subscription, no
  cloud execution required.
- **Postman Flows still usable for design.** We kept the visual canvas for
  diagramming and documentation. The runner handles execution.
- **CI-friendly.** JUnit XML and HTML reports are generated for every flow run and
  uploaded as artifacts.
- **Self-discoverable.** `npm test` finds new flows automatically —
  adding a flow to CI is a one-file change.

---

## Limitations and What We're Watching

This approach is a workaround, not a first-class solution. A few honest caveats:

**`pm.execution.runRequest()` is the right answer — when it works.**
Postman shipped this API in 2025 and it does exactly what we wanted: invoke any saved
request from a script without duplication. The catch is it doesn't work in Newman yet.
If and when Newman gains support for it, our `run-flow.js` script becomes unnecessary.

**Step names must match exactly.** If someone renames a request in the Postman desktop
and exports the collection without updating the flow JSON, the runner will exit with a
helpful error message. It's a light coupling, but it's there.

**Parallel branches aren't supported.** Postman Flows can run request blocks in
parallel (the visual canvas supports it). Our sequential runner can't. For now, every
flow is a straight line — which covers the vast majority of API test scenarios.

---

## The Takeaway

To be blunt: this workaround is not as good as Postman Flows.

Flows give you a visual canvas where sequences are immediately legible — you can see
at a glance what connects to what, where variables flow between steps, and how branches
fork. Our JSON files and a Node.js script are a pale imitation of that. There's no
canvas, no visual debugging, no parallel branch support, and every flow is just a flat
list of names that must stay in sync with the collection by hand.

Postman Flows are a genuinely good idea. The frustrating part is that the CLI
execution is gated behind Enterprise. If your team is already paying for Enterprise,
stop reading this and use `postman flows run` — it's the right tool.

But if you're on the free plan and need multi-step API flows in CI without duplicating
request definitions, the underlying problem is solvable with the tools you already
have. A small Node.js script and a handful of JSON files gets you most of the way
there — just with none of the visual clarity that makes Flows worth reaching for in
the first place.

If you're in the same position, hopefully this saves you a few hours of searching.
And if Postman ever ships Newman support for Flows on the free plan, delete
`run-flow.js` and don't look back.

The full implementation referenced in this post is at
[github.com/marcelovani/postman-flows](https://github.com/marcelovani/postman-flows).

---

## Running the examples in this repo

The collection ships with a local mock server so you can run every flow without
a real API or a Postman account.

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/marcelovani/postman-flows.git
cd postman-flows
npm install
npm test
```

That's it. `npm test` starts the mock server, runs every flow, and shuts the server down.
You should see both flows pass:

```
✅ Flow "Member invitation" passed.
✅ Flow "Organisation creation" passed.
```

### Running a single flow

```bash
# Start the mock server in one terminal
npm run mock

# Run a specific flow in another terminal
ENV=mock node dev/Postman/run-flow.js "Organisation creation"
ENV=mock node dev/Postman/run-flow.js "Member invitation"
```

### Pointing at a real API

Export your Postman collection to `dev/Postman/collection/` and your environment
files to `dev/Postman/environments/`, then run:

```bash
# Local API (uses environments/environment.local.postman_environment.json)
node dev/Postman/run-flow.js "Organisation creation"

# CI (uses environments/environment.ci.postman_environment.json)
ENV=ci node dev/Postman/run-flow.js "Organisation creation"
```

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `MEMBER_USERNAME`, and `MEMBER_PASSWORD` as
environment variables (or GitHub Actions secrets) for the CI environment.

[thread]: https://community.postman.com/t/use-postman-flows-in-ci-cd-github-actions/62677
[gh-issue]: https://github.com/postmanlabs/postman-app-support/issues/11770
[flows-docs]: https://learning.postman.com/docs/postman-flows/tutorials/video/create-first-flow
