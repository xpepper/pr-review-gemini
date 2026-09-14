# Diagnostics reference

`--verbose` (`-V`) attaches a structured, redacted execution-telemetry
report to a review. It answers "what did the reviewer actually do?" —
which phases ran and how long, which models each lens used, what fell
back, what got anchored — without ever exposing diff content, prompts, or
credentials.

## Where the flags work

| Surface | Flags |
| --- | --- |
| `scripts/dogfood-review.mjs` | `--verbose` / `-V`, `--json` |
| `scripts/dogfood-pr.mjs` | forwards both flags to the review runner |
| `scripts/self-review.mjs` | `--verbose` / `-V`, `--json` |
| `/gem-review` PR comment | `--verbose` / `-V` (report appended in a collapsible section of the reply) |
| GitHub Action | `verbose` input (`true`/`1`); the `diagnostics` output always carries the JSON telemetry |

Precedence: an explicit option beats the comment flag, which beats the
Action input. `--json` prints the whole review result, diagnostics
included, as JSON.

## What the report contains

The Markdown report (`### 🔬 Review Execution Diagnostics`) includes:

- **Mode & Lenses** — selected mode and the lens/role plan.
- **Phase Timing** — Diff, Guidelines, Subagents, Architecture,
  Verification, Cache, Publish, with totals.
- **Diff Metadata** — size in KB, file count, and whether file-backed
  paging activated (> 200 KB).
- **Guidelines** — bytes, authentic vs untrusted, truncated or not.
- **Cache Status** — hit/miss, and stale-head detection.
- **Per-Lens Execution** — per lens: status (completed / retried /
  failed), duration, model, findings count, fallback models tried, error.
- **Findings & Anchoring** — total, anchored inline vs demoted to
  summary, severity histogram, average confidence.
- **Safety & Publication Decisions** — stale-head check result, inline
  comment count vs the cap, review verdict, quality gate.

## Redaction guarantees

Telemetry produced by the review engine's collector is sanitized before
it is stored, printed, or published:

- Prompt and diff bodies, environments, headers, and authorization
  material are dropped entirely (blocklisted keys).
- Token patterns (`ghp_…`, `gho_…`, `github_pat_…`, `Bearer …`) are
  replaced with `[REDACTED_TOKEN]`; secret-like key/value pairs become
  `[REDACTED]`.
- Machine paths (`/Users/…`, `/home/…`, Windows drive paths, `/tmp/…`)
  are relativized or replaced with `[REDACTED_PATH]`. The report contains
  zero machine paths.
- MCP tool error messages get the same path redaction plus a 500
  character cap.

One boundary to know: the redaction guarantee covers engine-produced
telemetry — review runs and the session cache they populate. The MCP
diagnostics tool formats whatever it is handed: a caller-supplied
`diagnostics` object is formatted as-is, not re-sanitized.

## MCP

`gem_pr_review_diagnostics` (alias `pr_review_diagnostics`) formats
telemetry either from a supplied `diagnostics` object or from the session
cache for a given `prNumber`; `format` selects `markdown` (default) or
`json`. See the [MCP tools reference](mcp-tools.md).
