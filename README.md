# Copilot PR Review

Parallel, model-agnostic AI code review for GitHub pull requests, ported to GitHub Copilot CLI and the [Agent Plugins](https://agent-plugins.org/) standard.

## Features

- **Multi-Lens Specialist Reviews**: Evaluates PRs across correctness, security, contracts, performance, and conventions.
- **Configurable Model Tiers & Reasoning Efforts**: Map `light`, `medium`, and `heavy` review lenses to specific Copilot models with configurable reasoning effort (`low`, `medium`, `high`).
- **Review Modes**: Balanced (default), Quick, Full, and Deep review options.
- **Host-Gated Publishing**: Validates diff anchors against actual git hunks before submitting inline GitHub comments, preventing broken API writes and hallucinated locations.
- **Incremental Re-reviews**: Hunts only new commits on updated pull requests and revalidates prior findings.
- **Detached Verification**: Runs test baselines in isolated worktrees to protect local environments.

## Architecture & Standards

This project is packaged as an **Agent Plugin (v1.0)**:
- `plugin.json`: Plugin manifest according to the Agent Plugins standard.
- `skills/pr-review/`: Skill playbook defining the `/pr-review` command and reviewer lens prompts.
- `mcp.json` & `server/`: Lightweight Model Context Protocol (MCP) server providing diff parsing, anchor verification, Copilot SDK subagents, and GitHub publishing.

For an in-depth breakdown of the architecture, feature comparison with `pi-pr-review`, and full delivery backlog, see [docs/roadmap.md](docs/roadmap.md).

## Core Principles

1. **Small, Sequential Increments**: Build from the ground up in small, provable steps backed by tests.
2. **Eat Our Own Dog Food**: As soon as a minimum viable reviewer is ready, all subsequent increments are reviewed by this tool as GitHub PRs.

## Agent Guidelines & Handoff

- Working guidelines for AI agents: [AGENTS.md](AGENTS.md)
- Current state & next steps: [HANDOFF.md](HANDOFF.md)
- Task list: [TODO.md](TODO.md)

## Development

Run tests:

```bash
npm test
```

## License

MIT
