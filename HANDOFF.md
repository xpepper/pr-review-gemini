# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `main` (clean, up to date with `origin/main`)
* **Test Suite**: `npm test` runs and passes (155 tests across 47 suites, 0 failures)
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

---

## Status: PHASE_6_COMPLETE / PHASE_7_PLANNED

All 7 core roadmap increments specified in `docs/roadmap.md` and `TODO.md` are fully implemented, verified with test-first suites, reviewed via our dogfood AI reviewer, and merged into `main`.
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
   - `src/config.js`: Layered configuration management (`~/.copilot/pr-review.json` and `.github/pr-review.json`), model tiers (`light`, `medium`, `heavy`), and reasoning efforts (`off` to `high`).
   - `src/diff.js`: Unified diff parser, git hunk header extraction, and commentability safety gates.
   - `src/publish.js`: Host-gated review publisher with diff anchor validation, comment capping (50), stale-head protection, and gated `APPROVE`/`COMMENT` logic.
   - `src/reviewer.js`: Multi-lens review orchestrator, finding deduplication, and mode planning.
   - `src/subagents.js`: Parallel subagent dispatcher leveraging `@github/copilot-sdk`.
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

## Next Session Mission: Issue #11 — Per-Lens Model & Reasoning-Effort Overrides

### Issue Reference
- **GitHub Issue**: [#11: feat: allow per-lens model and reasoning-effort overrides](https://github.com/xpepper/pr-review-gemini/issues/11)
- **Goal**: Decouple model selection across specialist lenses by supporting an optional `lenses` configuration layer above model tiers.

### Problem Statement
Currently, models and reasoning efforts are configured only at the shared tier level (`light`, `medium`, `heavy`). Lenses mapped to the same tier (e.g. `correctness` and `security` both using `heavy`) cannot be given distinct models or reasoning efforts without changing implementation code.

### Proposed Solution & Schema
Extend configuration (`~/.copilot/gem-pr-review.json` and `.github/gem-pr-review.json`) with an optional `lenses` object:
```json
{
  "tiers": {
    "light": "gpt-5-mini",
    "medium": "claude-sonnet-5",
    "heavy": "gpt-5.6-terra"
  },
  "reasoningEfforts": {
    "light": "off",
    "medium": "off",
    "heavy": "medium"
  },
  "lenses": {
    "correctness": {
      "model": "gpt-5.6-terra",
      "reasoningEffort": "high"
    },
    "security": {
      "model": "claude-opus-5",
      "reasoningEffort": "high"
    }
  }
}
```

### Resolution Precedence
$$\text{lens override} \longrightarrow \text{tier configuration} \longrightarrow \text{plugin defaults}$$

1. **Model**: `config.lenses?.[lensId]?.model` $\to$ `getModelForTier(config, tier)` $\to$ `DEFAULT_CONFIG.tiers[tier]`
2. **Reasoning Effort**: `config.lenses?.[lensId]?.reasoningEffort` $\to$ `config.reasoningEfforts?.[tier]` $\to$ default lens assignment
3. **Tier (optional override)**: `config.lenses?.[lensId]?.tier` $\to$ mode default tier

### User-Facing & Agent-Facing Documentation to Update
1. **`README.md`**:
   - Fix the `reasoningEfforts` example (lines 178–182), which previously used mode names (`deep`, `balanced`, `quick`) instead of valid tier names (`light`, `medium`, `heavy`).
   - Add documentation and JSON snippet for the new `lenses` configuration section.
2. **`TODO.md`**:
   - Mark Issue #11 checklist items as in-progress / completed.
3. **`docs/roadmap.md`**:
   - Record Increment 7b or Issue #11 resolution.

### Step-by-Step Implementation Instructions for the Next Agent
1. **Branch**: Create `feat/11-per-lens-overrides` from `main`.
2. **Test-First Configuration**:
   - In `tests/config.test.mjs`, add tests for:
     - `resolveConfig()` parsing valid `lenses` overrides (`model`, `reasoningEffort`, `tier`).
     - Ignoring invalid/malformed lens entries.
     - Merging project-level and user-level `lenses` overrides.
   - Update `src/config.js` to implement `lenses` parsing in `resolveConfig` and default `lenses: Object.freeze({})` in `DEFAULT_CONFIG`.
3. **Test-First Plan Resolution**:
   - In `tests/subagents.test.mjs`, add tests verifying that `resolveLensPlan()` applies per-lens model and reasoning effort overrides when configured.
   - Update `src/subagents.js`: In `resolveLensPlan()`, check `resolvedConfig.lenses?.[lensId]` to override `model`, `reasoningEffort`, or `tier`.
4. **Documentation**:
   - Update `README.md` with correct `reasoningEfforts` keys and `lenses` examples.
5. **Verification**:
   - Run `npm test` (must remain 100% passing).
   - Commit with conventional commit: `feat(config): support per-lens model and reasoning effort overrides (#11)`.
   - Push and open a GitHub PR for Issue #11, running a dogfood review before merge.

---

## Ready-to-Use Prompt for the Next Session

```text
Please address GitHub Issue #11 on this repository: "feat: allow per-lens model and reasoning-effort overrides".
Read HANDOFF.md, TODO.md, AGENTS.md, and docs/roadmap.md before starting.
Work in a feature branch (feat/11-per-lens-overrides), follow test-first development in small verified steps, update both user-facing documentation (README.md reasoningEfforts fix & lenses schema) and agent-facing docs (TODO.md, HANDOFF.md), run the full test suite (npm test), and submit a pull request for review.
```

