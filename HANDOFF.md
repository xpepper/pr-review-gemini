# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `feat/11-per-lens-overrides`
* **Test Suite**: `npm test` runs and passes (165 tests across 47 suites, 0 failures)
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
  - Issue #11 (Increment 7b): `feat: allow per-lens model and reasoning-effort overrides`

---

## Status: ISSUE_11_COMPLETE / PHASE_7_PLANNED

Issue #11 is fully implemented, verified test-first (165 passing tests across 47 suites), auto-reviewed via dogfood AI review, and documented in `README.md`.
Phase 7 has been scoped and planned to capture next-generation features inspired by `pi-pr-review` (excluding artificial timeouts):
- Increment 8: Large-diff file-backed transport (> 200 KB)
- Increment 9: Interactive finding selection UI & cached publish-later
- Increment 10: Automatic fallback model retry on quota/capacity errors (without timeouts)
- Increment 11: One-shot coding-task self-review (`gem_self_review`)
- Increment 12: Candidate finding recovery from degraded/malformed model outputs

---

## Architecture Summary of the Completed Package

1. **Manifest & Standards (Agent Plugins 1.0)**:
   - `plugin.json`: Compliant package manifest.
   - `mcp.json`: Model Context Protocol server configuration exposing tools.
   - `skills/pr-review/SKILL.md`: Declarative agent skill with multi-lens instructions, mode flags (`--quick`, `--balanced`, `--full`, `--deep`), and prior finding revalidation guidelines.

2. **Core Modules (`src/`)**:
   - `src/config.js`: Layered configuration management (`~/.copilot/pr-review.json` and `.github/pr-review.json`), model tiers (`light`, `medium`, `heavy`), reasoning efforts (`off` to `high`), and per-lens overrides (`lenses`).
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

## Completed Work: Issue #11 — Per-Lens Model & Reasoning-Effort Overrides

- **GitHub Issue**: [#11: feat: allow per-lens model and reasoning-effort overrides](https://github.com/xpepper/pr-review-gemini/issues/11)
- **Changes Delivered**:
  - `src/config.js`: Extended `DEFAULT_CONFIG` with `lenses: Object.freeze({})` and `resolveConfig` / `loadConfig` to validate, parse, and merge per-lens overrides (`model`, `reasoningEffort`, `tier`) with prototype pollution defense (`UNSAFE_OBJECT_KEYS`).
  - `src/subagents.js`: Updated `resolveLensPlan()` to apply precedence: `lens override -> tier configuration -> plugin defaults`.
  - `README.md`: Corrected `reasoningEfforts` example keys to `light`/`medium`/`heavy` and documented the `lenses` configuration schema and resolution precedence.
  - Tests: Added 10 comprehensive test cases across `tests/config.test.mjs` and `tests/subagents.test.mjs`, bringing total test count to 165 passing tests across 47 suites.
  - AI Dogfood Review: Triaged and addressed findings from dogfood code review on PR #12.

---

## Next Session Mission: Increment 8 — Large-Diff Transport & File-Backed Paging (> 200 KB)

### Goal
Implement large-diff detection and file-backed paging transport to prevent context overflow when reviewing pull requests with diffs exceeding 200 KB.

### Requirements & Architecture
1. **Threshold Detection**: Detect when raw unified diff exceeds 200 KB.
2. **File-Backed Transport**:
   - Store diff in temporary file or structured manifest.
   - Supply subagents with a bounded changed-file manifest and host-enforced read tools (`read`, `grep`, `find`).
3. **Capped Host Access**: Cap subagent read calls (e.g. ~640 KB across 16 reads) up to 1 MB maximum.
4. **Test-First Verification**: Unit test detection threshold, manifest generation, and supervised read tools in `tests/diff.test.mjs` and `tests/subagents.test.mjs`.

---

## Ready-to-Use Prompt for the Next Session

```text
Please implement Increment 8: "Large-Diff Transport & File-Backed Paging (> 200 KB)".
Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md before starting.
Work in a feature branch (feat/large-diff-transport), follow test-first development in small verified steps, run the full test suite (npm test), and submit a pull request for review.
```

