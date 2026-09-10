# Gem PR Review

Parallel, multi-lens AI code review for GitHub pull requests, adhering to the [Agent Plugins 1.0](https://agent-plugins.org/) standard.

Evaluates pull requests across specialized lenses (correctness, contracts, security, performance, conventions, tests), anchors comments strictly in actual git diff hunks to eliminate hallucinations, supports incremental re-reviews on updated commits, and executes tests in detached worktrees.

---

## Quick Start (Get Started in 30 Seconds)

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **GitHub CLI (`gh`)**: Authenticated (`gh auth status`)

### 1. Run via CLI (Dry-Run)
Inspect review findings on any pull request without publishing comments to GitHub:
```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --dry-run
```

To test the review pipeline instantly without model inference or API keys, use `--mock`:
```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --mock --dry-run
```

### 2. Run via GitHub Copilot CLI (Agent Skill)
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


### 3. Run via MCP Inspector (Web UI)
Launch the interactive Model Context Protocol inspector to test all tools visually:
```bash
npx @modelcontextprotocol/inspector node server/index.js
```

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
| `--repo <owner/repo>` | Target repository (defaults to current git origin) |
| `--model <model>` | Override the default model used by review subagents |
| `--mock` | Use synthetic runner for rapid offline testing without inference |

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

Each review mode selects a curated set of independent specialist lenses:

| Specialist Lens | Focus Area | `quick` | `balanced` | `full` | `deep` |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Correctness & Concurrency** | Logic errors, race conditions, async lifecycles, null pointers | ✅ | ✅ | ✅ | ✅ *(High Reasoning)* |
| **Contracts & Data** | API compatibility, schema changes, serialization, typing | | ✅ | ✅ | |
| **Security & Trust** | Injection flaws, auth bypasses, data exposure, tainted inputs | ✅ | ✅ | ✅ | |
| **Performance & Resources** | Complexity regressions, N+1 queries, leaks, unbatched I/O | | ✅ | ✅ | |
| **Conventions & Maintainability** | Project idioms, readability, naming, architectural layering | ✅ | ✅ | ✅ | |
| **Test Quality & Coverage** | Edge cases, missing regression tests, brittle assertions | | | ✅ | |

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

- **`tiers`**: Base model mappings for `light`, `medium`, and `heavy` tiers.
- **`reasoningEfforts`**: Reasoning effort levels (`off`, `low`, `medium`, `high`) configured per tier (`light`, `medium`, `heavy`).
- **`heavy_fallbacks` / `medium_fallbacks` / `light_fallbacks`**: Configurable chains of backup models automatically tried on quota exhaustion or capacity limits (also configurable via `fallbacks: { heavy: [...], medium: [...] }`).
- **`lenses`**: Optional per-lens overrides (`model`, `reasoningEffort`, `tier`, `fallbacks`) for specialist review lenses (`correctness`, `contracts`, `security`, `performance`, `conventions`, `tests`). Review modes continue to decide which lenses execute, while per-lens overrides decouple individual specialist models, reasoning profiles, and failover chains.
- **Resolution Precedence**:
  $$\text{lens override} \longrightarrow \text{tier configuration} \longrightarrow \text{plugin defaults}$$

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

## Testing & Verification

Run the automated test suite:

```bash
npm test
```

All 309+ unit tests across 74 suites verify parser accuracy, host-gated security, candidate finding recovery from degraded/malformed model output, subagent orchestration, fallback retry resilience, interactive selection, review caching, self-review fail-closed safety gates, and worktree lifecycles.

---

## Documentation & Architecture

- **[Architecture & Porting Roadmap](docs/roadmap.md)**: Design comparison with `pi-pr-review` and increment history.
- **[Agent Guidelines](AGENTS.md)**: Operating principles and paired-agent development standards.
- **[Session Status & Handoff](HANDOFF.md)**: Current completion status and active notes.
- **[Task List](TODO.md)**: Roadmap item tracking and maintenance backlog.

---

## License

MIT
