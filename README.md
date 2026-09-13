# Gem PR Review

Gem PR Review is a parallel, multi-lens AI code reviewer for GitHub pull
requests. It runs as a GitHub Action, Copilot CLI plugin, or local CLI and is
built to keep proposed findings grounded in the pull request diff.

[Install Gem PR Review from GitHub Marketplace](https://github.com/marketplace/actions/gem-pr-review)

## Quick start

Add this workflow to `.github/workflows/gem-pr-review.yml`:

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
      - uses: actions/checkout@v4
      - uses: xpepper/pr-review-gemini@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: balanced
          fail_on: P1
```

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
