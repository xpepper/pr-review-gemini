# Plugin-First Documentation Design

**Date:** 2026-09-13
**Status:** Approved (design review)
**Scope:** Documentation increment — README rewrite, new plugin reference, install-doc reorder, docs-consistency test additions, Copilot plugin marketplace entry.

## Problem

The tool was born as a Copilot CLI plugin packaged per the
[Agent Plugins 1.0](https://agent-plugins.org/) specification, but the current
README leads with the GitHub Action: the plugin appears only in a subordinate
clause, and the Agent Plugins identity was dropped entirely in the #46 docs
split. The plugin shape and the Action shape are complementary distributions
of the same engine; the README should promote both, lead with the plugin
identity, and stay streamlined by delegating depth to focused per-shape
references.

## Decisions (settled with the project owner)

1. **Docs layout:** one deep-dive reference per distribution shape. New
   `docs/plugin.md` joins the existing `docs/github-action.md` and
   `docs/cli.md`; `docs/installation.md` remains the quick-install index for
   all shapes.
2. **Portability claim:** standard-first with the runtime dependency stated.
   The packaging (`plugin.json`, `skills/`, `mcp.json`) is harness-agnostic
   per the spec; the review engine's specialist lenses run on the Copilot CLI
   runtime (`@github/copilot-sdk`, verified harness: GitHub Copilot CLI), and
   GitHub access goes through `gh`. No unqualified "runs anywhere" claims.
3. **README density:** a compact "driving a review" section covers the review
   modes and the knobs that matter across shapes (~8 one-liners); full flag
   and input tables stay in the per-shape references.
4. **Copilot install instructions** must be complete and verifiable:
   prerequisites, install command, dev-mode loading, invocation, and what a
   successful run looks like.
5. **New work item:** publish a Copilot CLI plugin marketplace entry for this
   repository (see "Marketplace entry" below).

## README.md (rewrite, target ≤ ~100 lines)

Section order and content:

1. **Intro paragraph** — parallel multi-lens AI code reviewer for GitHub pull
   requests; packaged as an Agent Plugins 1.0 plugin installable in any
   compliant harness (verified with GitHub Copilot CLI); also shipped as a
   GitHub Action; same engine and safety model; complementary shapes. The
   Marketplace link stays, positioned as the Action's install pointer.
2. **Use it as a plugin** — `copilot plugin install xpepper/pr-review-gemini`,
   invocation `/gem-pr-review <PR_NUMBER>`, dev mode
   `copilot --plugin-dir .`, one-line runtime note (Copilot runtime for the
   lenses, `gh`, Node ≥ 20), link to `docs/plugin.md`. Install steps spelled
   out (prerequisite checks, the command, how to verify the skill loaded).
3. **Run it as a GitHub Action** — today's minimal workflow YAML, trimmed
   context, link to `docs/github-action.md`. Equal visual weight to section 2.
4. **Driving a review** — `quick` / `balanced` (default) / `full` / `deep`
   plus `--incremental` in a compact list; one-liners for dry-run vs publish,
   finding selection (`--select p0,p1`, interactive), thread resolution,
   architecture walkthrough, custom roles, repository guidelines, per-lens
   model overrides. Closing line points to the three references for full
   tables.
5. **Safety model**, **Capabilities**, **Support and feedback**, **License** —
   kept as today.
6. **Documentation** — adds the plugin reference line to the existing list;
   keeps the `(docs/cli.md)` link required by `tests/skills.test.mjs`.

## docs/plugin.md (new)

Symmetric with the Action and CLI references:

- **What the package contains** — `plugin.json` manifest,
  `skills/gem-pr-review/SKILL.md`, `mcp.json` + `server/index.js`; what each
  surface gives a harness.
- **Requirements** — Node ≥ 20, authenticated `gh`, Copilot CLI runtime for
  model inference (uses the user's Copilot subscription; no external API
  keys), with the standard-first portability wording.
- **Install** — Copilot CLI (verified path, spelled out step by step);
  `copilot --plugin-dir .` for local development; marketplace add + install
  once the marketplace entry ships; how other Agent Plugins 1.0 harnesses
  adopt the package.
- **Invoking and steering the skill** — `/gem-pr-review <PR_NUMBER>`, and the
  natural-language / flag-level tweaks available from the harness.
- **MCP tools** — table of the `gem_pr_review_*` tools (names verified against
  `server/index.js` during implementation).
- **Configuration and tweaks** — custom roles (`--role`,
  `--replace-standard-roles`, config-file `custom_roles`), repository
  guidelines (`.github/gem-pr-review.md`, `--guidelines`), per-lens model and
  reasoning-effort overrides, model-catalog fallback behavior.
- **How the shapes relate** — same engine as the Action and CLI;
  complementary, not exclusive.

Every factual claim is verified against `src/`, `SKILL.md`, and `mcp.json`
before writing. Nothing aspirational.

## docs/installation.md (reorder)

Plugin install first, Action/Marketplace second, CLI quick starts third;
link to `docs/plugin.md`. Content otherwise unchanged.

## docs/github-action.md and docs/cli.md

One added cross-link sentence each, pointing to the other shapes. No content
changes.

## Tests

`tests/skills.test.mjs` is the docs-consistency gate. Keep every existing
assertion passing (notably the `(docs/cli.md)` README link). Add assertions
in the file's established style:

- README links `docs/plugin.md` and documents the Agent Plugins identity
  (e.g. matches `agent-plugins.org` or `Agent Plugins`).
- `docs/plugin.md` exists and documents `copilot plugin install`, the
  Copilot-runtime requirement, and `/gem-pr-review` invocation.

## Marketplace entry (Copilot CLI plugins marketplace)

Per
[GitHub's docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace),
a marketplace is a Git repository containing `marketplace.json` in
`.github/plugin/` with marketplace metadata and a `plugins` array; each entry
carries `name`, `description`, `version`, and `source` (path to the plugin
directory relative to the repo root). Users register it with
`copilot plugin marketplace add xpepper/pr-review-gemini`.

- Add `.github/plugin/marketplace.json` listing this plugin.
- **Open question to resolve by experiment:** whether `source` accepts the
  repository root (`"."`) — this repo's `plugin.json` sits at the root and
  restructuring is undesirable. If `"."` is rejected, evaluate the smallest
  conforming alternative before proceeding.
- Verify locally: `copilot plugin marketplace add` against this repo, install
  the plugin from it, and run a review through the skill without publishing
  (ask it to review a PR in dry-run terms).
- Document the marketplace install path in `docs/plugin.md` and the README
  plugin section once verified.
- Extend the `bump-version.mjs` manifest set to include
  `.github/plugin/marketplace.json` so releases keep its `version` field in
  sync (small code change, part of this work item).

## Out of scope

- Code changes other than the `bump-version.mjs` manifest-set extension that
  the marketplace work item requires.
- Rewrites of `docs/roadmap.md` or `docs/dogfooding-feedback.md` (link fixes
  only if broken).
- Version bump or release chore; this increment lands on a branch and is
  released through the normal flow afterwards.

## Success criteria

- README leads with the plugin identity; plugin and Action sections have
  comparable weight; no unverified portability claims.
- A new user can install the plugin in Copilot CLI and run a review using the
  README alone; power users reach every flag through the three references.
- `npm test` green, including new docs-consistency assertions.
- Marketplace entry present and verified via a real local install.
