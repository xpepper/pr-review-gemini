# Installation

Gem PR Review is available as a Copilot CLI plugin, a GitHub Action, and a
local CLI. It requires Node.js 20 or later. Local PR review also requires an
authenticated [GitHub CLI](https://cli.github.com/) (`gh auth status`).

## Copilot CLI plugin

Install the plugin from GitHub:

```bash
copilot plugin install xpepper/pr-review-gemini
```

During local development, load the repository without installing it:

```bash
copilot --plugin-dir .
```

Then invoke the skill from Copilot CLI:

```text
/gem-pr-review <PR_NUMBER>
```

`/gem-pr-review` is deliberately distinct from generic `pr-review` commands so
it can coexist with other installed tools.

For other Agent Plugins 1.0 harnesses, MCP tools, and configuration, see the
[plugin reference](plugin.md).

## GitHub Marketplace and Action

Install from the [Gem PR Review Marketplace page](https://github.com/marketplace/actions/gem-pr-review),
then add the Action to a repository workflow:

```yaml
- name: AI PR Code Review
  uses: xpepper/pr-review-gemini@d8b3ae8f104e4e7a95ca129072c04148f3f5ddb2 # v1.0.1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    copilot_token: ${{ secrets.COPILOT_TOKEN }}
    mode: balanced
    fail_on: P1
```

Create `COPILOT_TOKEN` as a repository secret containing a user-owned
fine-grained PAT with the **Copilot Requests** account permission. The Action
pins and installs Copilot CLI itself; consumers do not need separate Node or
CLI setup steps. For the complete workflow, permissions, inputs, outputs,
authentication references, and execution boundary, see the
[GitHub Action reference](github-action.md).

## Local CLI quick starts

Run the streamlined terminal command with automatic model selection:

```bash
npm run dogfood:pr <PR_NUMBER>
```

Inspect findings without publishing them:

```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --dry-run
```

Use `--mock` to exercise the pipeline without model inference:

```bash
node scripts/dogfood-review.mjs <PR_NUMBER> --mock --dry-run
```

For flags, review modes, publish behavior, caching, and self-review, see the
[CLI reference](cli.md).
