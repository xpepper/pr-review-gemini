# Plugin reference (Agent Plugins 1.0)

Gem PR Review is packaged as an [Agent Plugins 1.0](https://agent-plugins.org/)
plugin. Any agent harness that implements the standard can install and invoke
it; GitHub Copilot CLI is the verified harness. The review engine's specialist
lenses run on the Copilot CLI runtime (`@github/copilot-sdk`) using your
Copilot subscription, and GitHub access goes through the GitHub CLI (`gh`).

## What the package contains

| Surface | File | What it gives a harness |
| --- | --- | --- |
| Plugin manifest | `plugin.json` | Standard manifest: name, version, description, keywords. |
| Agent Skill | `skills/gem-pr-review/SKILL.md` | Slash-command entry point and review playbook the harness's model follows. |
| MCP server | `mcp.json` + `server/index.js` | Model Context Protocol tools the harness can call directly. |

## Requirements

- Node.js >= 20.
- Authenticated [GitHub CLI](https://cli.github.com/) (`gh auth status`).
- Copilot CLI on the `PATH` for model inference. Optionally point the engine
  at a specific runtime with `COPILOT_CLI_PATH` and `COPILOT_SDK_PATH`.

## Install

From GitHub (verified path):

```bash
copilot plugin install xpepper/pr-review-gemini
```

Or register xpepper's Copilot plugin marketplace and install from it:

```bash
copilot plugin marketplace add xpepper/copilot-plugins
copilot plugin install gem-pr-review@xpepper-copilot-plugins
```

Verify the skill is available by starting Copilot CLI and checking that
`/gem-pr-review` completes as a command. Invoke it with a pull request number:

```text
/gem-pr-review 42
```

During local development, load the repository without installing:

```bash
copilot --plugin-dir .
```

Other Agent Plugins 1.0 harnesses: install this repository as a plugin
according to your harness's plugin installation mechanism. The packaging
above is all standard; no Copilot-specific files are required for discovery.

## Steering a review

The skill accepts the same knobs as the CLI and Action shapes, expressed
naturally or as flags in the underlying commands:

- Modes: `quick` (3 lenses), `balanced` (default, 5 lenses), `full`
  (6 lenses), `deep` (high-reasoning correctness focus).
- `--incremental` re-reviews only new commits and revalidates prior findings.
- Dry-run vs publish, finding selection (`--select p0,p1` or interactive),
  thread resolution (`--resolve`), and architecture walkthroughs
  (`--architecture`) behave as documented in the
  [CLI reference](cli.md).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `gem_pr_review_subagents` | Run the parallel specialist-lens review (mode, roles, custom roles, dry-run/publish). |
| `gem_pr_review_diff` | Fetch PR diff metadata and file manifest. |
| `gem_pr_review_diff_read` | Host-supervised diff inspection with budget caps: read slices by file, offset, or line; grep and find changed files. |
| `gem_pr_review_publish` | Submit the host-gated review. |
| `gem_pr_review_publish_cached` | Publish cached findings without re-running inference. |
| `gem_pr_review_prior` | Prior findings for incremental re-reviews. |
| `gem_pr_review_threads` | Inspect review threads; verify and resolve addressed ones. |
| `gem_pr_review_architecture` | Architecture walkthrough with Mermaid diagrams. |
| `gem_pr_review_verify` | Detached-worktree verification (safe profiles only). |
| `gem_self_review` / `gem_pr_review_self` | Fail-closed review of local uncommitted changes. |
| `gem_pr_review_guidelines` | Load repository review guidelines. |
| `gem_pr_review_diagnostics` | Sanitized execution telemetry. |

The thread, architecture, guidelines, and diagnostics tools are also
registered under short aliases: `pr_review_threads`,
`pr_review_architecture`, `pr_review_guidelines`, and
`pr_review_diagnostics`.

## Configuration and tweaks

- **Custom roles:** define `custom_roles` (with optional `model` and
  `reasoningEffort` per role), `replace_standard_roles`, and `enabled_roles`
  in `.github/gem-pr-review.json` (repository) or
  `~/.copilot/gem-pr-review.json` (user). CLI mirrors: `--role`,
  `--replace-standard-roles`.
- **Repository guidelines:** `.github/gem-pr-review.md` by default, override
  with `--guidelines <path>`.
- **Model resilience:** when a configured model is unavailable (quota or
  capacity), the engine falls back through the model catalog to `auto`.

## How the shapes relate

The plugin, the [GitHub Action](github-action.md), and the
[local CLI](cli.md) run the same engine with the same host-gated safety
model. They are complementary: use the plugin interactively from your
harness, the Action in CI, and the CLI for scripting and dry runs.

Release and marketplace maintenance steps live in the
[release reference](release.md).
