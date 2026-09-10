# Implementation Plan & Progress: Copilot PR Review

## Core Principles
1. **Small, Sequential Increments**: Build from the ground up in small, provable, test-backed increments developed in sequence. Avoid large upfront designs that can't be validated early.
2. **Eat Our Own Dogfood (Auto-Review ASAP)**: As soon as a minimal reviewer is capable of running, review our subsequent PR increments using this tool on GitHub.

---

## Active Next Task: Increment 14 / Phase 8 Ideas
- [ ] Additional Specialist Lenses (e.g. Accessibility / a11y, Database Migration safety).
- [ ] Streamlined Pre-Commit Hook Installer (`--install-hook` setting up pre-commit self-review).

---

## Completed Increments
- [x] **Increment 13 / Issue #22: Reusable GitHub Action & Automated CI Review Workflow (action.yml)**
  - [x] Defined composite GitHub Action manifest (`action.yml`) at repository root with inputs (`github_token`, `pr_number`, `mode`, `fail_on`, `incremental`, `action`, `select`) and outputs (`verdict`, `findings_count`, `blocking_count`, `summary`).
  - [x] Implemented CI event payload resolution (`parseEventPayload`, `resolveCiEnvironment`) in `src/ci.js` (auto-extracting PR number, repository, and commit SHAs from `GITHUB_EVENT_PATH` and auto-selecting `--incremental` on `synchronize` events).
  - [x] Implemented CI quality gate (`evaluateCiQualityGate`) and runner (`scripts/ci-action.mjs`) exiting with code 1 when blocking defects meet or exceed `fail_on` threshold (e.g. `fail_on: P1`).
  - [x] Implemented GitHub Actions multiline step outputs and summary formatting (`writeGitHubStepOutputs`, `formatCiSummary`).
  - [x] Added starter workflow template `.github/workflows/gem-pr-review.yml`.
  - [x] 24 new unit and integration tests across `tests/ci.test.mjs` and `tests/skills.test.mjs` (334 tests passing across 82 suites).
  - [x] Comprehensive documentation in `README.md` and `skills/gem-pr-review/SKILL.md`.
- [x] **Increment 12 / Issue #20: Candidate Finding Recovery from Degraded/Malformed Model Output**
  - [x] Resilient envelope extraction (`extractJsonEnvelope`) handling unclosed or truncated `<<<PR_REVIEW_JSON>>>` markers and markdown code fences.
  - [x] Deterministic JSON repair (`repairJsonString`) resolving trailing commas, missing closing brackets/braces, unescaped literal newlines in commentary, comments, and smart quotes.
  - [x] Balanced-brace candidate scanner (`extractCandidateObjects`) recovering individual finding objects from corrupted arrays, truncated tails, or mixed prose with regex field extraction fallback.
  - [x] Structured contract validation and normalization (`normalizeFindingCandidate`, `isValidFindingCandidate`) for severities (standard P0-nit and descriptive mappings), line numbers, file paths, and confidence scores.
  - [x] Seamless pipeline integration into `parseMarkdownFindings` in `src/publish.js`, `src/subagents.js`, and `src/self-review.js`.
  - [x] 29 new unit and integration tests across `tests/recovery.test.mjs`, `tests/publish.test.mjs`, `tests/subagents.test.mjs`, `tests/self-review.test.mjs`, and `tests/skills.test.mjs` (309 tests passing across 74 suites).
  - [x] Documentation in `README.md` and `skills/gem-pr-review/SKILL.md`.
- [x] **Increment 11 / Issue #18: One-Shot Coding-Task Self-Review (`gem_self_review`)**
  - [x] Local git worktree diff acquisition (`getWorktreeDiff`) across staged changes (`git diff --cached`), unstaged modifications (`git diff`), and untracked files (`git status --porcelain`).
  - [x] Synthetic unified diff generator (`generateSyntheticDiff`) for untracked files with valid headers and line commentability.
  - [x] Local multi-lens self-review engine (`src/self-review.js`, `runSelfReview`) without remote GitHub PR or network mutation dependencies.
  - [x] Fail-closed safety gate (`evaluateSelfReviewVerdict`): returns explicit `passed` vs `failed` status (`PASS` vs `FAIL`), blocking completion on P0 or P1 defects with actionable remediation instructions.
  - [x] MCP tools integration (`gem_self_review` and alias `gem_pr_review_self`) in `server/index.js`.
  - [x] CLI runners: `scripts/self-review.mjs` (and npm script `npm run self-review`) and `--self` flag in `scripts/dogfood-review.mjs`.
  - [x] 31 new unit tests across `tests/self-review.test.mjs`, `tests/mcp-server.test.mjs`, `tests/dogfood.test.mjs`, and `tests/skills.test.mjs` (280 tests passing across 68 suites).
  - [x] Documentation in `README.md` and `skills/gem-pr-review/SKILL.md`.
