# Gem PR Review

Gem PR Review is a parallel, multi-lens AI code reviewer for GitHub pull
requests. It is packaged as an [Agent Plugins 1.0](https://agent-plugins.org/)
plugin — any compliant agent harness can install and invoke it (verified with
GitHub Copilot CLI) — and it also ships as a GitHub Action for automated CI
review. Both shapes run the same engine and the same host-gated safety model;
they are complementary, not exclusive.

## Use it as a plugin

Works with any harness that supports the Agent Plugins protocol. With GitHub
Copilot CLI, the verified harness:

```bash
copilot plugin install xpepper/pr-review-gemini
```

Then start Copilot CLI and invoke the skill on a pull request:

```text
/gem-pr-review 42
```

During local development, load the repository without installing:

```bash
copilot --plugin-dir .
```

The specialist lenses run on the Copilot CLI runtime via your Copilot
subscription, and GitHub access uses an authenticated `gh`. For other
harnesses, exposed MCP tools, and configuration, see the
[plugin reference](docs/plugin.md).

## Run it as a GitHub Action

[Install from the GitHub Marketplace](https://github.com/marketplace/actions/gem-pr-review),
then add this workflow to `.github/workflows/gem-pr-review.yml`:

```yaml
name: Gem PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.ref }}
      - uses: xpepper/pr-review-gemini@v0.3.3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: balanced
          fail_on: P1
```

This minimal workflow handles pull-request events only. For the `/gem-review`
comment trigger and concurrency controls, see the complete
[GitHub Action reference](docs/github-action.md).

## Driving a review

The same knobs are available in every shape:

- **Modes:** `quick` (3 lenses), `balanced` (default, 5), `full` (6), `deep`
  (high-reasoning correctness focus); `--incremental` re-reviews only new
  commits.
- **Dry-run vs publish:** inspect findings first, then submit the host-gated
  review — optionally publishing cached findings without re-running inference.
- **Finding selection:** publish all, filter by severity or index
  (`--select p0,p1`), or choose interactively.
- **Thread lifecycle:** verify and resolve addressed review threads
  (`--resolve`).
- **Architecture walkthroughs:** Mermaid sequence and component diagrams
  (`--architecture`).
- **Custom reviewer roles:** per-repository or per-user role definitions with
  per-role model and reasoning effort.
- **Repository guidelines:** `.github/gem-pr-review.md` conventions applied to
  every review.
- **Model resilience:** automatic catalog fallback when a model is
  unavailable.

Full flag tables per shape: [plugin](docs/plugin.md),
[Action](docs/github-action.md), [CLI](docs/cli.md).

## Safety model

GitHub mutations are host-gated: the reviewer cannot write to GitHub directly.
Before publication, the host validates every inline comment against a changed
diff hunk, blocks publication when the PR head has become stale, and caps inline
comments. In CI, the Action analyzes the diff while the runner remains on the
trusted base branch; it does not check out or execute untrusted PR-head code by
default. Optional detached-worktree verification has additional same-repository
and safe-profile gates.

## Capabilities

- Parallel specialist review modes for correctness, contracts, security,
  performance, conventions, and tests.
- Incremental re-reviews, finding selection, cached publish-later workflows,
  and safe review-thread resolution.
- Local fail-closed self-review, optional architecture walkthroughs, and
  sanitized verbose diagnostics.

## Documentation

- [Installation and quick starts](docs/installation.md)
- [Plugin reference](docs/plugin.md)
- [GitHub Action reference](docs/github-action.md)
- [CLI reference](docs/cli.md)
- [Dogfooding feedback process](docs/dogfooding-feedback.md)
- [Architecture and roadmap](docs/roadmap.md)

## Support and feedback

Report reproducible bugs or documentation gaps through
[GitHub Issues](https://github.com/xpepper/pr-review-gemini/issues). For real
PR reviews, use the privacy-safe, evidence-based
[dogfooding feedback process](docs/dogfooding-feedback.md): verify findings
against the diff and repository context before recording them, and never include
credentials, raw prompts or diffs, sensitive diagnostics, or local machine
paths.

## License

MIT
