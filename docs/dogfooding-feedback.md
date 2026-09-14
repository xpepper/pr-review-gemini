# Dogfooding Feedback

Use this record for real pull requests reviewed by Gem PR Review. It distinguishes
verified observations from hypotheses and planned work, so model output is never
treated as fact without checking the pull request diff and repository context.

## Recording Rules

- Record the pull request, review URL, mode, summary, inline findings, verdict,
  confidence, and safe diagnostics when available.
- Verify each reported finding against the changed code and relevant repository
  context before describing it as correct or incorrect.
- Record links, finding identifiers, and reproducible behavior as evidence.
- Do not include proprietary source, credentials, tokens, raw prompts or diffs,
  diagnostic payloads that might contain sensitive data, or developer machine
  paths. Describe sensitive evidence at a high level or link only where access is
  already appropriately controlled.
- Mark recommendations as **now**, **next**, or **later**. A recommendation is a
  plan, not evidence.

## Entry Template

### PR / context

- **PR:** link and a brief description of the change reviewed.
- **Review:** link; reviewer version; mode; summary; inline finding count; verdict;
  confidence; and safe diagnostics inspected.

### What Gem PR Review did

Describe the actual review outcome and publication behavior.

### What was useful

List verified, actionable strengths.

### What was incorrect, missing, noisy, or confusing

List only observations validated against the diff and context. State when the
review did not expose a particular signal rather than inferring it.

### Recommended follow-up

State the planned response, if any.

**Priority:** now / next / later

**Evidence:** links, exact finding references, or reproducible behavior.

## Recorded Reviews

### PR / context

