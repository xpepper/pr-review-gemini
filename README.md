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
- **`gem_pr_review_diff`**: Unified diff extraction, hunk boundary parsing, and commentability verification.
- **`gem_pr_review_subagents`**: Multi-lens parallel analysis with mode resolution (`quick`, `balanced`, `full`, `deep`).
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
  "lenses": {
    "correctness": {
      "model": "claude-3.7-sonnet",
      "reasoningEffort": "high"
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
- **`lenses`**: Optional per-lens overrides (`model`, `reasoningEffort`, `tier`) for specialist review lenses (`correctness`, `contracts`, `security`, `performance`, `conventions`, `tests`). Review modes continue to decide which lenses execute, while per-lens overrides decouple individual specialist models and reasoning profiles.
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

All 165 unit tests across 47 suites verify parser accuracy, host-gated security, subagent orchestration, and worktree lifecycles.

---

## Documentation & Architecture

- **[Architecture & Porting Roadmap](docs/roadmap.md)**: Design comparison with `pi-pr-review` and increment history.
- **[Agent Guidelines](AGENTS.md)**: Operating principles and paired-agent development standards.
- **[Session Status & Handoff](HANDOFF.md)**: Current completion status and active notes.
- **[Task List](TODO.md)**: Roadmap item tracking and maintenance backlog.

---

## License

MIT
