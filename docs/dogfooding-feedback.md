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