- **PR:** [#46](https://github.com/xpepper/pr-review-gemini/pull/46), which
  moved the README from an exhaustive reference to focused documentation pages.
- **Review:** `gem-pr-review v0.3.3` in balanced mode published no findings.
  Independent Claude and Codex reviews and a local `npm test` run were checked
  against the branch; Codex identified stale README-specific test assertions.

### What Gem PR Review did

It completed multiple zero-finding reviews of the documentation diff. Its
default balanced mode did not run the Test Quality lens or execute the test
suite.

### What was useful

The host-gated review safely published no unsupported inline findings. The
final review after documentation fixes also had zero findings.

### What was incorrect, missing, noisy, or confusing

The no-finding result missed a reproducible cross-artifact regression:
unchanged `tests/skills.test.mjs` still required details intentionally moved out
of the README, causing `npm test` to fail. The failure was validated locally and
the test was updated to check the focused documentation pages.

### Recommended follow-up

Implemented a targeted documentation consistency check for documentation-impact
PRs. It selects an allowlisted test, runs only for same-repository PRs when
that test is unchanged, reports its decision, and fails CI when the selected
test fails.

**Priority:** now

**Evidence:** [PR #46](https://github.com/xpepper/pr-review-gemini/pull/46) and
the reproducible stale-test failure before its focused assertion update.

### PR / context

- **PR:** [#44](https://github.com/xpepper/pr-review-gemini/pull/44), which
  separated tag-push verification from explicit GitHub Release publication.
- **Review:** published on [PR #44](https://github.com/xpepper/pr-review-gemini/pull/44)
  by `gem-pr-review v0.3.2`, in `balanced` mode; zero findings; no inline
  comments; and `COMMENT` review state. The published summary did not include a
  separate PASS/FAIL verdict or confidence value. No diagnostics were inspected.

### What Gem PR Review did

It evaluated the five balanced lenses and reported no defects or blocking issues.
The published review was attached to the PR head that introduced the separate
`verify` and dispatch-only `publish` workflow jobs.

### What was useful

The zero-finding result was consistent with the merged diff: tag pushes run the
verification job, while GitHub Release creation is restricted to
`workflow_dispatch` after verification. The change also had regression coverage
for that separation.

### What was incorrect, missing, noisy, or confusing

No false positives, duplicate comments, or anchoring problems were observed.
This no-finding review cannot establish recall, prioritization quality, or the
usefulness of confidence values. The absence of an explicit verdict and
confidence in the published summary is an observation, not yet evidence of a
product defect.

### Recommended follow-up

Use this template on reviews containing findings before deciding whether summary
verdict or confidence presentation needs product changes.

**Priority:** later

**Evidence:** [PR #44](https://github.com/xpepper/pr-review-gemini/pull/44),
[merged workflow change](https://github.com/xpepper/pr-review-gemini/commit/e5bbd6c7421fc5fcd0fce5266b5faba272124738),
and [successful `v0.3.3` tag verification](https://github.com/xpepper/pr-review-gemini/actions/runs/34752179219).

### PR / context

- **PR:** CI review runs for PRs #52 through #56 on GitHub-hosted runners, and
  the local pre-commit self-review of the fix branch `fix/ci-lens-degradation`.
- **Review:** `gem-pr-review v0.4.0` in balanced mode; CI summaries reported
  "No defects or blocking issues identified across all evaluated lenses".

### What Gem PR Review did

Every CI run logged `spawn copilot ENOENT` once per lens and still passed the
`fail_on: P1` gate with zero findings. On the fix commit, the local self-review
passed with one P2 advisory: wrapping the CLI error would hide structured
fields (`code`, `status`, `response`) from the retry classifiers.

### What was useful

The pre-commit self-review ran all five lenses locally and flagged a plausible
contract concern on the exact changed line.

### What was incorrect, missing, noisy, or confusing

The CI zero-finding results were not reviews: the CLI fallback runner swallowed
the spawn error and returned an empty string, which parsed as a clean lens, and
the quality gate counted only findings. Validated in `src/subagents.js` and the
run log for PR #56. The P2 advisory was validated false for the CLI path: an
`execFile` error carries no `status` or `response`, its `code` is a process exit
code (0 to 255) or an errno string such as `ENOENT`, none of which the
classifiers treat as retriable, and quota text arrives through stderr inside
the preserved message.

### Recommended follow-up

Implemented: the CLI runner now throws, so failed lenses are recorded as
failures; the Action fails the job when every lens fails (including `dry-run`)
and warns when only some fail. Provisioning the Copilot CLI on the runner stays
a separate owner decision because it needs a Copilot-entitled secret.

**Priority:** now

**Evidence:** [PR #56 review run](https://github.com/xpepper/pr-review-gemini/actions/runs/34873447020)
(five `spawn copilot ENOENT` lines followed by a passing gate) and the
regression tests in `tests/subagents.test.mjs` and `tests/ci.test.mjs`.

### PR / context

- **PR:** [#57](https://github.com/xpepper/pr-review-gemini/pull/57), which makes
  lens execution fail closed in the CLI runner and the GitHub Action.
- **Review:** `gem-pr-review v0.4.0` balanced local dry-runs on two heads
  (`4a7d8d6` and `60aebb4`), plus pre-commit self-reviews on each commit.

### What Gem PR Review did

Round 1 reported two P1 findings: the step summary and completion reply could
show a passing verdict after total lens failure, and the CLI fallback ignores
`COPILOT_CLI_PATH`. Round 2 reported a P1 that CLI failure messages echo the
untrusted prompt, and a P2 that lens execution classification trusts
unvalidated error entries. Pre-commit self-reviews raised further advisories on
error wrapping, stderr sanitization, and JSDoc.

### What was useful

- The step summary and completion reply finding was valid and fixed test-first.
- The prompt echo finding was valid and security-relevant: `execFile` error
  messages embed the full command line, so the review prompt (untrusted diff
  content) reached CI stdout, where a line-start `::` sequence is a workflow
  command, and partial-failure review bodies. A red test reproduced an
  injected `::error` line. Fixed by reporting the exit code or errno and one
  trimmed stderr line, with terminal escapes and control characters stripped.
- The `COPILOT_CLI_PATH` finding was valid but pre-existing and recorded as a
  follow-up.

### What was incorrect, missing, noisy, or confusing

- The error classification P2 on `src/ci.js` was not actionable: `errors` is
  produced in-process by the dispatcher, one per planned lens, using the same
  arithmetic as the reviewer's own all-lenses-failed check.
- A self-review P2 on non-CSI escape sequences was validated false: once all C0
  control characters are removed, any residue is printable text that a
  terminal cannot interpret.
- Severities ran high: the summary finding was reporting-only while the job
  still failed, closer to P2 than P1.

### Recommended follow-up

Honor `COPILOT_CLI_PATH` in the CLI fallback before provisioning the Copilot
CLI on the review runner. Implemented test-first in
[PR #60](https://github.com/xpepper/pr-review-gemini/pull/60).

**Priority:** next

**Evidence:** [PR #57](https://github.com/xpepper/pr-review-gemini/pull/57),
commits `60aebb4`, `b872f74`, and `2ea7a08`, and the regression tests in
`tests/subagents.test.mjs` and `tests/ci.test.mjs`.

## 2026-09-14 — PR #57 publish-failure diagnostics follow-up

### PR / context

- **PR:** [#57](https://github.com/xpepper/pr-review-gemini/pull/57)
- **Review:** `npm run dogfood:pr 57`, balanced local dry-run after commit
  `067b2f8`.

### What Gem PR Review did

Reported three findings: two duplicate P1s that the configured Copilot CLI path
is ignored by the fallback runner, and one P2 questioning lens-execution result
validation.

### What was useful

The CLI-path finding remains valid and pre-existing. PR #60 contains the fix
and is now based on `main` after #57 merged.

### What was incorrect, missing, noisy, or confusing

- The two CLI-path findings describe the same root cause and should have been
  deduplicated.
- The lens-classification P2 was already validated non-actionable: the result is
  assembled in-process by the dispatcher, with one error per planned lens.
- No finding challenged the new sanitized-cause propagation or found a defect
  in it.

### Recommended follow-up

Merge #60, then provision and authenticate the Copilot CLI in a separate PR
using the owner-selected secret and fork policy.

**Priority:** next

**Evidence:** hosted workflow run `34890081003` shows the intended fail-closed
result with `spawn copilot ENOENT` in both the log and GitHub error annotation;
887 tests across 161 suites passed.

## 2026-09-14 — PR #60 CLI-path fallback after rebase

### PR / context

- **PR:** [#60](https://github.com/xpepper/pr-review-gemini/pull/60), rebased
  onto `main` after #57 merged.
- **Review:** `npm run dogfood:pr 60`, balanced local dry-run on `2802dc3`.

### What Gem PR Review did

Reported one P2: resolve a relative `COPILOT_CLI_PATH` against the runner's
`cwd` rather than the process working directory.

### What was useful

The review focused on the only behavioral change after the stacked branch was
rebased.

### What was incorrect, missing, noisy, or confusing

The finding was not actionable. The SDK branch already resolves the same
environment path with `path.resolve(copilotCliPath)`, so the fallback preserves
that established contract. CI provisioning will supply an absolute path.

### Recommended follow-up

Merge #60 and use `COPILOT_CLI_PATH` when provisioning the hosted runner.

**Priority:** next

**Evidence:** 891 tests across 161 suites passed after the rebase; hosted run
`34890571858` failed closed as expected because provisioning is not yet wired.

## 2026-09-14 — PR #62 hosted Copilot CLI provisioning

### PR / context

- **PR:** [#62](https://github.com/xpepper/pr-review-gemini/pull/62)
- **Reviews:** real hosted incremental reviews plus `npm run dogfood:pr 62`
  balanced local dry-run.

### What Gem PR Review did

The first provisioned hosted run proved that all five lenses executed, then
reported a P0 token-exposure defect because the local composite action was
running from the pull-request checkout. Later rounds reported missing fork-auth
prevalidation, incorrect issue-comment base checkout, a mutable base-ref race,
and several duplication and runtime assumptions.

### What was useful

- The P0 was valid. The workflow now resolves and checks out the trusted base
  before giving the composite action the Copilot token.
- The fork-auth finding led to an explicit early fail-closed precondition; this
  preserves the owner's decision not to skip fork runs.
- The issue-comment finding from both hosted and local dogfood was valid. The
  workflow queries the PR base for comment events instead of assuming the
  default branch.
- The mutable-ref P2 was valid. Both event paths now check out the immutable
  base commit SHA.

### What was incorrect, missing, noisy, or confusing

- The Docker-runtime P1 was false: `action.yml` is a composite action, and the
  hosted run itself proved the runner-installed CLI was available.
- The invalid-token P2 proposed `copilot auth status`, which is not in the
  official command reference. A bad token still fails closed during real lens
  execution; the early guard intentionally checks secret availability.
- The repeated bootstrap/docs findings are maintenance advisories. Keeping the
  complete reference workflow executable and matching the live workflow is
  intentional and pinned by tests.

### Recommended follow-up

Merge #62. Keep the pinned Copilot CLI version current in both the live workflow
and documented template.

**Priority:** now

**Evidence:** runs `34892385230`, `34892736130`, `34893065161`, and
`34894095418` exercised real lenses and drove the fixes. Final run
`34894342377` installed and authenticated Copilot CLI, executed all five lenses
with no execution errors, and passed the P1 gate with a genuine zero-finding
summary. The full suite passes 892 tests across 161 suites.

## 2026-09-14 — PR #64 Action-owned Copilot CLI bootstrap

### PR / context

- **PR:** [#64](https://github.com/xpepper/pr-review-gemini/pull/64), which
  moves pinned Copilot CLI provisioning into the published composite Action.
- **Reviews:** hosted incremental runs `34897872799`, `34898776092`, and
  `34899128103`, plus `npm run dogfood:pr 64` balanced local dry-run.

### What Gem PR Review did

The first hosted run failed closed because the immutable base checkout loaded
pre-#63 `action.yml`, proving the workflow did not execute PR-head Action code
with the Copilot credential. A conditional self-hosting rollout path then
provisioned the old trusted-base Action. The final hosted run executed all five
lenses with zero execution errors and passed the P1 gate with one P2 finding.
The local dogfood run reported one P1 and one P2.

### What was useful

- The workflow's indentation-sensitive Action-contract detection was a valid
  maintenance risk. It was replaced with an explicit versioned marker plus a
  fail-fast `action.yml` existence check.
- The authentication wording was clarified: the Action guard prevents Copilot
  CLI fallback to the GitHub API credentials even though the upstream CLI
  supports those variables.
- Pre-commit reviews correctly identified that setup/install must clear all
  three documented Copilot credential variables. Tests now pin that boundary.

### What was incorrect, missing, noisy, or confusing

- The hosted P1 requesting a lockfile/integrity-pinned global install was not
  actioned. GitHub's official installation path is global npm installation,
  the package version is exact, and npm registry metadata for `1.0.83`
  includes a SHA-512 `dist.integrity` that npm verifies. A separate lockfile
  installer would add machinery beyond issue #63 without demonstrating an
  exploit in the pinned official path.
- The reviewer later auto-resolved that integrity finding only because its
  anchor moved; the implementation did not change. This is a false resolution
  signal and must not be treated as evidence that the concern was fixed.
- The local P2 that trusted-base detection uses the stale base SHA describes
  the intended security boundary. The rollout marker deliberately selects the
  legacy bootstrap for this PR, then selects Action-owned bootstrap once the
  marker lands on `main`.
- The repeated ambient-state finding was valid. An explicit opt-in still left
  credential resolution dependent on caller environment scope, so the fallback
  was removed. The new contract requires `copilot_token`; no caller ambient
  token can satisfy the guard. Because that breaks the `v0.4.0` Action contract,
  all manifests were bumped to `1.0.0` and the migration is documented.

### Recommended follow-up

Merge #64, publish the next immutable release, update the temporary
commit-pinned examples to the `v1.0.0` tag, and call out the required
`copilot_token` input in the release migration notes.

**Priority:** now

**Evidence:** final hosted run `34899128103` passed after all five lenses ran
with zero execution errors; `npm run dogfood:pr 64` completed with two findings
that were validated as intentional behavior; 893 tests across 161 suites pass.
