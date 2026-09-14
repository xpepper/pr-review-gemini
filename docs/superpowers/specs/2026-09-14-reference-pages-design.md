# Reference-Pages Documentation Design

Date: 2026-09-14
Status: settled (decisions follow the plugin-first pattern established by PR
#51 and the scope already recorded in `TODO.md` / `docs/roadmap.md`;
the project owner was not available this session, so every decision below
inherits from that prior, owner-approved pattern rather than introducing new
direction).

## Problem

`README.md` and `docs/plugin.md` now lead with the plugin identity, but the
remaining capability material (MCP tools, custom roles, repository
guidelines, diagnostics, verification, release) lives only as summaries or
inside `skills/gem-pr-review/SKILL.md` (an agent-facing playbook, not user
documentation). `TODO.md` tracks this as the next documentation increment:
"focused MCP, custom-role, repository-guideline, diagnostics, verification,
and release reference pages."

## Decisions

1. **Six new focused pages under `docs/`**, one per topic, following the
   `docs/plugin.md` pattern (short, verified against code, cross-linked):
   `mcp-tools.md`, `custom-roles.md`, `guidelines.md`, `diagnostics.md`,
   `verification.md`, `release.md`.
2. **Each page owns its topic.** Existing pages keep at most a one-line
   summary plus a link ("per-shape references" wording already adopted in
   the README). No flag-table duplication across pages.
3. **Code is the source of truth.** Every page is written from the actual
   implementation — `server/index.js` (tool registrations and schemas),
   `src/config.js` (roles schema and precedence), `src/guidelines.js`
   (discovery and section routing), `src/diagnostics.js` (telemetry and
   redaction), `src/verify.js` (profiles and safety gates),
   `scripts/bump-version.mjs` + `.github/workflows/release.yml`
   (versioning/release), `docs/plugin.md` (marketplace maintenance) — and
   fact-checked by the executor before writing.
4. **Tests first, per page.** One docs-consistency `it()` block per page in
   `tests/skills.test.mjs`, written red before the page exists, pinning the
   page's core contract (page exists; key tool/flag/config names appear;
   cross-links present). This mirrors the gating the CI documentation
   consistency check selects for docs-impact PRs.
5. **Single increment, single PR.** The pages are additive and independent;
   like PR #51 (four docs surfaces + marketplace work), one focused docs PR
   keeps dogfooding cost proportionate. If the dogfood review flags size,
   split rather than argue.
6. **No behavior changes, no version bump.** Documentation-only; version
   stays `0.3.3` in all manifests.

## Page contracts

### docs/mcp-tools.md
- Every MCP tool registered in `server/index.js` (canonical names and the
  four registered `pr_review_*` aliases), grouped by purpose: review
  execution, diff access, publishing, incremental/prior state, threads,
  architecture, verification, self-review, guidelines, diagnostics.
- For each: what it does, key input properties, safety guarantees
  (host-gated publishing, diff-anchor validation, budget caps on
  `diff_read`).
- Notes which tools mutate GitHub state and which are read-only.

### docs/custom-roles.md
- `custom_roles` (alias `roles`) schema: `prompt`/`instructions`, `model`,
  `reasoningEffort`, `tier`, `fallbacks`.
- `replace_standard_roles`, `enabled_roles`; resolution and precedence;
  config file locations (`.github/gem-pr-review.json`,
  `~/.copilot/gem-pr-review.json`) and CLI mirrors (`--role`,
  `--replace-standard-roles`).
- A worked example mounting a domain-specific reviewer alongside the
  standard lenses.

### docs/guidelines.md
- Discovery order (`.github/gem-pr-review.md`,
  `.github/review-instructions.md`, `guidelines.path` override) and the
  64 KB truncation notice.
- Section routing: global rules vs `## Lens:`/`## Role:` sections, with the
  section-header syntax.
- Inspection tools (`gem_pr_review_guidelines`) and `--guidelines` flag.

### docs/diagnostics.md
- `--verbose`/`-V` and `--json` across the CLI surfaces; what the telemetry
  report contains (phase timing, lens lifecycle, fallbacks, anchoring
  outcomes).
- Redaction guarantees: no prompt/diff bodies, tokens, secrets, or machine
  paths.
- MCP tools `gem_pr_review_diagnostics` / `pr_review_diagnostics`.

### docs/verification.md
- Detached-worktree verification model (`gem_pr_review_verify`): safe
  built-in profiles (`test`, `build`, `lint`), custom-profile opt-in,
  same-repo-only (forks fail closed), shell-injection validation.
- Gated approval policy (`approveMaxPriorityLevel`) and how verification
  feeds it.

### docs/release.md
- Version flow: `src/version.js` as canonical source, manifest sync,
  `npm run version:check`, `npm run bump`.
- Conventional-commit SemVer calculation (`src/semver.js`) and the
  tag-triggered release workflow.
- Marketplace maintenance: GitHub Action listing + Copilot plugin
  marketplace entry (`version` and `ref` bump, ref-pinning convention) —
  the authoritative steps, with `docs/plugin.md` linking here instead of
  carrying its own maintenance paragraph.

## Cross-linking

- `README.md` "Documentation" section lists the new pages (one line each).
- `docs/plugin.md`: "MCP tools" table links to `mcp-tools.md`;
  "Configuration and tweaks" links to `custom-roles.md` and
  `guidelines.md`; marketplace-maintenance paragraph moves to
  `release.md` and links back.
- `docs/cli.md`: diagnostics and verification mentions link to their pages.
- `docs/github-action.md`: links to `verification.md` (profiles) and
  `diagnostics.md`.

## Out of scope

- No changes to `skills/gem-pr-review/SKILL.md` (agent playbook, not user
  docs).
- No SARIF export material; no new features; no version bump.
- Not moving the dogfooding record or roadmap.

## Success criteria

- Six pages exist, each fact-checked against its implementation module.
- Docs-consistency assertions red-first for every page; full `npm test`
  green.
- Dogfood review of the increment PR via this repo's own tool; findings
  triaged with independent validation before merging.
