# GitHub Action

Gem PR Review is a composite GitHub Action that reviews pull requests with
parallel specialist lenses. The runner analyzes pull request diffs through the
GitHub API rather than checking out the PR head by default.

The same engine is available as an Agent Plugins 1.0 plugin and a local CLI;
see the [plugin reference](plugin.md) and [CLI reference](cli.md).

## Workflow template

Create `.github/workflows/gem-pr-review.yml`:

```yaml
name: Gem PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true

jobs:
  review:
    name: AI PR Code Review
    if: |
      github.event_name == 'pull_request' ||
      (
        github.event_name == 'issue_comment' &&
        github.event.issue.pull_request != null &&
        (contains(github.event.comment.body, '/gem-review') || contains(github.event.comment.body, '/gem-pr-review'))
      )
    runs-on: ubuntu-latest
    steps:
      - name: Resolve trusted base branch
        id: base
        uses: actions/github-script@v8
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          result-encoding: string
          script: |
            if (context.eventName === 'pull_request') {
              return context.payload.pull_request.base.sha;
            }
            const { data: pull } = await github.rest.pulls.get({
              ...context.repo,
              pull_number: context.issue.number,
            });
            return pull.base.sha;

      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          ref: ${{ steps.base.outputs.result }}

      - name: Run Gem PR Review
        uses: xpepper/pr-review-gemini@629c5c7c9141b5b30527bee219de7ba8c80ec928
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          copilot_token: ${{ secrets.COPILOT_TOKEN }}
          mode: balanced
          fail_on: P1
          incremental: auto
          action: publish
```

The `pull-requests: write` permission allows reviews and inline comments.
`issues: write` is required only for the optional `/gem-review` issue-comment
workflow and its reaction/reply lifecycle. The workflow condition only routes
matching comments to the Action using a substring check; command parsing and
authorization happen inside the Action. Before it performs review work, the
Action host-gates the commenter to an `OWNER`, `MEMBER`, or `COLLABORATOR`,
unless the commenter is explicitly allowlisted.

## Copilot CLI provisioning and authentication

The composite Action owns CLI bootstrap: it configures GitHub's required
Node.js 22 runtime, installs pinned `@github/copilot@1.0.83` through the
documented npm path, and discovers the resulting `copilot` binary through
`PATH`. Consumers do not need separate setup or installation steps.

For non-interactive CI authentication, create the `COPILOT_TOKEN` repository
secret as a user-owned fine-grained personal access token with the **Copilot
Requests** account permission, then pass it through the required
`copilot_token` input. Ambient credentials cannot satisfy the guard: the Action
never falls back to `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` from
the caller environment. The Action exposes the input credential as
`COPILOT_GITHUB_TOKEN` only to its authentication guard and review process;
setup and installation never receive the credential. The dedicated variable
keeps Copilot authentication separate from the GitHub API credentials in
`GH_TOKEN` and `GITHUB_TOKEN`; the authentication guard prevents fallback to
either. Classic personal access tokens are not supported.

See GitHub's official documentation for
[installation](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli)
and [authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

This required input is the intentional breaking Action-contract change for
`v1.0.0`. Workflows pinned to `v0.4.0` that configured only an Action-step
`COPILOT_GITHUB_TOKEN` must migrate by passing the same repository secret as
`copilot_token` when updating to `v1.0.0`.

Repository secrets are not passed to `pull_request` workflows triggered from
forks. By owner decision, those runs remain enabled and fail closed at an
explicit authentication precondition before installation or review rather than
reporting an unreviewed success.

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `github_token` | Token used to authenticate GitHub API calls and post reviews. | No | `${{ github.token }}` |
| `copilot_token` | User-owned fine-grained PAT with **Copilot Requests** permission; exposed only as `COPILOT_GITHUB_TOKEN` during authentication and review. | Yes | None |
| `pr_number` | Pull request number; read from `GITHUB_EVENT_PATH` when omitted. | No | Auto-detected |
| `mode` | Review mode: `quick`, `balanced`, `full`, or `deep`. | No | `balanced` |
| `fail_on` | Severity that fails the job: `P0`, `P1`, `P2`, `P3`, or `none`. | No | `none` |
| `incremental` | Incremental behavior: `auto`, `true`, or `false`. | No | `auto` |
| `action` | `publish` posts a review; `dry-run` only generates a summary. | No | `publish` |
| `select` | Finding selection, such as `p0,p1`, `min:p2`, or `1,3`. | No | All findings |
| `guidelines_path` | Custom repository review-guidelines path. | No | `.github/gem-pr-review.md` |
| `verbose` | Enables sanitized diagnostic telemetry. | No | `false` |

## Outputs

| Output | Description |
| --- | --- |
| `verdict` | Overall `PASS` or `FAIL` verdict. |
| `findings_count` | Total findings across all review lenses. |
| `blocking_count` | Findings meeting or exceeding `fail_on`. |
| `verification_status` | Detached-worktree verification status: `passed`, `failed`, or `none`. |
| `documentation_consistency_status` | Documentation check status: `passed`, `failed`, `skipped`, `not_applicable`, or `not_run`. |
| `summary` | Markdown review summary. |
| `diagnostics` | Sanitized execution-telemetry JSON. |

For what the `verbose` input and `diagnostics` output contain, see the
[diagnostics reference](diagnostics.md). For verification profiles, the
comment-driven `--verify` flow, and fork fail-closed behavior, see the
[verification reference](verification.md).

## Documentation consistency check

When a PR changes `README.md`, `docs/`, or `.github/workflows/`, the Action
selects the allowlisted `tests/skills.test.mjs` check. A failed selected check
fails the Action and is reported in the review summary and
`documentation_consistency_status` output.

The Action runs this check only for same-repository PRs and only when the
selected test file is unchanged. It reports a skip rather than executing
untrusted fork code or a test modified by the PR.

## Incremental reviews and quality gates

With the default `incremental: auto`, a `synchronize` event reviews only newly
introduced diff hunks and revalidates prior findings as `resolved`, `still
open`, or `obsolete`. Set `fail_on: P1` to fail the job when it finds P0 or P1
defects; branch protection can then require that check before merging.

## Lens execution failures

Review lenses run through the Copilot CLI, which the composite Action installs
and authenticates on the runner. If every review lens fails to execute
(for example `spawn copilot ENOENT`),
no review was performed, so the Action fails the job with verdict `FAIL` and an
error annotation instead of reporting zero findings. This applies to `dry-run`
as well as `publish`. When only some lenses fail, the review summary lists them
and the Action emits a warning annotation without failing the job.

## Trusted-base execution boundary

The Action keeps the repository checkout on the trusted base branch and obtains
the pull request diff through GitHub APIs. It therefore does not check out or
execute untrusted PR-head code by default.

Optional detached-worktree verification is maintainer initiated. In CI it is
limited to same-repository branches and canonical safe profiles (`test`,
`build`, and `lint`); it fails closed for forks or origin-check errors. Custom
profiles require explicit opt-in and command validation that rejects shell
metacharacters and unapproved executables.

Every publication remains host-gated: inline comments must anchor to a changed
diff hunk, stale PR heads are rejected, and the host determines the final GitHub
review state.
