# AGENTS.md — Working Guidelines for AI Coding Agents

This repository is developed by human and AI agents pair-programming together. All agents working in this codebase must adhere to the following principles and practices.

---

## 1. Core Development Philosophy

1. **Small, Provable Steps**: Every change should represent one focused increment with an explicit goal, narrow scope, and clear verification.
2. **Test-First Thinking**: For any behavioral change, write or update tests first. Verify the test fails for the right reason, make the smallest code change to pass, and verify green before refactoring.
3. **Continuous Verification**: Never present an assumption as fact. Code is "done" only when backed by passing automated tests or inspected execution results.
4. **Eat Our Own Dog Food**: As soon as a minimum viable reviewer is ready (Increment 4), every new increment must be reviewed as a GitHub PR using this tool before merging.
5. **Frequent Conventional Commits**: Commit each coherent, verified step. Use conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).

---

## 2. Standards & Architecture

* **Agent Plugins Standard**: This package must strictly adhere to the [Agent Plugins 1.0 specification](https://agent-plugins.org/):
  * `plugin.json` at root is the manifest.
  * `skills/` contains Agent Skills (`SKILL.md` format).
  * `mcp.json` declares the Model Context Protocol server.
* **Copilot SDK**: Model interactions and subagent sessions use `@github/copilot-sdk` to run within the Copilot CLI runtime and leverage the user's subscription models without requiring external API keys.
* **Host-Gated Security**: The agent/LLM must never write directly to the GitHub API. All GitHub mutations (posting reviews, comments) must go through host-enforced validation (diff anchor checks, head freshness checks, author check).
* **Privacy & Security**: Never include or expose local machine paths (such as absolute paths) in any documentation, test fixtures, or code. Use generic or repository-relative paths.

---

## 3. Tooling & Verification

* **Runtime**: Node.js >= 20.0.0 (ES Modules).
* **Test Runner**: Node's built-in test runner (`node --test`). Run tests with:
  ```bash
  npm test
  ```
* **Git Workflow**:
  * Work in feature branches (`feat/...`, `fix/...`, `docs/...`).
  * Open PRs against `main`.
  * Keep PR diffs focused on the single increment at hand.

---

## 4. How to Hand Off

When wrapping up a session or increment:
1. Ensure all tests pass (`npm test`).
2. Commit all verified changes with conventional commit messages.
3. Update `TODO.md` and `docs/roadmap.md` to reflect completed items and active next steps.
4. Update `HANDOFF.md` with explicit context, current branch/commit status, and clear next actions for the incoming agent.
