# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `main`
* **Test Suite**: `npm test` runs and passes (249 tests across 62 suites, 0 failures)
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

---

## Status: INCREMENT_10_COMPLETE / PHASE_7_IN_PROGRESS

Increment 10 is fully implemented, verified test-first (249 passing tests across 62 suites), documented in `README.md` and `skills/gem-pr-review/SKILL.md`.
Phase 7 backlog:
- [x] Increment 8: Large-diff file-backed transport (> 200 KB)
- [x] Increment 9: Interactive finding selection UI & cached publish-later (Issue #14)
- [x] Increment 10: Automatic fallback model retry on quota/capacity errors (without timeouts) (Issue #16)
- [ ] Increment 11: One-shot coding-task self-review (`gem_self_review`)
- [ ] Increment 12: Candidate finding recovery from degraded/malformed model outputs

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

## Next Session Mission: Increment 11 — One-Shot Coding-Task Self-Review (`gem_self_review`)

- **GitHub Issue**: [#18: feat: one-shot coding-task self-review (gem_self_review)](https://github.com/xpepper/pr-review-gemini/issues/18)
- **Target Branch**: `feat/self-review`

### Goal
Expose a fail-closed self-review tool (`gem_self_review` / `gem_pr_review_self`) for coding agents to review uncommitted local changes (staged, unstaged, untracked) before concluding a task or preparing commits, preventing subtle bugs and regressions from slipping through.

### Requirements & Architecture
1. **Local Git Worktree Diff Acquisition**:
   - Inspect uncommitted changes using git commands: staged (`git diff --cached`), unstaged (`git diff`), or combined worktree (`git diff HEAD`), including untracked files (`git status --porcelain`).
2. **Local Multi-Lens Review Engine (`src/self-review.js` or in `src/reviewer.js`)**:
   - Run specialist lenses (e.g. correctness, security, conventions) over local changes without requiring a remote GitHub PR number or network API calls.
3. **Fail-Closed Safety Gate**:
   - Return explicit verdict: `status: 'passed'` vs `status: 'failed'`.
   - Fail closed when P0 or P1 blocking issues are detected, reporting concrete remediation suggestions for the agent to fix.
4. **MCP Tool & CLI Integration**:
   - Expose MCP tool `gem_self_review` (with backward-compatible alias `gem_pr_review_self`).
   - Add CLI runner `scripts/self-review.mjs` or `--self` flag in `scripts/dogfood-review.mjs`.
5. **Zero Remote Mutations**:
   - Purely local evaluation without publishing remote GitHub reviews or modifying git state.

---

## Ready-to-Use Prompt for the Next Session

```text
Please implement Increment 11 on this repository: "One-Shot Coding-Task Self-Review (gem_self_review)" (addressing Issue #18: https://github.com/xpepper/pr-review-gemini/issues/18).

Before writing code:
1. Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md.
2. Confirm git working tree is clean on main, then create a feature branch: feat/self-review.

Implementation requirements:
- Local Diff Acquisition: Reliably acquire uncommitted worktree changes (staged, unstaged, untracked) via git without side effects.
- Self-Review Engine: Implement local multi-lens analysis (e.g. in src/self-review.js) reusing existing specialist lenses and prompt builders without requiring a remote PR number.
- Fail-Closed Safety Gate: Return explicit pass/fail status ('passed' | 'failed'), failing when blocking P0/P1 issues are detected so coding agents self-correct before finishing tasks.
- MCP Tool & CLI Runner: Expose gem_self_review (and alias gem_pr_review_self) on the MCP server and provide a CLI runner (e.g. scripts/self-review.mjs or scripts/dogfood-review.mjs --self).
- Test-First Verification: Follow test-first development in small verified steps, keeping all 249+ tests passing and adding unit tests for worktree diff acquisition, fail-closed policy, finding formatting, and MCP tool execution.
- Dogfood Review & PR: Run dogfood review against your PR, commit with conventional commits, update TODO.md and HANDOFF.md, and submit a pull request against main.
```

