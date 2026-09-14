# Repository review guidelines

Guidelines let a repository tell the reviewer what matters here: domain
invariants, architecture rules, conventions, and per-lens checklists. Every
review — plugin, [Action](github-action.md), or [CLI](cli.md) — discovers
the file automatically and injects it into the relevant specialist lenses.

## Discovery

1. A custom path, if configured (`guidelines.path` in
   `.github/gem-pr-review.json`, or `~/.copilot/gem-pr-review.json`).
2. `.github/gem-pr-review.md` (default).
3. `.github/review-instructions.md` (fallback filename).

The `--guidelines <path>` CLI flag and the Action input `guidelines_path`
override discovery for a single run.

## Section routing

The file is parsed by markdown headings (levels 1–4):

- Content before any routing heading, and headings matching global
  patterns (`Global`, `General`, `Invariants`, `Architecture`, `Common`,
  `Overview`, `Shared`, `Core`, `Project Memory`, `Checklist`), are
  **global rules** — injected into every lens.
- A heading naming a standard lens routes the section to that lens only.
  Accepted names and aliases: `Correctness` (or `Concurrency`),
  `Contracts` (or `Data`), `Security` (or `Trust`), `Performance` (or
  `Resources`), `Conventions` (or `Maintainability`), `Tests` (or
  `Testability`).
- `## Lens: <id>` and `## Role: <id>` (also `## Role - <name>`) route
  explicitly; `<id>` may be any kebab-case id, which is how
  [custom roles](custom-roles.md) get their own sections.

Example:

```markdown
# Review guidelines

## Global
All public APIs need JSDoc; no default exports.

## Security
Flag any new `eval` or dynamic import of untrusted paths.

## Lens: db
Migrations must be reversible; no locking DDL on large tables.

## Role: db
Prefer additive schema changes over in-place rewrites.
```

## Limits

- Files are read up to 64 KB by default (`guidelines.max_bytes`; hard
  ceiling 512 KB). Larger files are truncated and the prompt carries an
  explicit truncation warning.
- Each lens gets at most 24 KB of guideline text, with the lens-specific
  section guaranteed the majority of that budget.

## Trust and safety

- Custom paths must be `.md`/`.markdown`/`.txt` files inside the
  repository, located under `.github/` or exactly matching the configured
  `guidelines.path`. Sensitive patterns (`.env`, `.git`, SSH keys,
  `.pem`/`.key`-style extensions, credential/secret/token/password names)
  are rejected.
- Paths are always reported repository-relative — never as machine paths.
- Guideline content is injected as untrusted text: it cannot override the
  reviewer's core safety policies, and guideline markers cannot spoof the
  findings contract.
- If a PR modifies the guidelines file (or its authenticity cannot be
  verified against the base ref), the guidelines are treated as untrusted
  and approval policies are re-resolved from the base configuration. MCP
  output marks such content `UNTRUSTED_REPOSITORY_CONTENT`.

## Inspecting active guidelines

- MCP: `gem_pr_review_guidelines` (alias `pr_review_guidelines`) returns
  the discovered file, byte size, truncation state, and the lens sections
  routing table (see the [MCP tools reference](mcp-tools.md)).
- CLI: `--guidelines <path>` on `scripts/dogfood-review.mjs` and
  `scripts/self-review.mjs`; Action input `guidelines_path`.
