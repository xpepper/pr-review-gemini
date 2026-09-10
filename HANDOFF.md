# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `main` (clean, up to date with `origin/main`)
* **Test Suite**: `npm test` runs and passes (191 tests across 50 suites, 0 failures)
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
  - PR #13 (Increment 8): `feat: implement large-diff transport and file-backed paging (> 200 KB)` (Merged)

---

## Status: INCREMENT_8_COMPLETE / PHASE_7_IN_PROGRESS

Increment 8 is fully implemented, verified test-first (191 passing tests across 50 suites), auto-reviewed via dogfood AI review published to GitHub PR #13, and documented in `README.md` and `skills/gem-pr-review/SKILL.md`.
Phase 7 backlog:
- [x] Increment 8: Large-diff file-backed transport (> 200 KB)
- [ ] Increment 9: Interactive finding selection UI & cached publish-later
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

## Next Session Mission: Increment 9 / Issue #14 — Interactive Finding Selection & Cached Publish-Later

- **GitHub Issue**: [#14: feat: interactive finding selection and cached publish-later](https://github.com/xpepper/pr-review-gemini/issues/14)
- **Target Branch**: `feat/interactive-selection`

### Goal
Implement interactive finding selection before publishing reviews, allowing reviewers to triage findings interactively or via batch selection flags (`--all`), and support in-session cached retention (`publish-later` / `publish-cached`) so reviewers can inspect findings and publish without re-evaluating costly model inference passes.

### Requirements & Architecture
1. **Interactive Finding Selection**:
   - Provide an interactive prompt or CLI flags (e.g. `--all` vs interactive triage) in `scripts/dogfood-review.mjs` and reviewer orchestrator before publishing review comments to GitHub.
   - Display a clean, actionable selection table showing finding severity (`P0`–`P3`, `nit`), confidence score, file path, line number, and title.
   - Allow selecting/unselecting findings individually or by severity threshold.
2. **In-Session Caching & Publish-Later**:
   - Cache reviewed findings in an in-memory session or temporary artifact cache keyed by PR number and head commit SHA.
   - Support publishing cached findings directly without rerunning specialist subagent passes (`--publish-cached` CLI option and MCP tool `gem_pr_review_publish_cached`).
   - Freshness & Invalidation: Verify that cached findings match the current PR head SHA; invalidate if the head commit has moved.
3. **Host-Gating Preserved**:
   - Ensure all published comments remain strictly subject to host-enforced hunk validation, author checks, and safety rules.
4. **Test-First Verification**:
   - Add unit tests for interactive selection filtering, cache persistence/retrieval, stale-head cache rejection, and CLI parameter parsing.

---

## Ready-to-Use Prompt for the Next Session

```text
Please implement Increment 9 on this repository: "Interactive Finding Selection & Cached Publish-Later" (addressing Issue #14: https://github.com/xpepper/pr-review-gemini/issues/14).

Before writing code:
1. Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md.
2. Confirm git working tree is clean on main, then create a feature branch: feat/interactive-selection.

Implementation requirements:
- Interactive Finding Selection: Provide interactive selection UI / CLI controls (--all vs choosing specific findings) before publishing reviews to GitHub, showing severity, confidence, location, and title.
- In-Session Caching (Publish-Later): Store reviewed findings in a cache keyed by PR and head SHA to allow publishing without rerunning subagent model inference (supporting --publish-cached and MCP tool gem_pr_review_publish_cached).
- Freshness & Invalidation: Reject/invalidate cached findings if the PR head SHA has changed.
- Preservation of host-gated publishing guarantees: Selected findings must still be verified against diff hunks and pass all safety checks.
- Test-First Verification: Follow test-first development in small verified steps, keeping all 191+ tests passing and adding unit tests for selection and caching.
- Dogfood Review & PR: Run dogfood review against your PR, commit with conventional commits, update TODO.md and HANDOFF.md, and submit a pull request against main.
```

