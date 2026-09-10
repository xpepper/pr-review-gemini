# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `main`
* **Test Suite**: `npm test` runs and passes (310 tests across 74 suites, 0 failures)
* **Roadmap Increments Delivered**:
  - PR #1: `feat(config): implement model tier and settings resolution`
  - PR #2: `feat(diff): implement unified diff parser and hunk anchoring`
  - PR #3: `feat(publish): implement host-gated review publishing with diff anchoring`
  - PR #4: `feat(reviewer): implement minimum viable reviewer orchestrator and dogfood runner`
  - PR #5: `feat(subagents): implement parallel multi-lens execution and MCP server`
  - PR #6: `feat(prior): implement incremental re-reviews and prior finding revalidation`
  - PR #7: `feat(verify): implement detached worktree test verification (pr_review_verify)`
  - PR #8: `docs: add quick start and comprehensive usage guide to README`
  - PR #9: `docs: add copilot plugin install instructions and collision guidance`
  - PR #10: `feat: rename plugin, skill, and MCP tools to gem-pr-review`
  - Commit 7bca149: `fix(publish): normalize double-escaped newlines and add safe publishing workflow to skill`
  - PR #12 (Issue #11): `feat: allow per-lens model and reasoning-effort overrides`
  - PR #13 (Increment 8): `feat: implement large-diff transport and file-backed paging (> 200 KB)`
  - PR #15 (Issue #14 / Increment 9): `feat: interactive finding selection and cached publish-later` (Merged, commit `a0def2c`)
  - PR #17 (Issue #16 / Increment 10): `feat: automatic fallback model retry on quota/capacity errors (without timeouts)` (Merged, commit `9f20254`)
  - PR #19 (Issue #18 / Increment 11): `feat: implement one-shot coding-task self-review (gem_self_review)` (Merged, commit `70303ad`)
  - PR #21 (Issue #20 / Increment 12): `feat: implement candidate finding recovery from degraded and malformed model output` (Merged, commit `69f42c4`)

---

## Status: ALL_PHASE_7_INCREMENTS_COMPLETE / ROADMAP_DELIVERED

