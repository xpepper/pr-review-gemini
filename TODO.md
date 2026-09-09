# Implementation Plan & Progress: Copilot PR Review

## Core Principles
1. **Small, Sequential Increments**: Build from the ground up in small, provable, test-backed increments developed in sequence. Avoid large upfront designs that can't be validated early.
2. **Eat Our Own Dogfood (Auto-Review ASAP)**: As soon as a minimal reviewer is capable of running, review our subsequent PR increments using this tool on GitHub.

---

## Roadmap

### Phase 1: Groundwork & Repository Setup
- [x] Initialize repository with `.gitignore`, `package.json`, `plugin.json`, `README.md`, and `TODO.md`.
- [x] Connect remote and push initial commit to GitHub (`xpepper/pr-review-gemini`).
- [x] Configure test runner (`node:test`) and initial verification suite.

### Phase 2: Configuration & Model Tiers
- [ ] Design configuration schema (`~/.copilot/pr-review.json` & `.github/pr-review.json`).
- [ ] Implement config loader for model tiers (`light`, `medium`, `heavy`) & reasoning efforts (`low`, `medium`, `high`, `off`).
- [ ] Unit test config loading, fallbacks, and validation.

### Phase 3: Diff Acquisition & Hunk Anchoring (MCP Tool)
- [ ] Create minimal MCP server structure (`mcp.json` + `server/`).
- [ ] Implement `pr_review_get_diff` (fetching via `gh` CLI).
- [ ] Implement unified diff hunk parser (extracting valid hunk ranges for inline comments).
- [ ] Unit test diff parser against representative multi-file, rename, add, and delete diffs.

### Phase 4: Minimum Viable Reviewer (First Dogfooding Target)
- [ ] Create `skills/pr-review/SKILL.md` with core review prompt and basic review lens.
- [ ] Implement `pr_review_publish` (host-gated review publishing with diff-anchor validation and safety gates).
- [ ] End-to-end dry run on a synthetic or test PR to verify the complete dogfood loop.

### Phase 5: Multi-Lens Parallel Subagents via Copilot SDK
- [ ] Implement `pr_review_subagents` using `@github/copilot-sdk`.
- [ ] Connect tier mapping (`light`, `medium`, `heavy`) and reasoning effort per lens.
- [ ] Support review modes (`--quick`, `--balanced`, `--full`, `--deep`).

### Phase 6: Incremental Re-reviews & Advanced Features
- [ ] Implement `pr_review_prior` discovery for `--incremental` re-reviews.
- [ ] Implement detached-worktree test verification (`pr_review_verify`).
- [ ] Gated approval policies (`approveMaxPriorityLevel`).
