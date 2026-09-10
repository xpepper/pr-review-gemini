# Copilot PR Review: Architecture, Porting Analysis & Roadmap

## 1. Background & Porting Analysis

This project ports **[`pi-pr-review`](https://pi.dev/packages/pi-pr-review?name=review)**—a multi-lens, parallel AI code review extension originally built for the Pi coding agent—to **GitHub Copilot CLI** while adhering to the **[Agent Plugins 1.0 specification](https://agent-plugins.org/)**.

### Original `pi-pr-review` Capabilities
1. **Parallel Specialist Lenses**: Dispatches independent subagents across specialized review domains (correctness/concurrency, contracts/data, security, performance/resources, conventions/maintainability).
2. **Model Tiering & Reasoning Effort**: Configurable model tiers (`light`, `medium`, `heavy`) with reasoning efforts/thinking levels (`off` to `max`).
3. **Structured Findings Contract**: Severity levels (`P0`, `P1`, `P2`, `P3`, `nit`), confidence scoring (0.0–1.0), and hunk-anchored diff locations.
4. **Host-Gated Publishing**: Ensures the LLM never directly calls write APIs. Host code validates diff anchors against actual `@@ -old,+new @@` hunks, enforces stale checks, deriving safe `COMMENT` or gated `APPROVE` reviews.
5. **Incremental Re-reviews (`--incremental`)**: Revalidates prior review findings (`resolved`, `still open`, `obsolete`) and hunts only the new commit range (`prior_head...current_head`).
6. **Detached Worktree Verification (`pr_review_verify`)**: Executes user-configured test commands against the exact PR head in an isolated staging clone.

---

## 2. Target Platform & Protocol Alignment

### GitHub Copilot CLI & `@github/copilot-sdk`
* In Copilot CLI, the extension leverages `@github/copilot-sdk` (`CopilotClient` and `createSession`).
* Subagent sessions are run natively using Copilot's authenticated model catalog and subscription credits, requiring no external LLM API keys.
* Models and reasoning efforts (`low`, `medium`, `high`) are passed dynamically per review tier to `createSession({ model, reasoning_effort })`.

### Agent Plugins 1.0 Standard
* **Manifest (`plugin.json`)**: Versioned package declaration at repository root.
* **Skills (`skills/pr-review/SKILL.md`)**: Declarative prompt instructions, mode flags (`--quick`, `--balanced`, `--full`, `--deep`), and review guidelines.
* **MCP Server (`mcp.json` + `server/` or `src/`)**: Provides specialized executable tools for diff parsing, prior review discovery, test execution, and safe GitHub review publishing.

---

## 3. Prioritization Framework

| Category | Features |
| :--- | :--- |
| **Must-Have** | • Core review philosophy (grounded in diff, P0–P2 focus, bounded minor work)<br>• Review modes: `balanced` (default), `quick`, `full`, `deep`<br>• Structured Markdown contract with P0–P3/nit severities<br>• Model tiering (`light`, `medium`, `heavy`) and reasoning efforts via Copilot SDK<br>• Host-gated publishing with diff hunk-anchor validation and safe `COMMENT` posting |
| **Costly-to-Lose** | • Incremental re-reviews (`--incremental`) with prior finding revalidation<br>• Detached worktree test execution baseline (`pr_review_verify`)<br>• Gated `APPROVE` logic with author-check and priority thresholds |
| **Nice-to-Have** | • Full Agent Plugins 1.0 portability across other compliant clients<br>• One-shot self-review tool for local uncommitted changes<br>• Large-diff file-backed paging for diffs > 200 KB<br>• Secondary model-based finding extraction fallback |
| **Droppable (Pi-Specific)** | • Custom Pi TUI live viewer widget (`Ctrl+Alt+R` / `@earendil-works/pi-tui`)<br>• Pi-specific session lifecycle hooks (`pi.on`)<br>• Process-level CLI subprocess spawning (`spawn("pi")`) |

---

## 4. Core Development Principles

1. **Small, Sequential Increments**: Build from the ground up in small, provable, test-backed steps developed in sequence. Avoid large upfront designs that cannot be verified early.
2. **Eat Our Own Dog Food (Auto-Review ASAP)**: As soon as a minimum viable reviewer is functional, all subsequent increments (as GitHub PRs) will be reviewed by this tool itself before merge.

---

## 5. Implementation Increments Backlog

- [x] **Increment 0: Repository & Scaffolding**
  - Project initialized with `.gitignore`, `package.json`, `plugin.json`, and `tests/plugin-manifest.test.mjs`.
  - Pushed to GitHub (`xpepper/pr-review-gemini`).
- [x] **Increment 1: Configuration & Model Tier Management**
  - Implement `src/config.js` to manage user (`~/.copilot/pr-review.json`) and project (`.github/pr-review.json`) settings.
  - Support `tiers` (`light`, `medium`, `heavy`) and `reasoningEfforts` (`off`, `low`, `medium`, `high`).
  - Unit test config resolution, defaults, and validation.
- [x] **Increment 2: Unified Diff Parser & Hunk Anchoring**
  - Implement diff retrieval via `gh pr diff` and hunk header parser (`src/diff.js`).
  - Determine whether a line reference falls inside a hunk (`commentable: true`) with commentability safety gates.
  - Unit test against single-line, multi-line, rename, and binary diff fixtures (`tests/diff.test.mjs`).
- [x] **Increment 3: Host-Gated GitHub Review Publisher**
  - Implement `src/publish.js`: parses Markdown findings, validates diff anchors, enforces safety gates (stale-head check, demoting unanchored findings to summary notes, max 50 inline comments).
  - Test-driven with mocked `gh api` calls verifying single POST and no accidental `REQUEST_CHANGES`.
- [x] **Increment 4: Minimum Viable Reviewer (First Dogfooding Target)**
  - Create `skills/pr-review/SKILL.md` orchestrator playbook.
  - Connect skill to diff retrieval and publication tools.
  - Run the first dogfood auto-review on a PR of this repository!
- [x] **Increment 5: Copilot SDK Subagents & Multi-Lens Execution**
  - Implement MCP subagent dispatcher connecting to `@github/copilot-sdk`.
  - Support parallel execution of lenses with configured model tiers and reasoning efforts.
  - Implement modes: `--quick` (3 lenses), `--balanced` (5 lenses), `--full` (6 lenses), `--deep` (1 lens).
- [x] **Increment 6: Incremental Re-reviews (`--incremental`)**
  - Implement prior review discovery via `gh api`.
  - Classify commit relationships (`same_head`, `incremental`, `diverged`, `none`).
  - Revalidate prior findings as `resolved`, `still open`, or `obsolete`.
- [x] **Increment 7: Detached Worktree Test Verification**
  - Implement isolated test execution against PR head SHA in a detached temporary git worktree.
  - Enforce user-only profile configuration and process group cleanup.
- [x] **Increment 7b: Per-Lens Model & Reasoning Effort Overrides (#11)**
  - Decouple specialist lens models and reasoning efforts above shared tiers.
  - Implement resolution precedence: `lens override -> tier configuration -> plugin defaults`.
  - Fix `README.md` reasoning efforts documentation (`light`, `medium`, `heavy`).
- [ ] **Increment 8: Large-Diff Transport & File-Backed Paging (> 200 KB)**
  - Detect diffs exceeding 200 KB and switch to a file-backed transport instead of raw prompt inlining.
  - Provide reviewers with a bounded changed-file manifest and host-enforced read tools (`read`, `grep`, `find`) with capped access (~640 KB across 16 reads) up to 1 MB.
- [ ] **Increment 9: Interactive Finding Selection & Cached Publish-Later**
  - Implement interactive CLI/modal finding selection prior to publishing (`--all` to publish all, or interactive toggle).
  - Add in-session caching (`publish-later`) to retain reviewed findings and publish without re-evaluating model passes.
- [ ] **Increment 10: Automatic Fallback Model Retry on Quota / Rate-Limit**
  - On capacity or rate limit errors (HTTP 429), automatically dispatch the configured backup tier (e.g. `heavy_fallbacks`).
  - Keep execution timeout-free: do not impose artificial plugin-level deadlines or stuck-reviewer heuristics.
- [ ] **Increment 11: One-Shot Coding-Task Self-Review (`gem_self_review`)**
  - Expose a fail-closed tool for coding agents to review uncommitted local changes (staged, tracked, untracked) before finalizing tasks.
- [ ] **Increment 12: Candidate Finding Recovery from Degraded/Malformed Model Output**
  - Recover contract-valid candidate finding blocks from partial or malformed lane history instead of dropping passes.