All 12 roadmap increments across Phases 1 through 7 are fully implemented, verified test-first (310 passing tests across 74 suites), dogfood-reviewed, documented in `README.md` and `skills/gem-pr-review/SKILL.md`.
Phase 7 backlog:
- [x] Increment 8: Large-diff file-backed transport (> 200 KB)
- [x] Increment 9: Interactive finding selection UI & cached publish-later (Issue #14)
- [x] Increment 10: Automatic fallback model retry on quota/capacity errors (without timeouts) (Issue #16)
- [x] Increment 11: One-shot coding-task self-review (`gem_self_review`) (Issue #18)
- [x] Increment 12: Candidate finding recovery from degraded/malformed model output (Issue #20)

---

## Architecture Summary of the Completed Package

1. **Manifest & Standards (Agent Plugins 1.0)**:
   - `plugin.json`: Compliant package manifest.
   - `mcp.json`: Model Context Protocol server configuration exposing tools.
   - `skills/gem-pr-review/SKILL.md`: Declarative agent skill with multi-lens instructions, mode flags (`--quick`, `--balanced`, `--full`, `--deep`), and prior finding revalidation guidelines.

2. **Core Modules (`src/`)**:
   - `src/config.js`: Layered configuration management (`~/.copilot/gem-pr-review.json` / `.github/gem-pr-review.json`), model tiers (`light`, `medium`, `heavy`), reasoning efforts (`off` to `high`), and per-lens overrides (`lenses`).
   - `src/diff.js`: Unified diff parser, git hunk header extraction, and commentability safety gates.
   - `src/publish.js`: Host-gated review publisher with diff anchor validation, comment capping (50), stale-head protection, and gated `APPROVE`/`COMMENT` logic.
   - `src/reviewer.js`: Multi-lens review orchestrator, finding deduplication, and mode planning.
   - `src/subagents.js`: Parallel subagent dispatcher leveraging `@github/copilot-sdk` with per-lens overrides precedence.
   - `src/prior.js`: Prior review discovery via `gh api`, commit relationship classification (`same_head`, `incremental`, `diverged`, `none`), and prior findings revalidation (`resolved`, `still open`, `obsolete`).
   - `src/verify.js`: Detached worktree test execution (`pr_review_verify`) with process supervision, timeouts, and credential scrubbing.

3. **MCP Server (`server/index.js`)**:
   - Implements JSON-RPC 2.0 stdio server providing:
     - `pr_review_diff`: Unified diff extraction and metadata.
     - `pr_review_subagents`: Multi-lens parallel analysis with mode resolution.
     - `pr_review_publish`: Host-gated review publishing with diff anchoring.
     - `pr_review_prior`: Prior review discovery and finding revalidation.
     - `pr_review_verify`: Detached worktree test execution.

4. **Dogfood & Loop Tooling (`scripts/`)**:
   - `scripts/dogfood-review.mjs`: CLI runner to review GitHub PRs using our own plugin modules.
   - `scripts/dev-loop.sh`: Autonomous development driver with pre/post-flight verification, timeout control, and completion sentinel checks.

---

---

## Completed Work: Increment 8 — Large-Diff Transport & File-Backed Paging (> 200 KB)

- **GitHub PR**: [#13: feat: implement large-diff transport and file-backed paging (> 200 KB)](https://github.com/xpepper/pr-review-gemini/pull/13)
- **Branch**: `feat/large-diff-transport`
- **Changes Delivered**:
  - `src/diff.js`:
    - Added constants `LARGE_DIFF_THRESHOLD_BYTES = 200 * 1024`, `MAX_SUPERVISED_READS = 16`, `DEFAULT_SUPERVISED_BUDGET_BYTES = 640 * 1024`, `MAX_SUPERVISED_BUDGET_BYTES = 1024 * 1024`.
    - Added `isLargeDiff(diffText)` and `generateDiffManifest(diffText)` providing file counts, file paths, old/new paths, status (`modified`, `added`, `deleted`, `renamed`), added/deleted line counts, and approximate byte sizes.
    - Added `formatDiffManifest(manifest, options)` generating formatted markdown tables for prompts.
    - Added `createFileBackedDiff({ diffText, tempDirPrefix })` writing diff to isolated temporary directory (`gem-pr-diff-.../diff.patch`) with automatic `cleanup()` lifecycle.
    - Added `createHostSupervisedDiffReader({ diffText, filePath, ... })` implementing host-enforced reading (`read`, `grep`, `find`) with byte budget tracking, read call counter, per-call byte limits, line-based slicing, regex/literal search, and directory traversal rejection.
  - `src/reviewer.js`:
    - Updated `buildReviewerPrompt` to substitute inlined diff with `Large Diff Transport Notice (> 200 KB)`, manifest summary table, and supervised tool instructions when diff > 200 KB.
    - Updated `runReview` to auto-detect large diffs, create and cleanup file-backed transport in `try ... finally`, pass transport to subagents, and include diff transport statistics in the review summary.
  - `src/subagents.js`:
    - Added `buildSdkReaderTools(supervisedReader)` producing Copilot SDK-compliant tool declarations (`diff_read`, `diff_grep`, `diff_find`).
    - Updated `createSubagentRunner` to register tools with `copilotClient.createSession({ tools })`.
    - Updated `dispatchSubagentsParallel` to auto-detect large diffs, wrap diff in supervised transport, and manage cleanup.
  - `server/index.js` (MCP Server):
    - Extended `gem_pr_review_diff` to return `isLarge`, `thresholdBytes`, and `manifest`.
    - Added MCP tool `gem_pr_review_diff_read` exposing supervised `read`, `grep`, and `find` operations with budget tracking.
  - `skills/gem-pr-review/SKILL.md` & `README.md`:
    - Documented large diff transport behavior, manifest tables, reader tools, and MCP tool reference.
  - Tests:
    - Added 26 unit tests across `tests/diff.test.mjs`, `tests/reviewer.test.mjs`, `tests/subagents.test.mjs`, `tests/mcp-server.test.mjs`, and `tests/skills.test.mjs`. Total 191 tests passing across 50 suites.
  - Dogfood Review:
    - Executed and posted dogfood review on PR #13 via `scripts/dogfood-review.mjs 13 --publish --mock`.

---

---

## Completed Work: Increment 9 — Interactive Finding Selection & Cached Publish-Later (Issue #14)

- **GitHub PR**: [#15: feat: interactive finding selection and cached publish-later](https://github.com/xpepper/pr-review-gemini/pull/15) (Merged, commit `a0def2c`)
- **GitHub Issue**: [#14: feat: interactive finding selection and cached publish-later](https://github.com/xpepper/pr-review-gemini/issues/14) (Closed)
- **Branch**: `feat/interactive-selection`
- **Changes Delivered**:
  - `src/selection.js`:
    - `formatFindingRow(finding, index)`: Single-line row formatting displaying index `[1]`, severity `[P0]`, confidence percentage (e.g. `95%`), location (`file:line (side)`), and title.
    - `formatFindingsTable(findings)`: Actionable console table with severity counts summary header and divider lines.
    - `parseSelectionInput(input, totalCount, findings, options)`: Parses index numbers (`1, 3`), ranges (`2-4`), exclusions (`-2`, `!3`), severity names (`p0, p1`), minimum severity thresholds (`min:p2`, `>=p2`), stylistic filters (`no-nits`), and keywords (`all`, `none`).
    - `filterFindings(findings, selection)`: Filters findings by index array, string specification, or returns all.
    - `promptFindingSelection(options)`: Interactive readline prompt for finding triage before publishing, with user cancellation support (`q` / `cancel`).
  - `src/cache.js`:
    - Session and workspace review caching (`saveReviewCache`, `getReviewCache`, `invalidateReviewCache`, `listReviewCaches`, `clearAllCaches`) keyed by PR number and head commit SHA (defaults to `.gem-pr-cache/`).
    - Freshness verification: Automatically rejects and invalidates stale cached findings when current PR head commit has advanced.
    - `publishCachedReview(options)`: Submits cached review findings through host-gated diff hunk validation and safety gates without rerunning subagent model passes.
  - `src/reviewer.js`:
    - In `runReview`, automatically caches findings on every evaluation pass when `currentHeadSha` is known.
    - Added finding selection filtering (`selectedIndices` / `selection`) before publishing.
    - Re-exported selection and cache utilities.
  - `server/index.js` (MCP Server):
    - Added MCP tool `gem_pr_review_publish_cached` allowing agents to submit cached review findings safely with freshness verification.
  - `scripts/dogfood-review.mjs`:
    - Added CLI options `--publish-cached`, `--all`, `--interactive`, `--select <spec>`, and `--cache-dir <dir>`.
    - Integrated interactive triage prompt before review publishing, with mock runner support.
  - Documentation & Skill:
    - Updated `skills/gem-pr-review/SKILL.md` and `README.md` with complete documentation on interactive selection, cached publish-later, and MCP tool reference.
  - Tests:
    - Added 38 unit tests across `tests/selection.test.mjs`, `tests/cache.test.mjs`, `tests/reviewer.test.mjs`, `tests/mcp-server.test.mjs`, `tests/skills.test.mjs`, and `tests/dogfood.test.mjs`. Total 229 tests passing across 61 suites.

---

## Completed Work: Increment 10 — Automatic Fallback Model Retry on Quota/Capacity Errors (Issue #16)

- **GitHub Issue**: [#16: feat: automatic fallback model retry on quota/capacity errors (without timeouts)](https://github.com/xpepper/pr-review-gemini/issues/16)
- **Branch**: `feat/quota-fallback-retry`
- **Changes Delivered**:
  - `src/config.js`:
    - Added fallback model chains support: `heavy_fallbacks`, `medium_fallbacks`, `light_fallbacks` (and `fallbacks: { light, medium, heavy }`).
    - Added per-lens fallback overrides: `lenses: { [lensId]: { fallbacks: [...] } }`.
    - Added helper functions `getFallbackModelsForTier(config, tier)` and `getFallbackModels(config, { tier, lensId })`.
    - Sanitized and validated fallback array inputs in `resolveConfig`.
  - `src/subagents.js`:
    - Added `isQuotaOrCapacityError(error)` (and alias `isQuotaError`) detecting status 429, error codes (`RESOURCE_EXHAUSTED`, `RATE_LIMIT_EXCEEDED`, `INSUFFICIENT_QUOTA`, `MODEL_CAPACITY_EXCEEDED`, `ERR_RATE_LIMITED`), and text patterns (`quota`, `rate-limit`, `overloaded`, `capacity`, `too many requests`) while strictly rejecting unrelated syntax, type, network disconnect, or timeout bugs.
    - Updated `resolveLensPlan` to attach resolved `fallbacks` to each lens plan item, filtering out the primary model to avoid redundant retries.
    - Updated `dispatchSubagentsParallel` to automatically retry failing lenses across configured fallback models when quota/capacity errors occur.
    - Guaranteed zero loss of completed sibling passes: sibling lenses running in parallel continue uninterrupted and their findings are preserved.
    - Zero timeouts: preserved strict timeout-free execution without artificial deadlines or stuck-reviewer heuristics.
  - `src/reviewer.js`:
    - Passed `config` to `dispatchSubagentsParallel` in `runReview`.
    - Re-exported `isQuotaOrCapacityError` and `isQuotaError`.
  - `skills/gem-pr-review/SKILL.md` & `README.md`:
    - Documented fallback model retry on quota/capacity errors, zero timeouts, and configuration options.
  - Tests:
    - Added 20 unit tests across `tests/config.test.mjs`, `tests/subagents.test.mjs`, `tests/reviewer.test.mjs`, and `tests/skills.test.mjs`. Total 249 tests passing across 62 suites.

---

## Completed Work: Increment 11 — One-Shot Coding-Task Self-Review (`gem_self_review`) (Issue #18)

- **GitHub Issue**: [#18: feat: one-shot coding-task self-review (gem_self_review)](https://github.com/xpepper/pr-review-gemini/issues/18)
- **Branch**: `feat/self-review`
- **Changes Delivered**:
  - `src/diff.js`:
    - `generateSyntheticDiff(filePath, fileContent)`: Formats untracked files into valid git unified diffs (`new file mode 100644`, hunk headers, `+` lines, and binary markers) compatible with `parseUnifiedDiff`, `isLineInHunk`, and `generateDiffManifest`.
    - `getWorktreeDiff(options)`: Reliably acquires local uncommitted changes without remote PR or GitHub network dependencies: staged (`git diff --cached`), unstaged (`git diff`), combined (`git diff HEAD` with unborn branch fallback), and untracked files (`git status --porcelain`).
  - `src/self-review.js`:
    - `evaluateSelfReviewVerdict(findings, options)`: Evaluates findings against fail-closed safety gate: returns `status: 'passed'` (`verdict: 'PASS'`) when zero blocking issues exist, and `status: 'failed'` (`verdict: 'FAIL'`) when blocking P0 or P1 issues are detected. Supports configurable threshold (`failOn`, default `P1`).
    - `formatSelfReviewSummary(options)`: Formats clean, actionable markdown reports highlighting verdict banners, diff metrics, evaluated specialist lenses, and line-anchored remediation steps for blocking issues.
    - `runSelfReview(options)`: Multi-lens self-review orchestrator executing specialist review passes locally with parallel subagent dispatch, file-backed large diff handling (> 200 KB), finding deduplication, and zero remote mutations.
  - `src/reviewer.js`:
    - Re-exported `runSelfReview`, `evaluateSelfReviewVerdict`, `formatSelfReviewSummary`, `getWorktreeDiff`, and `generateSyntheticDiff`.
  - `src/subagents.js`:
    - Enhanced `dispatchSubagentsParallel` raw output extraction to seamlessly handle both string and `{ output }` objects from model runners.
  - `server/index.js` (MCP Server):
    - Added MCP tool `gem_self_review` and backward-compatible alias `gem_pr_review_self` supporting `scope`, `mode`, `includeUntracked`, `failOn`, and `customInstructions`.
  - `scripts/`:
    - Added `scripts/self-review.mjs` dedicated CLI runner with exit code 0 on pass and 1 on fail.
    - Added `--self` flag support to `scripts/dogfood-review.mjs` allowing self-review execution without requiring a PR number.
    - Added npm script `"self-review": "node scripts/self-review.mjs"` to `package.json`.
  - Documentation & Skill:
    - Documented one-shot coding-task self-review, local diff acquisition, fail-closed safety gate, MCP tool reference, and CLI commands in `skills/gem-pr-review/SKILL.md` and `README.md`.
  - Tests:
    - Added 31 unit tests across `tests/self-review.test.mjs`, `tests/mcp-server.test.mjs`, `tests/dogfood.test.mjs`, and `tests/skills.test.mjs`. Total 280 tests passing across 68 suites.

---

## Completed Work: Increment 12 — Candidate Finding Recovery from Degraded/Malformed Model Output (Issue #20)

- **GitHub Issue**: [#20: feat: candidate finding recovery from degraded or malformed model output](https://github.com/xpepper/pr-review-gemini/issues/20) (Closed)
- **GitHub PR**: [#21: feat: implement candidate finding recovery from degraded and malformed model output (#20)](https://github.com/xpepper/pr-review-gemini/pull/21) (Merged, commit `69f42c4`)
- **Branch**: `feat/candidate-finding-recovery`
- **Changes Delivered**:
  - `src/recovery.js`:
    - `extractJsonEnvelope(text)`: Resiliently extracts JSON payloads from delimited `<<<PR_REVIEW_JSON>>>` envelopes even when the closing delimiter `<<<END_PR_REVIEW_JSON>>>` was truncated due to model token limits; strips surrounding or nested ````json ... ```` code blocks; falls back to raw JSON array/object scanning when delimiters are omitted.
    - `repairJsonString(jsonText)`: Cleans syntax flaws preventing JSON parsing: removes illegal trailing commas before closing `}` and `]`; automatically escapes raw literal newlines and control characters inside string properties (`body`, `commentary`); strips single-line and multi-line comments outside of strings; normalizes smart/curly quotes; balances unclosed arrays and objects; prunes broken trailing fragments when output was truncated midway.
    - `extractCandidateObjects(text)`: Balanced-brace scanner iterating through text to isolate individual `{ ... }` candidate objects even when outer array syntax is corrupt, unclosed, or interspersed with free-form markdown; includes regex field extraction fallback for truncated tail objects.
    - `normalizeFindingCandidate(item)`: Validates and normalizes candidate findings against structured contract: standardizes severities (`P0`, `P1`, `P2`, `P3`, `nit`) and maps descriptive labels (`critical`/`blocker` -> `P0`, `high`/`major` -> `P1`, `medium`/`warning` -> `P2`, `low`/`minor` -> `P3`, `cosmetic`/`trivial` -> `nit`); clamps confidence scores in `[0.0, 1.0]`; normalizes line numbers to positive integers; cleans git diff prefixes (`a/`, `b/`).
    - `isValidFindingCandidate(item)`: Rejects arbitrary JSON noise (config objects, tool parameters) requiring at least a valid file path or line number paired with a severity, title, or body.
    - `recoverFindingsFromText(input)`: Orchestrates multi-stage recovery pipeline across direct parsing, string repair, candidate scanning, and fallback recovery.
  - `src/publish.js`:
    - Integrated `recoverFindingsFromText` into `parseMarkdownFindings(input)` so all PR reviews, cached reviews, and local self-reviews automatically benefit without losing valid findings.
    - Re-exported all recovery utilities.
  - `src/reviewer.js`:
    - Re-exported all recovery utilities.
  - Documentation & Skill:
    - Updated `skills/gem-pr-review/SKILL.md` and `README.md` with complete documentation on candidate finding recovery, envelope resilience, and JSON repair.
  - Tests:
    - Added 30 new unit and integration tests across `tests/recovery.test.mjs`, `tests/publish.test.mjs`, `tests/subagents.test.mjs`, `tests/self-review.test.mjs`, and `tests/skills.test.mjs`.
    - Total **310 tests passing across 74 suites with 0 failures**.
  - Dogfood Review:
    - Successfully auto-reviewed PR #21 using `scripts/dogfood-review.mjs 21 --publish --mock` before squash-merging into `main`.

---

## Roadmap Status: Phases 1–7 Fully Completed

Every planned increment across the entire roadmap has been delivered, tested, dogfood-reviewed, and merged:
- **Phase 1**: Scaffolding, Agent Plugins 1.0 manifest, test runner.
- **Phase 2**: Layered configuration, model tiers (`light`, `medium`, `heavy`), reasoning efforts.
- **Phase 3**: Unified diff parser, hunk boundary extraction, commentability safety gates.
- **Phase 4**: Host-gated review publisher, diff anchor validation, stale-head protection, dogfood loop.
- **Phase 5**: Parallel multi-lens subagents via `@github/copilot-sdk`, review modes (`--quick`, `--balanced`, `--full`, `--deep`), MCP server.
- **Phase 6**: Incremental re-reviews (`--incremental`), prior finding revalidation (`resolved`, `still open`, `obsolete`), detached worktree test verification (`gem_pr_review_verify`).
- **Phase 7 (Advanced Resiliency, Transport & Interaction)**:
  - Increment 8: Large-diff transport & file-backed paging (> 200 KB) with host-supervised reader tools (`diff_read`, `diff_grep`, `diff_find`).
  - Increment 9: Interactive finding selection UI (`--interactive`, `--select`) and session review caching (`--publish-cached`, `gem_pr_review_publish_cached`).
  - Increment 10: Automatic fallback model retry on quota/capacity errors (HTTP 429, resource exhaustion) with zero timeouts.
  - Increment 11: One-shot coding-task self-review (`gem_self_review`) with local diff acquisition and fail-closed safety gate.
  - Increment 12: Candidate finding recovery from degraded/malformed model output with deterministic JSON repair and candidate scanning.

---

## Future Opportunities / Phase 8 Ideas

Possible future enhancements:
1. **GitHub Actions CI Runner**: A reusable GitHub Action workflow running `gem-pr-review` on `pull_request` triggers in CI with GitHub token authentication.
2. **Additional Specialist Lenses**: Domain-specific lenses like Accessibility (a11y), Internationalization (i18n), or Database Migration safety.
3. **Streamlined Pre-Commit Hook Installer**: A CLI helper (`npx gem-pr-review --install-hook`) to set up `.git/hooks/pre-commit` to invoke `npm run self-review`.

---

## Next Session Mission: Increment 13 — Reusable GitHub Action & Automated CI Review Workflow (Issue #22)

- **GitHub Issue**: [#22: feat: reusable GitHub Action and automated CI PR review workflow (action.yml)](https://github.com/xpepper/pr-review-gemini/issues/22)
- **Target Branch**: `feat/github-action-ci`

### Goal
Provide a reusable, zero-dependency composite GitHub Action (`action.yml`) and CI runner enabling teams to automate multi-lens code reviews, incremental re-reviews, and quality gates directly inside GitHub Actions workflows.

### Requirements & Architecture
1. **Action Definition (`action.yml`)**:
   - Inputs:
     - `github_token`: GitHub token (default: `${{ github.token }}`).
     - `pr_number`: PR number (optional; auto-detected from `GITHUB_EVENT_PATH`).
     - `mode`: Review mode (`quick`, `balanced`, `full`, `deep`, default: `balanced`).
     - `incremental`: Auto-detect or force incremental review (`auto`, `true`, `false`, default: `auto`).
     - `fail_on`: Quality gate severity threshold (`P0`, `P1`, `P2`, `none`, default: `none`).
     - `action`: Review action (`publish`, `dry-run`, default: `publish`).
     - `select`: Finding filter or interactive specification (optional).
   - Outputs:
     - `verdict`: `PASS` or `FAIL`.
     - `findings_count`: Total findings detected.
     - `blocking_count`: Number of blocking findings.
     - `summary`: Markdown review summary.
2. **Automated Event Detection**:
   - Inspects `GITHUB_EVENT_PATH` to resolve PR number, repository, and action (`opened`, `synchronize`, `reopened`).
   - On `synchronize` events, automatically enables `--incremental` re-review mode.
3. **CI Quality Gate**:
   - Exits with code 1 if findings meet or exceed `fail_on` threshold, allowing branch protection rules to block merging when defects are found.
4. **Starter Workflow & Documentation**:
   - Add template workflow `.github/workflows/gem-pr-review.yml`.
   - Document GitHub Action usage and examples in `README.md` and `skills/gem-pr-review/SKILL.md`.
5. **Test-First Verification**:
   - Unit tests covering `action.yml` metadata, event payload parser, environment variable resolution, and step outputs.

---

## Ready-to-Use Prompt for the Next Session

```text
Please implement Increment 13 on this repository: "Reusable GitHub Action & Automated CI Review Workflow (action.yml)" (addressing Issue #22: https://github.com/xpepper/pr-review-gemini/issues/22).

Before writing code:
1. Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md.
2. Confirm git working tree is clean on main, then create a feature branch: feat/github-action-ci.

Implementation requirements:
- Action Manifest (action.yml): Implement a standard composite GitHub Action at repo root with inputs (github_token, pr_number, mode, fail_on, incremental, action) and outputs (verdict, findings_count, blocking_count, summary).
- Event Payload Detection: Automatically extract PR number and repo from GITHUB_EVENT_PATH, automatically selecting incremental mode on synchronize events.
- CI Quality Gate: Fail the step (exit 1) if blocking defects meet or exceed the fail_on threshold.
- Reusable Starter Workflow: Add .github/workflows/gem-pr-review.yml illustrating automated CI reviews.
- Test-First Verification: Add unit tests verifying action.yml schema, event payload parsing, and output generation, keeping all 310+ existing tests passing.
- Dogfood Review & PR: Run dogfood review against your PR, commit with conventional commits, update TODO.md and HANDOFF.md, and submit a pull request against main.
```




