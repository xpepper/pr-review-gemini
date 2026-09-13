# GitHub Action

Gem PR Review is a composite GitHub Action that reviews pull requests with
parallel specialist lenses. The runner analyzes pull request diffs through the
GitHub API rather than checking out the PR head by default.

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
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.ref || github.event.repository.default_branch }}

      - name: Run Gem PR Review
        uses: xpepper/pr-review-gemini@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: balanced
          fail_on: P1
          incremental: auto
          action: publish
```

The `pull-requests: write` permission allows reviews and inline comments.
`issues: write` is required only for the optional `/gem-review` issue-comment
workflow and its reaction/reply lifecycle. The workflow condition only routes
matching comments to the Action; before it performs review work, the Action
host-gates the commenter to an `OWNER`, `MEMBER`, or `COLLABORATOR`, unless the
commenter is explicitly allowlisted.

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `github_token` | Token used to authenticate GitHub API calls and post reviews. | No | `${{ github.token }}` |
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
| `summary` | Markdown review summary. |
| `diagnostics` | Sanitized execution-telemetry JSON. |

## Incremental reviews and quality gates

With the default `incremental: auto`, a `synchronize` event reviews only newly
introduced diff hunks and revalidates prior findings as `resolved`, `still
open`, or `obsolete`. Set `fail_on: P1` to fail the job when it finds P0 or P1
defects; branch protection can then require that check before merging.

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
