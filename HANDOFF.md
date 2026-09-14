# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `docs/plugin-first-docs` (do not switch to `main`; the
  branch is ready for its PR).
* **HEAD**: branch tip — this handoff commit
  (`docs: record plugin-first docs increment in handoff`).
* **Test Suite**: `npm test` green — 851 tests across 159 suites, 0 failures
  (docs edits re-verified; the docs-consistency checks in
  `tests/skills.test.mjs` cover `README.md` and `docs/plugin.md`).
* **Manifests**: `npm run version:check` verified synchronized at `0.3.3`.
* **Release**: `v0.3.3` is the latest tag; its GitHub Release is published.
* **Marketplaces**:
  * GitHub Action listing: [Gem PR Review](https://github.com/marketplace/actions/gem-pr-review)
    (Code quality and Continuous integration categories).
  * Copilot plugin marketplace: [`xpepper/copilot-plugins`](https://github.com/xpepper/copilot-plugins)
    (marketplace name `xpepper-copilot-plugins`) lists `gem-pr-review` v0.3.3
    via cross-repo source `{"repo": "xpepper/pr-review-gemini", "path": ".", "ref": "v0.3.3"}`;
    install verified with `copilot plugin install gem-pr-review@xpepper-copilot-plugins`.

## Work Completed on This Branch

Documentation-only increment (no code changes; version stays `0.3.3` everywhere):

* Red docs-consistency tests first (`tests/skills.test.mjs`), then:
* Plugin-first `README.md` leading with the Agent Plugins 1.0 identity and the
  `copilot plugin install` quick start.
* New focused plugin reference [`docs/plugin.md`](docs/plugin.md): manifest
  (`plugin.json`), skill (`/gem-pr-review`), MCP tools, and the Copilot CLI
  runtime requirement.
* Reordered [`docs/installation.md`](docs/installation.md) to present the
  plugin install path first, with cross-links between `README.md`,
  `docs/installation.md`, and `docs/plugin.md`.
* Marketplace entry live in `xpepper/copilot-plugins` (root-source path `"."`
  verified working; ref pinned to `v0.3.3`) plus marketplace install and
  maintenance documentation in `docs/plugin.md`.
* Handoff updates per `AGENTS.md` §4: `TODO.md`, `docs/roadmap.md`, and this
  file.
* Design record: [`docs/superpowers/specs/2026-09-13-plugin-first-docs-design.md`](docs/superpowers/specs/2026-09-13-plugin-first-docs-design.md)
  and [`docs/superpowers/plans/2026-09-13-plugin-first-docs.md`](docs/superpowers/plans/2026-09-13-plugin-first-docs.md).

## Next Actions

1. PR [#51](https://github.com/xpepper/pr-review-gemini/pull/51) against
   `main` is open and reviewed by the repository's own Action (dogfooding
   rule): triage and address its review findings, then merge once approved.
2. After the PR merges and the next release is tagged, update the marketplace
   entry's version and `ref` in `xpepper/copilot-plugins` to the new `vX.Y.Z`
   tag so plugin installs track the release.
3. Known environment note (sibling project, not this repository): reinstalling
   `z-pr-review@xpepper-copilot-plugins` requires the `v0.2.5` tag to land in
   `xpepper/pr-review-glm` first.

## Where the History Lives

* Completed increment record (Increments 0–22 plus post-MVP work):
  [`docs/roadmap.md`](docs/roadmap.md).
* Implementation plan and per-increment status: [`TODO.md`](TODO.md).
* Dogfooding evidence and reviewer-calibration record:
  [`docs/dogfooding-feedback.md`](docs/dogfooding-feedback.md).
