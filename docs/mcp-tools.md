# MCP tools reference

The plugin's MCP server (declared in `mcp.json`, started with
`node server/index.js`) speaks stdio JSON-RPC 2.0 and registers 17 tools.
This page is the complete inventory; the [plugin reference](plugin.md)
keeps a one-line summary.

## Review execution

| Tool | What it does |
| --- | --- |
| `gem_pr_review_subagents` | Runs the parallel specialist-lens review (modes `balanced`/`quick`/`full`/`deep`, `roles`, `customRoles`, `dryRun`/`publish`, `guidelinesPath`, `verbose`). Read-only by default; posts a review only when `publish: true` **and** `dryRun: false`. |
| `gem_self_review` / `gem_pr_review_self` | Fail-closed review of local uncommitted changes (`scope` `all`/`staged`/`unstaged`/`head`, `failOn`, roles, guidelines). Local-only; returns `passed` vs `failed`. |
| `gem_pr_review_architecture` | Architecture walkthrough with Mermaid sequence/component diagrams from a diff or PR. Read-only. |

## Diff access

| Tool | What it does |
| --- | --- |
| `gem_pr_review_diff` | Fetches and parses the unified diff with hunk commentability. Read-only. |
| `gem_pr_review_diff_read` | Host-supervised diff inspection for large diffs: `read` slices by `file`/`offset`/`limit` or by line, plus `grep` and `find`. Budget caps: max 16 reads and 640 KB per review (1 MB hard ceiling); `file` paths with `..` or absolute paths are rejected. Every response reports its `budgetState`. |

## Publishing (mutating)

| Tool | What it does |
| --- | --- |
| `gem_pr_review_publish` | Submits the host-gated review. Requires `prNumber` and `findings`. |
| `gem_pr_review_publish_cached` | Publishes previously cached findings without re-running inference, after verifying the PR head has not moved and anchors still hold. |

The review engine never writes to GitHub directly: publishing is host-gated
(see [safety guarantees](#safety-guarantees) below).

## Incremental state and threads

| Tool | What it does |
| --- | --- |
| `gem_pr_review_prior` | Discovers prior reviews, classifies the commit relationship (`same_head`, `incremental`, `diverged`, `none`), revalidates prior findings. Read-only. |
| `gem_pr_review_threads` | Inspects inline review threads, tracks author replies, verifies fixes against the current diff. Resolves threads and posts replies only when `resolve: true`. |

## Verification, guidance, telemetry

| Tool | What it does |
| --- | --- |
| `gem_pr_review_verify` | Runs a verification profile (`test`, `build`, `lint`, or a configured custom one) against the exact PR head in an isolated detached worktree. Local execution only; takes no `repo` parameter. See the [verification reference](verification.md). |
| `gem_pr_review_guidelines` | Parses repository review guidelines and reports the routed sections. Read-only. See the [guidelines reference](guidelines.md). |
| `gem_pr_review_diagnostics` | Formats sanitized execution telemetry from the session cache or a supplied object (`format`: `markdown` or `json`). See the [diagnostics reference](diagnostics.md). |

## Aliases

Five aliases are registered as standalone tools and appear in `tools/list`:

- `pr_review_threads`, `pr_review_architecture`, `pr_review_guidelines`,
  `pr_review_diagnostics` — short forms of the matching `gem_pr_review_*`
  tools.
- `gem_pr_review_self` — alias for `gem_self_review`.

Eight further short names are accepted by the dispatcher when calling a
tool but are not listed: `pr_review_diff`, `pr_review_diff_read`,
`pr_review_subagents`, `pr_review_publish`, `pr_review_publish_cached`,
`pr_review_prior`, `pr_review_verify`, `pr_review_self`.

## Safety guarantees

- **Host-gated publishing.** The model never posts to GitHub directly.
  Findings are validated against actual diff hunks; unanchored findings are
  demoted to the review summary instead of becoming broken inline comments,
  and inline comments are capped at 50 inline comments per review.
- **Stale-head check.** Publishing requires an `expectedHeadSha`; if the PR
  head has moved, publishing fails rather than anchoring to an outdated
  diff.
- **Bounded diff access.** `gem_pr_review_diff_read` enforces its read/byte
  budget and rejects path traversal, so large-diff reviews cannot exhaust
  context or escape the diff.
- **Sanitized errors.** Tool error messages redact machine paths and are
  truncated to 500 characters.
