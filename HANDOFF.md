# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `docs/reference-pages` (branched from `main` at
  `b9fa42a`, the PR #52 squash merge).
* **`main`**: PRs #51 (`d57c701`, plugin-first docs + marketplace entry)
  and #52 (`b9fa42a`, post-#51 state sweep and plugin reference polish)
  are merged. Both were dogfood-reviewed by this repository's own tool
  with 0 findings.
* **Test Suite**: `npm test` green — 860 tests across 159 suites, 0
  failures (docs-consistency checks in `tests/skills.test.mjs` now cover
  `README.md`, `docs/plugin.md`, `docs/installation.md`, and the six new
  reference pages).
* **Manifests**: `npm run version:check` verified synchronized at `0.3.3`.
* **Release**: `v0.3.3` is the latest tag; its GitHub Release is published.
* **Marketplaces**:
  * GitHub Action listing: [Gem PR Review](https://github.com/marketplace/actions/gem-pr-review).
  * Copilot plugin marketplace: [`xpepper/copilot-plugins`](https://github.com/xpepper/copilot-plugins)
    lists `gem-pr-review` v0.3.3 (ref-pinned). **Fully verified
    end-to-end on 2026-09-14**, including the interactive skill path:
    `copilot --allow-all-tools -p "/gem-pr-review 52"` ran the
    marketplace-installed skill, executed a balanced 5-lens review, and
    published a host-gated 0-finding review to PR #52.

## Work on This Branch (`docs/reference-pages`)

Documentation-only increment (no code changes; version stays `0.3.3`):

* Six new focused, code-verified reference pages: `docs/mcp-tools.md`,
  `docs/custom-roles.md`, `docs/guidelines.md`, `docs/diagnostics.md`,
  `docs/verification.md`, `docs/release.md`.
* Marketplace-maintenance paragraph moved from `docs/plugin.md` into
  `docs/release.md` (plugin.md links there).
* Cross-links from `README.md` (Documentation section), `docs/plugin.md`,
  `docs/cli.md`, and `docs/github-action.md`.
* Seven docs-consistency assertions in `tests/skills.test.mjs`, each
  written red-first against the missing page, then green.
* Design record: `docs/superpowers/specs/2026-09-14-reference-pages-design.md`
  and `docs/superpowers/plans/2026-09-14-reference-pages.md` (facts were
  extracted from the implementation by three read-only agents before
  writing).

## Next Actions

1. Open the PR for this branch against `main`, dogfood-review it with
   this repository's own tool (CI Action plus, optionally, a
   `/gem-pr-review <PR>` marketplace-plugin run), independently validate
   every finding against the code before fixing, then squash-merge.
2. At the next release, follow `docs/release.md`: bump with
   `npm run release`, dispatch the release workflow for the new tag, and
   update the marketplace entry's `version` and `ref` pin in
   `xpepper/copilot-plugins`.
3. Remaining post-MVP items live in [`TODO.md`](TODO.md): dogfood the
   reviewer on real pull requests; SARIF export stays deferred.

## Environment Notes

* The pre-commit hook runs this repo's own AI self-review on every commit —
  long output and 1–2 minutes are normal; verify the commit landed with
  `git log --oneline -1`.
* Never run `copilot plugin install/uninstall` while an interactive
  `copilot` session is open — it silently corrupts install records.
* Non-interactive skill runs need `copilot --allow-all-tools -p "<slash command>"`.
* Sibling project (not this repo): reinstalling
  `z-pr-review@xpepper-copilot-plugins` requires the `v0.2.5` tag to land
  in `xpepper/pr-review-glm` first.

## Where the History Lives

* Completed increment record (Increments 0–22 plus post-MVP work):
  [`docs/roadmap.md`](docs/roadmap.md).
* Implementation plan and per-increment status: [`TODO.md`](TODO.md).
* Dogfooding evidence and reviewer-calibration record:
  [`docs/dogfooding-feedback.md`](docs/dogfooding-feedback.md).
