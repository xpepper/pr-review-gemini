# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `main`
* **Test Suite**: `npm test` runs and passes (229 tests across 61 suites, 0 failures)
* **All Roadmap Increments Delivered & Merged**:
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

---

## Status: INCREMENT_9_COMPLETE / PHASE_7_IN_PROGRESS

Increment 9 is fully implemented, verified test-first (229 passing tests across 61 suites), documented in `README.md` and `skills/gem-pr-review/SKILL.md`.
Phase 7 backlog:
- [x] Increment 8: Large-diff file-backed transport (> 200 KB)
- [x] Increment 9: Interactive finding selection UI & cached publish-later (Issue #14)
- [ ] Increment 10: Automatic fallback model retry on quota/capacity errors (without timeouts)
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

## Next Session Mission: Increment 10 — Automatic Fallback Model Retry on Quota/Capacity Errors (without timeouts)

- **GitHub Issue**: [#16: feat: automatic fallback model retry on quota/capacity errors (without timeouts)](https://github.com/xpepper/pr-review-gemini/issues/16)
- **Target Branch**: `feat/quota-fallback-retry`

### Goal
Implement automatic failover retry when encountering API quota exhaustion, capacity, or rate-limit errors (e.g. HTTP 429 / resource exhausted), falling back to configured secondary models (e.g. `heavy_fallbacks`) while strictly avoiding artificial timeouts or stuck-reviewer heuristics.

### Requirements & Architecture
1. **Fallback Tier Configuration (`src/config.js`)**:
   - Support fallback model chains in configuration (e.g. `heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o']`, `medium_fallbacks`, `light_fallbacks`).
   - Validate schema in `resolveConfig` and preserve backward compatibility with existing tier configs.
2. **Quota & Rate-Limit Error Detection (`src/subagents.js`)**:
   - Detect quota exhaustion, rate limits (HTTP 429), and capacity errors from Copilot SDK / LLM execution without catching unrelated syntax, network timeout, or runtime bugs.
3. **Automatic Failover Retry (`src/subagents.js`)**:
   - When a primary subagent lens fails due to quota or capacity limits, automatically retry the review pass using the next available model in the fallback tier.
   - Do not discard or rerun already-completed sibling lens results.
4. **Zero Plugin-Imposed Timeouts**:
   - Do not impose arbitrary plugin-level execution deadlines or stuck heuristics.
5. **Test-First Verification**:
   - Unit test retry loop, error classification, and configuration fallback resolution.

---

## Ready-to-Use Prompt for the Next Session

```text
Please implement Increment 10 on this repository: "Automatic Fallback Model Retry on Quota/Capacity Errors (without timeouts)" (addressing Issue #16: https://github.com/xpepper/pr-review-gemini/issues/16).

Before writing code:
1. Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md.
2. Confirm git working tree is clean on main, then create a feature branch: feat/quota-fallback-retry.

Implementation requirements:
- Fallback Tier Configuration: Support fallback model tier mappings in src/config.js (e.g. heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o'], medium_fallbacks: [...]).
- Quota & Capacity Error Detection: Reliably detect 429 / quota exhaustion / capacity errors from Copilot SDK or client execution in src/subagents.js without swallowing unrelated bugs.
- Automatic Failover Retry: When a primary lens fails due to quota/capacity limits, automatically retry that lens using the configured fallback models without dropping completed sibling lens passes.
- Zero Timeouts: Preserve timeout-free execution without artificial stuck-reviewer timers or plugin-imposed deadlines.
- Test-First Verification: Follow test-first development in small verified steps, keeping all 229+ tests passing and adding unit tests for fallback tier resolution, error detection, and retry dispatch.
- Dogfood Review & PR: Run dogfood review against your PR, commit with conventional commits, update TODO.md and HANDOFF.md, and submit a pull request against main.
```

