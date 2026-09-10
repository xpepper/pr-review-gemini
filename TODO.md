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
- [x] Design configuration schema (`~/.copilot/pr-review.json` & `.github/pr-review.json`).
- [x] Implement config loader for model tiers (`light`, `medium`, `heavy`) & reasoning efforts (`low`, `medium`, `high`, `off`).
- [x] Unit test config loading, fallbacks, and validation.

### Phase 3: Diff Acquisition & Hunk Anchoring (MCP Tool)
- [x] Create minimal MCP server structure (`mcp.json` + `server/`).
- [x] Implement `getPrDiff` (fetching via `gh` CLI).
- [x] Implement unified diff hunk parser (extracting valid hunk ranges for inline comments).
- [x] Unit test diff parser against representative multi-file, rename, add, and delete diffs.

### Phase 4: Minimum Viable Reviewer (First Dogfooding Target)
- [x] Create `skills/pr-review/SKILL.md` with core review prompt and basic review lens.
- [x] Implement host-gated review publisher with diff-anchor validation and safety gates (`src/publish.js`).
- [x] End-to-end dry run on a synthetic or test PR to verify the complete dogfood loop.

### Phase 5: Multi-Lens Parallel Subagents via Copilot SDK
- [x] Implement `pr_review_subagents` using `@github/copilot-sdk`.
- [x] Connect tier mapping (`light`, `medium`, `heavy`) and reasoning effort per lens.
- [x] Support review modes (`--quick`, `--balanced`, `--full`, `--deep`).

### Phase 6: Incremental Re-reviews & Advanced Features
- [x] Implement `pr_review_prior` discovery for `--incremental` re-reviews (`src/prior.js`).
- [x] Implement detached-worktree test verification (`pr_review_verify` in `src/verify.js`).
- [x] Gated approval policies (`approveMaxPriorityLevel`).

### Phase 7: Advanced Resiliency, Large Diff Transport & Interaction
- [ ] **Increment 8: Large-Diff Transport & File-Backed Paging (> 200 KB)**: File-backed diff transport with bounded changed-file manifest and read tools (`read`, `grep`, `find`) to handle large PRs without context overflow.
- [ ] **Increment 9: Interactive Finding Selection & Cached Publish-Later**: Interactive selection UI before posting (`--all` vs picking specific findings) and in-session retention to publish without rerunning inference.
- [ ] **Increment 10: Automatic Fallback Model Retry on Quota / Rate-Limit**: Automatic retry with configured fallback tier (e.g. `heavy_fallbacks`) on quota or capacity errors, without plugin-imposed timeouts.
- [ ] **Increment 11: One-Shot Coding-Task Self-Review (`gem_self_review`)**: Fail-closed tool for coding agents to inspect uncommitted git worktree changes (staged, tracked, untracked) before concluding a task.
- [ ] **Increment 12: Candidate Finding Recovery from Degraded/Malformed Model Output**: Deterministically recover contract-valid candidate findings from partial/malformed model output rather than dropping entire review passes.

