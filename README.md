# Gem PR Review

Parallel, multi-lens AI code review for GitHub pull requests, adhering to the [Agent Plugins 1.0](https://agent-plugins.org/) standard.

Evaluates pull requests across specialized lenses (correctness, contracts, security, performance, conventions, tests), anchors comments strictly in actual git diff hunks to eliminate hallucinations, supports incremental re-reviews on updated commits, and executes tests in detached worktrees.

---

## Quick Start (Get Started in 30 Seconds)

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **GitHub CLI (`gh`)**: Authenticated (`gh auth status`)

### 1. Run via Streamlined Dogfood Command
Review any open pull request with automatic model resolution (`--model auto`):
```bash
npm run dogfood:pr <PR_NUMBER>
```

### 2. Run via CLI (Dry-Run)
Inspect review findings on any pull request without publishing comments to GitHub:
```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --dry-run
```

To test the review pipeline instantly without model inference or API keys, use `--mock`:
```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --mock --dry-run
```

### 3. Run via GitHub Copilot CLI (Agent Skill)
Install the plugin directly from GitHub into Copilot CLI:
```bash
copilot plugin install xpepper/pr-review-gemini
```
*(Or during local development, load without installing: `copilot --plugin-dir .`)*

Then start Copilot CLI and trigger the skill:
```bash
copilot
/gem-pr-review <PR_NUMBER>
```


### 4. Run via MCP Inspector (Web UI)
Launch the interactive Model Context Protocol inspector to test all tools visually:
```bash
npx @modelcontextprotocol/inspector node server/index.js
```

### 5. Run via GitHub Actions (Automated CI Review)
Automate multi-lens AI code review on every pull request using the official GitHub Action:
```yaml
- name: AI PR Code Review
  uses: xpepper/pr-review-gemini@main
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    mode: balanced
    fail_on: P1
```

### 6. Install Git Pre-Commit Self-Review Hook
Automatically run fail-closed self-review on uncommitted changes before every git commit:
```bash
npm run install-hook
```
*(To remove: `node scripts/self-review.mjs --uninstall-hook`)*

---

## Core Usage & CLI Options

The CLI runner (`scripts/dogfood-review.mjs`) provides full control over review modes and publishing:

```bash
node scripts/dogfood-review.mjs <PR_NUMBER> [options]
```

| Flag | Description |
| :--- | :--- |
| `--dry-run`, `--no-comment` | Analyze the PR and print the markdown summary without publishing to GitHub |
| `--publish`, `--comment` | Submit the host-gated review and diff-anchored inline comments to GitHub |
| `--publish-cached` | Publish previously cached review findings without rerunning model inference |
| `--all` | Publish all findings immediately without interactive triage prompt |
| `--interactive` | Prompt for interactive finding selection table before publishing |
| `--select <spec>` | Batch-select findings by index, range, or severity (e.g. `"1,3"`, `"p0,p1"`, `"min:p2"`) |
| `--cache-dir <dir>` | Custom directory for session findings cache (defaults to `.gem-pr-cache`) |
| `--quick` | Fast triage running 3 critical lenses (Correctness, Security, Conventions) |
| `--balanced` | *(Default)* Standard multi-lens review running 5 specialist lenses |
| `--full` | Exhaustive review running 6 lenses, including Test Quality & Coverage |
| `--deep` | Focused deep dive with high reasoning effort on Correctness & Concurrency |
| `--incremental` | Re-review only new commits since the last review and revalidate prior findings |
| `--role <id>` | Target specific review roles or custom lenses (repeatable or comma-separated: `--role=a11y,perf`) |
| `--replace-standard-roles` | Execute only custom/specified roles, skipping standard mode lenses |
| `--repo <owner/repo>` | Target repository (defaults to current git origin) |
| `--model <model>` | Override the default model used by review subagents |
| `--mock` | Use synthetic runner for rapid offline testing without inference |
| `-v`, `--version` | Display version information |

### CLI Examples

**Standard balanced dry-run:**
```bash
node scripts/dogfood-review.mjs 42 --dry-run
```

**Fast triage on smaller PRs:**
```bash
node scripts/dogfood-review.mjs 42 --quick --dry-run
```

**Incremental re-review on updated PR:**
```bash
node scripts/dogfood-review.mjs 42 --incremental --dry-run
```

**Publish host-gated review to GitHub:**
```bash
node scripts/dogfood-review.mjs 42 --publish
```

**Inspect findings in dry-run and publish cached results later:**
```bash
node scripts/dogfood-review.mjs 42 --dry-run
node scripts/dogfood-review.mjs 42 --publish-cached
```

**Interactive triage before publishing:**
```bash
node scripts/dogfood-review.mjs 42 --publish --interactive
```

---

## Review Modes & Specialist Lenses

Each review mode selects a curated set of independent specialist lenses calibrated for language-agnostic software engineering risks:

| Specialist Lens | Calibrated Focus Area | `quick` | `balanced` | `full` | `deep` |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Correctness & Concurrency** | Where the argument breaks down, edge cases, unhandled error escapes, precondition & landing surface invariants, race conditions | ✅ | ✅ | ✅ | ✅ *(High Reasoning)* |
| **Contracts & Data** | Explicit parameterization vs. ambient process coupling (`process.argv`), API stability, schema drift, data exposure boundaries | | ✅ | ✅ | |
| **Security & Trust** | Trust boundary crossings (SQL, shell, template injection, XSS, path traversal), landing surface authorization, secret leaks | ✅ | ✅ | ✅ | |
| **Performance & Resources** | Redundant work & side-effect duplication (repeated subprocess/git log refetches, duplicate I/O), $O(N^2)$ traps, resource lifecycles | | ✅ | ✅ | |
| **Conventions & Maintainability** | Dead code & phantom variable assignments, copy-paste duplication across sibling CLI entrypoints (DRY), architectural cohesion | ✅ | ✅ | ✅ | |
| **Test Quality & Coverage** | Evidence before completion (automated verification for new behaviors and edge cases), test integrity, brittle/flaky mocks | | | ✅ | |

---

## Key Features

### 1. Host-Gated Publishing & Anti-Hallucination
The AI agent is never permitted to make direct, unvalidated write requests to GitHub. Every comment passes through host-enforced safety gates:
- **Diff Anchor Validation**: Verifies that every proposed comment references an actual changed line inside a valid `@@ -old,+new @@` git hunk.
- **Stale Head Protection**: Blocks submission if the PR branch has moved since analysis started.
- **Capping & Spam Prevention**: Caps inline comments at 50 to avoid flooding the PR.
- **Decision Engine**: Resolves to `APPROVE` only when all criteria are satisfied (no P0/P1 issues, verified tests, non-author reviewer).

### 2. Incremental Re-reviews (`--incremental`)
When authors push updates to address review comments, re-running the full PR wastes tokens and loses context:
- Inspects only the new commit range (`prior_head...current_head`).
- Classifies commit relationships (`same_head`, `incremental`, `diverged`, `none`).
- Revalidates previous findings, categorizing each as **`resolved`**, **`still open`**, or **`obsolete`**.

### 3. Detached Worktree Test Verification (`gem_pr_review_verify`)
Safely executes test suites against the PR head in an isolated, detached git worktree:
- Zero pollution of your active working directory or uncommitted changes.
- Automatically handles worktree creation, timeout supervision, and clean disposal.
- Supports pre-configured profiles (`node-test`, `npm-test`, `pytest`, `cargo-test`, `go-test`, etc.) or custom commands.

### 4. Large-Diff Transport & File-Backed Paging (> 200 KB)
Protects session context and prevents model degradation when reviewing large pull requests:
- **Threshold Detection**: Automatically detects when raw unified diffs exceed 200 KB (`200 * 1024` bytes).
- **File-Backed Transport**: Diffs exceeding 200 KB are stored in temporary file storage while the model receives a structured changed-file manifest. Diffs $\le$ 200 KB continue to use direct in-memory inlining for backward compatibility.
- **Host-Supervised Inspection**: Equips reviewer subagents with host-enforced inspection tools (`read`, `grep`, `find`) strictly capped at an access budget of ~640 KB across 16 read operations (up to 1 MB maximum).

### 5. Interactive Finding Selection & Cached Publish-Later
Provides human reviewers with granular triage control and eliminates redundant model re-evaluations:
- **Interactive Triage**: Inspect findings in a formatted console table showing severity (`P0`–`P3`, `nit`), confidence, location, and title. Select individual indices (`1, 3`), ranges (`1-4`), exclusions (`all, -2`), or severity levels (`p0,p1`, `min:p2`, `no-nits`).
- **Publish-Later Caching**: Every review pass retains evaluated findings in a session cache keyed by PR number and head commit SHA. Inspect findings in dry-run mode and publish later via `--publish-cached` or MCP tool `gem_pr_review_publish_cached` without rerunning expensive subagent inference.
- **Head Freshness Verification**: Validates cached findings against the PR's current head SHA on GitHub, automatically rejecting and invalidating stale caches if new commits were pushed.

### 6. Automatic Fallback Model Retry on Quota/Capacity Errors (Zero Timeouts)
Guarantees uninterrupted review runs even during API rate limits and model capacity constraints:
- **Intelligent Error Classification**: Accurately detects HTTP 429, resource exhaustion (`RESOURCE_EXHAUSTED`, `INSUFFICIENT_QUOTA`), and model overload/capacity limits while failing fast on unrelated bugs.
- **Automatic Failover**: Automatically retries the failing review lens against secondary models in the configured fallback chain (e.g. `heavy_fallbacks: ["claude-3.5-sonnet", "gpt-4o"]`) without losing or repeating already-completed sibling lens evaluations.
- **Zero Plugin-Imposed Timeouts**: Strict timeout-free execution avoids artificial review deadlines or stuck-reviewer heuristics.

### 7. One-Shot Coding-Task Self-Review (`gem_self_review`)
Provides coding agents and developers with a fail-closed self-review safety gate before committing or concluding tasks:
- **Local Git Worktree Diff Acquisition**: Automatically captures uncommitted changes across staged files (`git diff --cached`), unstaged modifications (`git diff`), and untracked files (`git status --porcelain` via synthetic diffs) with zero remote PR or network dependencies.
- **Fail-Closed Safety Gate**: Returns an explicit `status: 'passed'` vs `status: 'failed'` (`verdict: 'PASS'` vs `'FAIL'`), failing closed whenever blocking defects (`P0` or `P1`) are detected so agents can self-correct before committing.
- **Actionable Remediation**: Produces concrete file and line-anchored remediation instructions for each detected defect.
- **CLI Runners**: Run via `npm run self-review`, `node scripts/self-review.mjs [options]`, or `node scripts/dogfood-review.mjs --self`.

### 8. Candidate Finding Recovery from Degraded/Malformed Model Output
Prevents loss of high-signal review findings when LLMs produce truncated or syntax-flawed output under token limits or generation cutoffs:
- **Resilient Envelope Extraction**: Extracts finding envelopes (`<<<PR_REVIEW_JSON>>>`) even when closing delimiters are truncated.
- **Deterministic JSON Repair**: Automatically repairs trailing commas, unclosed brackets and braces, smart quotes, and unescaped literal newlines in review commentary.
- **Individual Candidate Object Scanner**: Scans balanced `{ ... }` candidate objects and recovers individual findings even when outer structures are corrupt or mixed with free-form text.
- **Contract Normalization**: Normalizes severities (`P0`–`nit` as well as descriptive labels), line numbers, file paths, and confidence scores across PR reviews, cached reviews, and local self-reviews.

### 9. Reviewer Sensitivity & Quality Calibration
Calibrates specialist review lenses against language-agnostic software engineering risks to catch subtle design, lifecycle, and operational defects:
- **Universal Design Dimensions**: Detects ambient state coupling (`process.argv` vs explicit options), redundant work and subprocess refetches, dead variable assignments and phantom logic, landing surface invariants and preconditions, and copy-paste boilerplate across sibling entrypoints (DRY).
- **Evidence Before Completion**: Holds test coverage lenses to strict verification standards, flagging unverified behavioral paths, brittle mocks, and tests asserting implementation details instead of observable behavior.
- **Calibration Benchmark Suite**: Includes an automated benchmark evaluation suite (`src/calibration.js`, `tests/calibration.test.mjs`) tracking sensitivity, defect recall, and precision against real pull request defect patterns.

### 10. Streamlined Dogfood CLI & Model Catalog Resilience
Enables rapid, zero-friction dogfood reviews before merging pull requests with automatic failover:
- **Streamlined Runner (`npm run dogfood:pr`)**: Reviews any PR with automatic model resolution (`--model auto`), diff hunk anchoring verification, and interactive triage.
- **Model Catalog Resilience (`isModelUnavailableError`)**: Detects when configured primary or fallback models are unsupported, unentitled, or unavailable in the local host environment.
- **Automatic Fallback to `auto`**: Seamlessly falls back to model `'auto'` (`fallback_to_auto: true`, enabled by default) when configured models are unavailable, guaranteeing review completion without manual intervention.

### 11. Centralized CLI Infrastructure & Pre-Commit Hook Integration
Eliminates duplicated boilerplate across sibling CLI entrypoints through a single source of truth (`src/cli.js`):
- **Centralized Infrastructure**: Unifies direct invocation detection (`isDirectRun`), top-level promise rejection handling (`runIfDirect`), version/help flag dispatch (`handleCommonFlags`), and terminal error presentation (`formatCliError`).
- **Pre-Commit Hook Integration**: Run `npm run install-hook` to configure `.git/hooks/pre-commit` to execute `npm run self-review` before git commits, preventing blocking defects from landing on branches.

---

## Model Context Protocol (MCP) Server

The package includes a compliant MCP server (`server/index.js`) declared in `mcp.json`:

```json
{
  "mcpServers": {
    "gem-pr-review": {
      "command": "node",
      "args": ["server/index.js"]
    }
  }
}
```

### Exposed Tools
- **`gem_self_review`** *(alias `gem_pr_review_self`)*: One-shot coding-task self-review on uncommitted local worktree changes with fail-closed safety gate.
- **`gem_pr_review_diff`**: Unified diff extraction, hunk boundary parsing, and commentability verification.
- **`gem_pr_review_diff_read`**: Host-supervised diff reading (`read`, `grep`, `find`) with access budget capping.
- **`gem_pr_review_subagents`**: Multi-lens parallel analysis with mode resolution (`quick`, `balanced`, `full`, `deep`).
- **`gem_pr_review_publish_cached`**: Publishes previously cached review findings without rerunning model inference, after verifying PR head freshness.
- **`gem_pr_review_prior`**: Discovers past reviews and revalidates finding lifecycle statuses.
- **`gem_pr_review_verify`**: Detached worktree test execution with process supervision.
- **`gem_pr_review_publish`**: Host-gated review submission with diff anchor validation.

*(Legacy tool names `pr_review_*` remain supported as backward-compatible aliases).*

Test all tools interactively via MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node server/index.js
```

---

## Configuration

Configuration is optional and works out of the box with sensible defaults. You can customize behavior using project-level or user-level configuration files:

- **Project Config**: `.github/gem-pr-review.json` *(fallback: `.github/pr-review.json`)*
- **User Config**: `~/.copilot/gem-pr-review.json` *(fallback: `~/.copilot/pr-review.json`)*

### Example Configuration

```json
{
  "fallback_to_auto": true,
  "tiers": {
    "light": "gpt-4o-mini",
    "medium": "claude-3.5-sonnet",
    "heavy": "claude-3.7-sonnet"
  },
  "reasoningEfforts": {
    "light": "off",
    "medium": "off",
    "heavy": "medium"
  },
  "heavy_fallbacks": ["claude-3.5-sonnet", "gpt-4o"],
  "medium_fallbacks": ["gpt-4o-mini"],
  "custom_roles": {
    "accessibility": {
      "name": "Accessibility & WCAG",
      "prompt": "Evaluate WCAG 2.1 AA compliance, ARIA attributes, semantic HTML elements, keyboard traps, and screen reader announcements.",
      "model": "gpt-4o",
      "reasoningEffort": "medium"
    },
    "database_migrations": {
      "name": "Database Migrations",
      "prompt": "Verify zero-downtime migrations, column additions with defaults, lock times, missing foreign key indexes, and backward-compatible data transforms.",
      "tier": "heavy",
      "reasoningEffort": "high"
    }
  },
  "lenses": {
    "correctness": {
      "model": "claude-3.7-sonnet",
      "reasoningEffort": "high",
      "fallbacks": ["gpt-4o"]
    },
    "security": {
      "model": "gpt-4o",
      "reasoningEffort": "low"
    }
  },
  "verification": {
    "defaultProfile": "node-test",
    "profiles": {
      "node-test": {
        "command": "node",
        "args": ["--test"],
        "timeoutMs": 60000
      }
    }
  }
}
```

### Configuration Options & Precedence

- **`fallback_to_auto`**: When set to `true` (default: `true`), automatically falls back to model `'auto'` if configured primary or fallback models are not found, unentitled, or unavailable in the host environment.
- **`custom_roles`** *(or `roles`)*: Pluggable domain-specific review roles. Each entry specifies a domain `prompt`, optional `name`, preferred `model`, `reasoningEffort`, `tier`, and fallback chain. Mounted alongside standard lenses by default.
- **`replace_standard_roles`**: When set to `true`, disables built-in standard lenses and runs only custom or explicitly specified roles.
- **`enabled_roles`**: Array of role IDs to execute (e.g. `["accessibility", "security"]`), filtering out unlisted roles.
- **`tiers`**: Base model mappings for `light`, `medium`, and `heavy` tiers.
- **`reasoningEfforts`**: Reasoning effort levels (`off`, `low`, `medium`, `high`) configured per tier (`light`, `medium`, `heavy`).
- **`heavy_fallbacks` / `medium_fallbacks` / `light_fallbacks`**: Configurable chains of backup models automatically tried on quota exhaustion or capacity limits (also configurable via `fallbacks: { heavy: [...], medium: [...] }`).
- **`lenses`**: Optional per-lens overrides (`model`, `reasoningEffort`, `tier`, `fallbacks`) for specialist review lenses (`correctness`, `contracts`, `security`, `performance`, `conventions`, `tests`). Review modes continue to decide which lenses execute, while per-lens overrides decouple individual specialist models, reasoning profiles, and failover chains.
- **Resolution Precedence**:
  $$\text{lens / custom role override} \longrightarrow \text{tier configuration} \longrightarrow \text{plugin defaults}$$

---

## Automated CI Code Review (GitHub Action)

`gem-pr-review` includes a first-class, zero-dependency composite GitHub Action (`action.yml`) enabling automated AI code review on pull requests in GitHub Actions CI.

### Action Inputs (`action.yml`)

| Input | Description | Required | Default |
| :--- | :--- | :---: | :--- |
| `github_token` | GitHub token for authenticating API requests and posting reviews | No | `${{ github.token }}` |
| `pr_number` | Pull request number to review (auto-detected from `GITHUB_EVENT_PATH` if omitted) | No | *auto-detected* |
| `mode` | Review mode (`quick`, `balanced`, `full`, `deep`) | No | `balanced` |
| `fail_on` | Severity threshold that triggers job failure (`P0`, `P1`, `P2`, `P3`, or `none`) | No | `none` |
| `incremental` | Whether to run an incremental re-review (`auto`, `true`, `false`). In `auto` mode, `synchronize` events automatically trigger incremental reviews | No | `auto` |
| `action` | Review action: `publish` (post review to PR) or `dry-run` (generate summary only) | No | `publish` |
| `select` | Finding filter specification (e.g. `p0,p1`, `min:p2`, `1,3`) | No | *all findings* |

### Action Outputs (`action.yml`)

| Output | Description | Example |
| :--- | :--- | :--- |
| `verdict` | Overall review verdict (`PASS` or `FAIL`) | `PASS` |
| `findings_count` | Total number of findings detected across all lenses | `3` |
| `blocking_count` | Number of blocking findings meeting or exceeding `fail_on` threshold | `0` |
| `summary` | Markdown review summary | `## PR Review Summary...` |

### Automated Event Detection & Incremental Re-reviews

When running in GitHub Actions:
- **Zero-configuration PR resolution**: `pr_number` and repository are automatically parsed from the `GITHUB_EVENT_PATH` webhook payload.
- **Smart Incremental Reviews**: When `incremental: auto` (the default) is set, new pushes to an open PR (`synchronize` event) automatically trigger `--incremental` mode. The action evaluates only newly introduced diff hunks and revalidates prior findings as `resolved`, `still open`, or `obsolete`.

### CI Quality Gate (`fail_on`)

Enforce AI review standards as mandatory GitHub branch protection checks:
- Set `fail_on: P1` to fail CI (exit code 1) when any critical (`P0`) or major (`P1`) defects are detected.
- Combine with GitHub branch protection rules to require passing AI reviews before merging.

### Starter Workflow Template

Add `.github/workflows/gem-pr-review.yml` to your repository:

```yaml
name: 'Gem PR Review'

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    name: AI PR Code Review
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run Gem PR Review
        uses: xpepper/pr-review-gemini@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: balanced
          fail_on: P1
          incremental: auto
          action: publish
```

---

## Agent Plugins Standard

This repository strictly complies with the [Agent Plugins 1.0 specification](https://agent-plugins.org/):
- **`plugin.json`**: Plugin manifest declaring metadata and keywords (`gem-pr-review`).
- **`skills/gem-pr-review/SKILL.md`**: Skill prompt instructions, lens contracts, and severity schemas.
- **`mcp.json`**: Model Context Protocol configuration for host tool execution.

### Collision-Free by Design
By using the distinctive `/gem-pr-review` slash command, this plugin runs alongside any existing generic `pr-review` tools without collision:
- **Direct Skill Invocation**: `/gem-pr-review <PR_NUMBER>`
- **Local Session Priority**: Run `copilot --plugin-dir .` to explicitly scope this plugin for your CLI session.
- **Direct CLI Execution**: Run `node scripts/dogfood-review.mjs <PR_NUMBER>` to bypass Copilot CLI's global plugin registry entirely.
- **Explicit MCP Tool Prompting**: In Copilot CLI chat, prompt directly: *"Use the gem-pr-review MCP server to review PR 123"*. The model will invoke `gem_pr_review_subagents` from this server.

---

## Semantic Versioning, Release Automation & Manifest Synchronization

`gem-pr-review` features automated semantic versioning and atomic multi-manifest synchronization adhering to the Agent Plugins 1.0 standard:

### Manifest Synchronization
Version metadata is maintained in strict synchronization across 4 manifest declarations:
- `package.json`
- `plugin.json`
- `mcp.json`
- `skills/gem-pr-review/SKILL.md`

Verify manifest integrity:
```bash
npm run version:check
```

### Conventional Commit SemVer Bump & Changelog Generation
Analyze git commits since the last release tag to automatically determine the next version bump and generate release notes:
```bash
# Preview automated SemVer calculation and categorized changelog
node scripts/bump-version.mjs auto --dry-run --changelog

# Full release: bump manifests, update CHANGELOG.md, commit, and create git tag
npm run release
```

### Automated Release Workflow
Pushing a tag matching `v*` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) to verify manifests, run tests, generate categorized release notes, and publish an official GitHub Release.

---

## Testing & Verification

Run the automated test suite:

```bash
npm test
```

All 529 unit tests across 109 suites verify parser accuracy, host-gated security, candidate finding recovery, subagent orchestration, fallback retry resilience, interactive selection, review caching, self-review fail-closed safety gates, composite GitHub Action schema, automated CI event payload parsing, quality gate enforcement, custom review roles, central versioning, atomic manifest synchronization, and centralized CLI infrastructure.

---

## Documentation & Architecture

- **[Architecture & Porting Roadmap](docs/roadmap.md)**: Design comparison with `pi-pr-review` and increment history.
- **[Agent Guidelines](AGENTS.md)**: Operating principles and paired-agent development standards.
- **[Session Status & Handoff](HANDOFF.md)**: Current completion status and active notes.
- **[Task List](TODO.md)**: Roadmap item tracking and maintenance backlog.

---

## License

MIT