- [x] **Increment 10 / Issue #16: Automatic Fallback Model Retry on Quota/Capacity Errors (without timeouts)**
  - [x] Fallback tier configuration (`heavy_fallbacks`, `medium_fallbacks`, `light_fallbacks`, `fallbacks`) in `src/config.js` and per-lens fallbacks.
  - [x] Accurate quota & capacity error classification (`isQuotaOrCapacityError`, `isQuotaError`, HTTP 429, resource exhaustion, capacity overload) in `src/subagents.js` without swallowing unrelated bugs.
  - [x] Automatic failover retry in `dispatchSubagentsParallel` and `runReview` to retry failing lenses against configured fallback models without dropping completed sibling lens passes.
  - [x] Zero plugin-imposed timeouts or stuck-reviewer heuristics.
  - [x] 20 new unit tests across `tests/config.test.mjs`, `tests/subagents.test.mjs`, `tests/reviewer.test.mjs`, and `tests/skills.test.mjs` (249 tests passing across 62 suites).
  - [x] Documentation in `README.md` and `skills/gem-pr-review/SKILL.md`.
- [x] **Increment 9: Interactive Finding Selection & Cached Publish-Later (Issue #14)**
  - [x] Interactive console finding table (`formatFindingsTable`, `formatFindingRow`) showing index, severity, confidence, location, and title.
  - [x] Flexible finding selection parser (`parseSelectionInput`) supporting indices (`1, 3`), ranges (`2-4`), exclusions (`-2`, `!3`), and severity filters (`p0, p1`, `min:p2`, `no-nits`).
  - [x] In-session / workspace review caching (`saveReviewCache`, `getReviewCache`, `invalidateReviewCache`, `listReviewCaches`) keyed by PR number and head commit SHA.
  - [x] Head freshness and stale cache rejection/invalidation preventing obsolete comment anchoring.
  - [x] MCP tool `gem_pr_review_publish_cached` to publish without rerunning model inference passes.
  - [x] CLI flags `--publish-cached`, `--all`, `--interactive`, and `--select` in `scripts/dogfood-review.mjs`.
  - [x] 38 new unit tests across 4 test suites (229 tests passing across 61 suites).
- [x] **Increment 8: Large-Diff Transport & File-Backed Paging (> 200 KB)**
  - [x] Threshold detection (`LARGE_DIFF_THRESHOLD_BYTES = 200 * 1024`) in diff acquisition and reviewer pipeline.
  - [x] File-backed diff transport (`createFileBackedDiff`) with secure temporary lifecycle and cleanup.
  - [x] Structured changed-file manifest (`generateDiffManifest`, `formatDiffManifest`) with file statuses, line additions/deletions, and byte sizes.
  - [x] Host-supervised reading tools (`diff_read`, `diff_grep`, `diff_find`) capped at ~640 KB across 16 reads (up to 1 MB maximum) with path traversal defenses.
  - [x] MCP tools integration (`gem_pr_review_diff_read` and enhanced `gem_pr_review_diff`).
  - [x] Agent skill update (`skills/gem-pr-review/SKILL.md`) and documentation in `README.md`.
  - [x] 26 new unit tests across 5 test suites (191 tests passing).
  - [x] Merged via PR #13 after dogfood review.
- [x] **Increment 7b / Issue #11: Per-Lens Model & Reasoning-Effort Overrides**
  - [x] Configuration support in `src/config.js` (`resolveConfig`, `loadConfig`) for `lenses: { [lensId]: { model, reasoningEffort, tier } }`.
  - [x] Resolution precedence in `src/subagents.js`: `lens override -> tier configuration -> plugin defaults`.
  - [x] Prototype pollution defense on untrusted lens keys (`UNSAFE_OBJECT_KEYS`).
  - [x] Documentation fixes in `README.md` (`reasoningEfforts` keys using `light`/`medium`/`heavy` and `lenses` schema).
  - [x] 10 unit tests in `tests/config.test.mjs` and `tests/subagents.test.mjs` (165 tests passing).
  - [x] Merged via PR #12.

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
- [x] **Increment 8: Large-Diff Transport & File-Backed Paging (> 200 KB)**: File-backed diff transport with bounded changed-file manifest and read tools (`read`, `grep`, `find`) to handle large PRs without context overflow.
- [x] **Increment 9: Interactive Finding Selection & Cached Publish-Later**: Interactive selection UI before posting (`--all` vs picking specific findings) and in-session retention to publish without rerunning inference.
- [x] **Increment 10: Automatic Fallback Model Retry on Quota / Rate-Limit**: Automatic retry with configured fallback tier (e.g. `heavy_fallbacks`) on quota or capacity errors, without plugin-imposed timeouts.
- [x] **Increment 11: One-Shot Coding-Task Self-Review (`gem_self_review`)**: Fail-closed tool for coding agents to inspect uncommitted git worktree changes (staged, tracked, untracked) before concluding a task.
- [ ] **Increment 12: Candidate Finding Recovery from Degraded/Malformed Model Output**: Deterministically recover contract-valid candidate findings from partial/malformed model output rather than dropping entire review passes.

