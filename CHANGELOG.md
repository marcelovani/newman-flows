# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-02

### Added

- Step variables. A step in `steps([...])` can be an object, `{ step: 'View Item', vars: { actor: 'member', expected_status: 403 } }`, to run the same request with different values. The variables are set before the request's own pre-request script and last for that step only: the next step removes them and puts back any value they replaced, even if the step's tests threw or its request was skipped. The step is reported as `View Item [actor=member, expected_status=403]`. Plain string steps work exactly as before.
- `validate` checks step objects: a non-empty `step`, only the keys `step` and `vars`, valid variable names, and string, number or boolean values.
- `FlowDef.stepDefs`, `stepLabel()`, and the `FlowStep` and `StepVarValue` types, in the programmatic API. `FlowDef.steps` still lists the step names.
- An `Item access by actor` flow in `examples/my-api` showing one request run as three actors.
- This changelog, backfilled from the git history.

### Fixed

- Collection variables and collection-level auth now reach the requests in a flow. The collection built for each flow kept the collection's scripts but dropped its `variable` and `auth`, so a request relying on either ran without it.

## [1.0.1] - 2026-04-20

### Added

- Collection and environment files are auto-discovered recursively.
- A runnable example in `examples/my-api`, with its own mock server.
- npm badges in the README, and a note that Newman is a dependency.
- A weekly CI check that `NPM_TOKEN` is still valid.

### Changed

- The README was rewritten in reading order, with generic examples.
- Integration tests run against `examples/my-api` on a free port; the separate test fixtures and mock server were removed.

### Fixed

- Express 5 route parameter types in the test mock server.

### CI

- Publishing only runs on a version tag push, and checks that the tag matches `package.json`.
- Release tags must start with `v`.

## [1.0.0] - 2026-04-18

First public release as `newman-flows`.

> The `v1.0.0` tag points at a commit whose `package.json` still says `0.1.0`; the version was not bumped before tagging. `v1.0.1` is the first release where the two agree.

### Added

- `newman-flows run "<flow>"` and `run --all`: build a flat collection from a flow's `steps([...])` and run it through Newman.
- `newman-flows validate`: checks info fields, absolute file paths, flow scripts, unresolved step names and duplicate request names.
- `newman-flows list`: lists flows with their step counts.
- A programmatic API: `runFlow`, `runAllFlows`, `validateCollection`, `extractFlowDef` and the collection helpers.
- Collection and environment auto-discovery, warning when more than one file matches.
- Newman reporters passed straight through: `--reporters`, plus `--reporter-junit-export`, `--reporter-htmlextra-export` and `--reporter-json-export`.
- A hardened vm sandbox for flow scripts: pre-flight checks for escape patterns, a 1-second timeout, and `steps()` argument validation.
- A pre-push hook running format, lint, typecheck and unit tests.
- CI running lint, typecheck, unit and integration tests, and publishing to npm on a `v*` tag.

[Unreleased]: https://github.com/marcelovani/newman-flows/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/marcelovani/newman-flows/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/marcelovani/newman-flows/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/marcelovani/newman-flows/releases/tag/v1.0.0
