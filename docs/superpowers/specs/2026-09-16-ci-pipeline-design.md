# CI Pipeline Design

Date: 2026-09-16
Status: Approved (design review with repo owner)

## Problem

The repository runs its full test suite only inside the release workflow's
`verify` job, at tag or dispatch time. Nothing enforces that merges to
`main` keep the build green, and nothing structurally ties "CI is green" to
"release is allowed". This design adds a CI pipeline that is a precondition
for merging to `main` and makes it impossible to publish a release whose
checks fail.

## Decisions

Decisions made with the repo owner during design review:

1. **CI checks**: `npm test` + `npm run version:check` + Agent Plugins 1.0
   spec validation (manifests, skills, action contract). Spec validation is
   implemented as extensions to the existing test suite, not as new
   tooling.
2. **Required check for merging**: the CI workflow only. The
   `Gem PR Review` workflow stays advisory (non-blocking) because of known
   Copilot runtime degradation and LLM-run flakiness.
3. **Branch protection**: required status checks on `main`; administrators
   may bypass, so `npm run release`'s direct `chore(release): vN` push to
   `main` keeps working. No required approvals (solo-maintainer repo;
   AI review is advisory).
4. **Release gating**: the release workflow consumes the same reusable CI
   workflow definition, so the release gate is by construction identical to
   the CI gate.

Approach chosen: **one dual-trigger CI workflow** (`ci.yml`) that both runs
on push/pull_request and is callable via `workflow_call`. Rejected
alternatives: a separate reusable workflow plus thin caller (extra file and
indirection for a single consumer), and duplicating steps between
`ci.yml` and `release.yml` (check sets drift apart over time).

## Architecture

### CI workflow (`.github/workflows/ci.yml`, new)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_call:
    inputs:
      ref:
        description: 'Commit ref to check out (empty = event default)'
        type: string
        default: ''

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  checks:
    strategy:
      fail-fast: false
      matrix:
        node-version: ['20', '24']
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref || github.ref }}
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm run version:check   # four-manifest sync, clear early failure
      - run: npm test                # includes spec validation tests
```

The `ref` input exists for the release caller: on `workflow_dispatch` the
event's default ref is the dispatch branch, not the tag, so the release
job passes `github.event.inputs.tag || github.ref` explicitly — mirroring
the checkout logic the current `release.yml` verify job uses. For push and
pull_request events the input is empty and checkout falls back to the
event default.

- Node matrix covers the minimum supported version (`engines.node >= 20`)
  and the current LTS (24). Matrix legs produce check names `checks (20)`
  and `checks (24)`.
- Action pins (`checkout@v7`, `setup-node@v7`) match `release.yml`.
- Concurrency: the group is namespaced by workflow name and keyed only on
  trusted `github.*` context (never `inputs.*`), and only `pull_request`
  runs are cancelled. Rationale: when called from `release.yml`, the
  called workflow's concurrency is evaluated in the caller's context, so
  a release-invoked CI run lands in a `ci-Release-*` group — it can never
  collide with or cancel a `ci-CI-refs/heads/main` push run, and queued
  (not cancelled) release dispatches serialize instead of killing an
  in-flight publish. PR supersession — the one place cancellation
  matters — still cancels stale runs.
- Public repo, zero npm dependencies: the matrix adds negligible cost
  (suite runs in ~20 s per leg).
- Spec validation lives in the test suite (`tests/plugin-manifest.test.mjs`,
  `tests/skills.test.mjs`, `tests/ci.test.mjs`): semver-format versions
  across all four manifests, `$schema` URI present, skill directory naming,
  `mcp.json` server entry shape, `action.yml` modern contract structure.
  Written test-first per AGENTS.md before the workflow exists.

### Branch protection on `main` (repo settings, configured via `gh api`)

Configured through the classic branch-protection API
(`PUT /repos/{owner}/{repo}/branches/main/protection`), whose
`enforce_admins: false` directly expresses the admin-bypass decision:

- Required status checks: `checks (20)`, `checks (24)`.
- `strict: false` — no "branch must be up to date with main" requirement
  (less rebase churn for a solo repo).
- Force pushes and branch deletion blocked.
- Administrators may bypass (keeps `npm run release` direct pushes working).
- No required approvals.

Configured only after the CI workflow has merged and reported both check
names at least once; a required check that has never reported leaves PRs
stuck on "Expected — Waiting for status".

### Release gating (`.github/workflows/release.yml`, reworked)

A job that calls a reusable workflow cannot also run its own steps, so the
current single `verify` job splits into:

- `verify-tag` — release-specific tag ↔ `package.json` version alignment
  (existing logic, unchanged).
- `ci` — `uses: ./.github/workflows/ci.yml` with
  `with: ref: ${{ github.event.inputs.tag || github.ref }}`, running the
  full check set at the tag ref on both tag-push and dispatch triggers.
- `publish` — `needs: [verify-tag, ci]`, otherwise unchanged.

Effect: publishing is impossible unless the exact CI check set passes at
the tag commit. This holds even if someone bypassed branch protection and
left `main` red, because the checks re-run at the tag.

## Sequencing

Small, provable increments, each a PR reviewed by this repo's own tool
(dogfooding rule #4):

1. **Spec-validation tests** — extend manifest/skill/action-contract tests;
   verify they fail for the right reason first, then pass. No workflow
   changes.
2. **Add `ci.yml`** — new workflow only.
3. **Rework `release.yml`** — split verify, consume the reusable CI.
4. **Branch protection + docs** — configure via `gh api`; update
   `docs/release.md` (release gate now includes shared CI), `TODO.md`,
   `HANDOFF.md`.

## Testing

- Increment 1 is itself tests; CI correctness is observed on real PRs:
  increment 2's PR must show both matrix legs green before merging.
- Release gating verified with the established safe smoke-test technique
  (dispatch the release workflow against a throwaway tag, confirm the
  `ci` job runs and `publish` stays skipped), never against a real release.
- Branch protection verified by attempting a direct non-admin push
  expectation is not practically testable in a solo repo; instead verify
  the applied ruleset via `gh api` and confirm an open PR shows both
  checks as required.

## Risks & Edge Cases

- **Check-name churn**: dropping or renaming the matrix changes required
  check names; protection config must be updated in the same change. The
  design doc and `docs/release.md` call this out.
- **Stale branch protection before CI exists**: protection is applied last
  (increment 4) to avoid blocking PRs on missing checks.
- **`workflow_call` + tag ref**: on `workflow_dispatch` the event's default
  ref is the dispatch branch, not the tag — solved by the reusable
  workflow's `ref` input (see Architecture), which keeps tag-push and
  dispatch behavior identical to the current verify job.
- **Admin bypass is deliberate**: it trades strictness for a one-command
  release flow; bypass events remain auditable in the repo activity log.
