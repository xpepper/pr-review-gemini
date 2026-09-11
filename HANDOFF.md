# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `feat/semantic-versioning`
* **Test Suite**: `npm test` runs and passes (414 tests across 92 suites, 0 failures)
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
  - PR #23 (Issue #22 / Increment 13): `feat: reusable GitHub Action and automated CI PR review workflow (action.yml)` (Merged, commit `9c5793b`)
  - PR #24 (Increment 14): `feat: pluggable custom review roles and specialist lenses` (Merged, commit `e70b3ce`)
  - PR #26 (Issue #25 / Increment 15): `feat: automated semantic versioning, release management, and manifest synchronization`

---

## Status: INCREMENT_15_COMPLETED / PR_READY

All 15 roadmap increments are fully implemented, verified test-first (414 passing tests across 92 suites), and dogfood-reviewed:
- [x] Increment 8: Large-diff file-backed transport (> 200 KB)
- [x] Increment 9: Interactive finding selection UI & cached publish-later (Issue #14)
- [x] Increment 10: Automatic fallback model retry on quota/capacity errors (without timeouts) (Issue #16)
- [x] Increment 11: One-shot coding-task self-review (`gem_self_review`) (Issue #18)
- [x] Increment 12: Candidate finding recovery from degraded/malformed model output (Issue #20)
- [x] Increment 13: Reusable GitHub Action & automated CI PR review workflow (Issue #22)
- [x] Increment 14: Pluggable custom review roles & specialist lenses
- [x] Increment 15: Automated semantic versioning, release management & manifest synchronization (Issue #25)

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

## Completed Work: Increment 13 — Reusable GitHub Action & Automated CI Review Workflow (Issue #22)

- **GitHub Issue**: [#22: feat: reusable GitHub Action and automated CI PR review workflow (action.yml)](https://github.com/xpepper/pr-review-gemini/issues/22)
- **Branch**: `feat/github-action-ci`
- **Changes Delivered**:
  - `action.yml`:
    - Defined composite GitHub Action at repository root (`using: "composite"`).
    - Inputs: `github_token` (default: `${{ github.token }}`), `pr_number` (auto-detected), `mode` (`balanced`), `fail_on` (`none`), `incremental` (`auto`), `action` (`publish`), `select` (optional).
    - Outputs: `verdict` (`PASS` or `FAIL`), `findings_count`, `blocking_count`, `summary`.
    - Executed via `node "${{ github.action_path }}/scripts/ci-action.mjs"`.
  - `src/ci.js`:
    - `parseEventPayload(payloadOrPath)`: Extracts PR number, target repository, commit SHAs (`headSha`, `baseSha`), sender, and webhook action (`opened`, `synchronize`, `reopened`) from GitHub webhook JSON payload or file path (`GITHUB_EVENT_PATH`).
    - `resolveCiEnvironment(options, env)`: Merges explicit CLI options, `INPUT_*` environment variables from GitHub Actions runners, event payload data, and standard GitHub environment variables (`GITHUB_REPOSITORY`, `GITHUB_TOKEN`, `GH_TOKEN`). Auto-selects `incremental = true` on `synchronize` events.
    - `evaluateCiQualityGate(findings, options)`: Evaluates findings against configurable `fail_on` severity threshold (`P0`, `P1`, `P2`, `P3`, or `none`). Returns `passed` boolean, `verdict` (`PASS`/`FAIL`), `blockingCount`, and remediation details.
    - `writeGitHubStepOutputs(outputs, options)`: Formats and appends key-value pairs and multiline outputs (using secure delimiter format) to `GITHUB_OUTPUT`.
    - `formatCiSummary({ reviewResult, qualityGateResult, ciEnv })`: Generates clean markdown reports for job logs and `GITHUB_STEP_SUMMARY`.
  - `scripts/ci-action.mjs`:
    - Dedicated GitHub Actions runner script callable via node or composite step.
    - Resolves CI environment, runs multi-lens review with diff anchoring, evaluates CI quality gate, writes step outputs, and exits with code 1 if blocking defects exist or code 0 on pass.
  - `.github/workflows/gem-pr-review.yml`:
    - Added starter workflow template configured for `pull_request: [opened, synchronize, reopened]` with `fail_on: P1`.
  - `package.json`:
    - Added npm script `"ci-review": "node scripts/ci-action.mjs"`.
  - `src/reviewer.js`:
    - Re-exported CI utilities (`parseEventPayload`, `resolveCiEnvironment`, `evaluateCiQualityGate`, `writeGitHubStepOutputs`, `formatCiSummary`).
  - Documentation & Skill:
    - Updated `skills/gem-pr-review/SKILL.md` and `README.md` with complete documentation on composite GitHub Action inputs, outputs, automated event detection, quality gate enforcement, and starter workflow.
  - Tests:
    - Added 24 new unit and integration tests across `tests/ci.test.mjs` and `tests/skills.test.mjs`.
    - Total **334 tests passing across 82 suites with 0 failures**.
  - Live CI Verification & Dogfooding:
    - GitHub Actions workflow `gem-pr-review.yml` executed `action.yml` live on GitHub runners ([Run #34529804110](https://github.com/xpepper/pr-review-gemini/actions/runs/34529804110)) on PR #23.
    - Successfully validated webhook payload parsing, automated `--incremental` re-review detection on `synchronize` event, `fail_on: P1` quality gate evaluation, and live GitHub review posting ([Review #5172237937](https://github.com/xpepper/pr-review-gemini/pull/23#pullrequestreview-5172237937)) by `github-actions[bot]`.

---

## Future Opportunities / Phase 8 Ideas

1. **Pluggable Custom Review Roles / Specialist Lenses** (Increment 14): Allow teams to define custom review roles with custom prompts, models, and reasoning efforts via configuration.
2. **Streamlined Pre-Commit Hook Installer**: A CLI helper (`npx gem-pr-review --install-hook`) to set up `.git/hooks/pre-commit` to invoke `npm run self-review`.
3. **PR Comment Reaction / Interaction**: Ability to interactively rerun specific lenses upon receiving PR comment commands (e.g. `/gem-review --quick`).

---

## Completed Work: Increment 14 — Pluggable Custom Review Roles & Specialist Lenses

- **GitHub PR**: [#24: feat: pluggable custom review roles and specialist lenses (Increment 14)](https://github.com/xpepper/pr-review-gemini/pull/24)
- **Branch**: `feat/custom-review-roles`
- **Changes Delivered**:
  - `src/config.js`:
    - Added support for `custom_roles` (and alias `roles`), `replace_standard_roles`, and `enabled_roles` to `DEFAULT_CONFIG` and `resolveConfig`.
    - Added sanitizers, prototype pollution guards (`__proto__`, `prototype`, `constructor`), and validation for role attributes (`prompt` / `instructions`, `name`, `model`, `reasoningEffort`, `tier`, `fallbacks`).
    - Exported helper functions `getCustomRoles(config)` and `formatDefaultRoleName(roleId)` with title-casing.
  - `src/subagents.js`:
    - Updated `resolveLensPlan` to dynamically mount custom roles alongside standard lenses by default.
    - Supported `replace_standard_roles: true` to execute only custom/specified roles and skip standard lenses.
    - Supported `enabled_roles` filtering to run a targeted subset of standard or custom roles.
    - Supported overriding standard lens definitions by matching role ID.
    - Maintained full backward compatibility for both object options and positional `(mode, config)` signatures.
    - Subagent parallel dispatcher (`dispatchSubagentsParallel`) executes custom roles concurrently, tags findings with custom role `lensId`, and isolates lens execution errors.
  - `src/reviewer.js`:
    - Updated `buildReviewerPrompt` to inject domain-specific instructions and checklists for custom specialist roles.
    - Updated `runReview` to forward role composition options (`roles`, `enabledRoles`, `replaceStandardRoles`, `customRoles`), evaluate execution plans, and format custom role names in markdown summaries.
  - `src/self-review.js`:
    - Updated `runSelfReview` to resolve and execute custom roles over local git worktree diffs.
    - Formatted custom role names in the evaluated lenses summary and fail-closed quality gate report.
  - `server/index.js` (MCP Server):
    - Extended input schemas for `gem_pr_review_subagents`, `gem_self_review`, and `gem_pr_review_self` to declare `roles`, `replaceStandardRoles`, and `customRoles`.
    - Forwarded role arguments to `runReview` and `runSelfReview`.
  - `scripts/dogfood-review.mjs` & `scripts/self-review.mjs`:
    - Added CLI flags `--role <id>` (repeatable or comma-separated: `--role=a11y,perf` or `--role a11y --role perf`) and `--replace-standard-roles`.
  - `skills/gem-pr-review/SKILL.md` & `README.md`:
    - Fully documented custom roles schema, role composition options, CLI flags, and MCP tool parameters with realistic configuration examples (accessibility, database migrations).
  - Tests & PR Review Loop:
    - Added 37 new tests across `tests/config.test.mjs`, `tests/subagents.test.mjs`, `tests/reviewer.test.mjs`, `tests/self-review.test.mjs`, `tests/mcp-server.test.mjs`, `tests/dogfood.test.mjs`, and `tests/skills.test.mjs`. Total 371 tests passing across 83 suites.
    - Executed `/pr-review-loop` on PR #24 addressing all 7 review comments from `@copilot-pull-request-reviewer` with dedicated commits, verified replies, and resolved threads.

## Completed Work: Increment 15 — Automated Semantic Versioning, Release Management & Manifest Synchronization (Issue #25)

- **GitHub Issue**: [#25: feat: automated semantic versioning, release management, and manifest synchronization (Increment 15)](https://github.com/xpepper/pr-review-gemini/issues/25)
- **Branch**: `feat/semantic-versioning`
- **Changes Delivered**:
  - `src/version.js`:
    - Canonical runtime version module dynamically resolving plugin and package version from `package.json` without hardcoding strings.
    - Exported `VERSION`, `PLUGIN_VERSION`, `PLUGIN_NAME`.
    - Implemented SemVer 2.0 validation (`isValidSemVer`, `parseSemVer`).
    - Implemented multi-manifest version inspection (`getManifestVersions`) and strict drift detection (`checkManifestSync`).
  - `src/semver.js`:
    - Conventional commit message parser (`parseConventionalCommit`) extracting commit type, optional scope, description, PR numbers (`#\d+`), and breaking change indicators (`!`, `BREAKING CHANGE:`).
    - Automated SemVer bump evaluation (`determineSemverBump`): priority major (breaking changes) > minor (`feat:`) > patch (`fix:`, `perf:`, `chore:`, `docs:`, `refactor:`).
    - `calculateNextVersion`: increments SemVer versions according to bump type or explicit version target.
    - `generateChangelog`: formats categorized Markdown release notes with features, bug fixes, breaking changes, chores, and PR links.
    - `getGitCommitsSinceTag`: retrieves and parses git commits since latest git tag (or from root if untagged).
    - `bumpManifestVersions`: atomically synchronizes and updates `package.json`, `plugin.json`, `mcp.json`, and `skills/gem-pr-review/SKILL.md` (with `--dry-run` safety).
  - `scripts/bump-version.mjs`:
    - Zero-dependency CLI bump utility supporting `patch`, `minor`, `major`, `<explicit-version>`, and `auto` bump types.
    - Flags: `--check` (verifies all manifests are in sync, exits 0 if synced, 1 if drift), `--dry-run`, `--changelog`, `--write-changelog` (updates `CHANGELOG.md`), `--tag`, and `--release`.
  - `server/index.js` (MCP Server):
    - Replaced hardcoded version `'0.1.0'` with dynamic `PLUGIN_VERSION` in MCP `initialize` response (`serverInfo.version`).
  - `src/reviewer.js`:
    - Injected canonical version into PR review summary headers (`## PR Review Summary (gem-pr-review v${PLUGIN_VERSION}, Mode: ...)`).
    - Re-exported version and SemVer utilities.
  - CLI Version Flags (`-v` and `--version`):
    - Added to `scripts/dogfood-review.mjs`
    - Added to `scripts/self-review.mjs`
    - Added to `scripts/ci-action.mjs`
    - Added to `scripts/bump-version.mjs`
  - Release Automation (`.github/workflows/release.yml`):
    - Automated GitHub Actions release workflow triggering on `v*` tag pushes or workflow dispatch.
    - Verifies manifest synchronization, runs tests, generates changelog, and publishes GitHub Release via `gh release create`.
  - `package.json`:
    - Added npm scripts: `"version:check": "node scripts/bump-version.mjs --check"`, `"bump": "node scripts/bump-version.mjs"`, `"release": "node scripts/bump-version.mjs auto --release"`.
  - `skills/gem-pr-review/SKILL.md` & `README.md`:
    - Documented dynamic versioning, multi-manifest synchronization, CLI version flags, and release automation.
  - Tests & PR Review Loops:
    - Added 43 new unit and integration tests across `tests/version.test.mjs`, `tests/ci.test.mjs`, and `tests/skills.test.mjs`.
    - Total **414 tests passing across 92 suites with 0 failures**.
    - Executed `/pr-review-loop` resolving all 11 findings from Copilot reviewer and all 5 findings from the real dogfood review (16 total comments and threads verified and resolved).

---

## Future Opportunities / Phase 8 Ideas

1. **Streamlined Pre-Commit Hook Installer**: A CLI helper (`npx gem-pr-review --install-hook`) to set up `.git/hooks/pre-commit` to invoke `npm run self-review`.
2. **PR Comment Reaction / Interaction**: Ability to interactively rerun specific lenses upon receiving PR comment commands (e.g. `/gem-review --quick`).
3. **SARIF Report Export**: Export structured findings to standard SARIF format for GitHub Code Scanning integration.


