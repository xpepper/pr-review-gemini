# Verification and gated approval

Verification executes a project's own check (tests, build, lint) against
the exact PR head commit in an isolated detached git worktree, so a review
can be backed by executed evidence instead of model claims.

## How it runs

- A temporary worktree is created (`git worktree add --detach` at the
  target commit) under the OS temp directory and force-cleaned afterwards.
  The target is the PR head SHA, auto-resolved via `gh pr view`. A
  caller-supplied `headSha` is cross-checked against the PR's current
  head: on mismatch (the PR has moved) verification fails closed rather
  than verifying a stale or arbitrary commit.
- The command runs without a shell (direct spawn) with a scrubbed
  environment (only `PATH`, `HOME`, `TMPDIR`, `NODE_ENV`, `USER`,
  `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `CI` are passed through).
- Timeouts escalate SIGTERM → SIGKILL; a timed-out run reports
  `timeout` (exit code 124), never a hang.

## Profiles

Built-in profiles:

| Profile | Command | Timeout |
| --- | --- | --- |
| `test` | `npm test` | 60 s |
| `build` | `npm run build` | 60 s |
| `lint` | `npm run lint` | 30 s |

Custom profiles are defined under `verificationProfiles` in the project
configuration. Commands are restricted to `npm`/`npx`/`node` invocations —
shell metacharacters and chaining are rejected. In CI, custom profiles
additionally require the explicit opt-in `enableCustomCiProfiles: true`
(and can be narrowed with `allowedCiVerificationProfiles`).

## Where it runs

- MCP: `gem_pr_review_verify` — `action` (`run` or `list`), `prNumber`
  (required), `profile` (default `test`), optional `headSha`, `command`,
  `timeoutMs`. Same-repository only: the tool takes no `repo` parameter
  and resolves the PR head from the local checkout.
- PR comment: `/gem-review --verify` (optionally `--verify=<profile>`,
  `--no-verify` to skip). The reply carries the verification summary.
- GitHub Action: no dedicated input; verification is comment-command
  driven. The `verification_status` output reports `passed`, `failed`, or
  `none`.

## Fork safety

Verification executes PR-supplied code. In CI it is disabled for
cross-repository (fork) PRs — such runs fail closed with an explicit
security notice, and origin-check API errors abort verification rather
than fall back to a weaker path.

## Verification vs approval

Two independent gates, often confused:

- **Verification** feeds the CI verdict: a failed verification fails the
  Action run (`verdict: FAIL`, exit code 1). It does not participate in
  the review-event decision.
- **Gated approval** is governed by `approveMaxPriorityLevel`
  (`off` — the default — `P2`, `P3`, or `nit`). When enabled and no
  finding is more urgent than the threshold, the review is submitted as
  `APPROVE` instead of `COMMENT`; the engine never emits
  `REQUEST_CHANGES`. Approval is skipped for the PR's own author and
  fails closed if any specialist lens errored. If a PR modifies the
  repository's guidelines file, the approval threshold is re-resolved
  from the base branch's configuration, ignoring PR-supplied values.
