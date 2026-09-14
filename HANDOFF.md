# HANDOFF.md — Session Status & Next Steps

## Current State

* **Repository**: `https://github.com/xpepper/pr-review-gemini`
* **Current Branch**: `docs/post-51-sweep` (branched from `main` at `d57c701`).
* **`main`**: PR [#51](https://github.com/xpepper/pr-review-gemini/pull/51)
  (plugin-first docs + Copilot marketplace entry) is merged as `d57c701`
  after two dogfooding review rounds (10 findings fixed).
* **Test Suite**: `npm test` green — 853 tests across 159 suites, 0 failures
  (docs-consistency checks in `tests/skills.test.mjs` cover `README.md`,
  `docs/plugin.md`, and `docs/installation.md`).
* **Manifests**: `npm run version:check` verified synchronized at `0.3.3`.
* **Release**: `v0.3.3` is the latest tag; its GitHub Release is published.
* **Marketplaces**:
  * GitHub Action listing: [Gem PR Review](https://github.com/marketplace/actions/gem-pr-review)
    (Code quality and Continuous integration categories).
  * Copilot plugin marketplace: [`xpepper/copilot-plugins`](https://github.com/xpepper/copilot-plugins)
    (marketplace name `xpepper-copilot-plugins`) lists `gem-pr-review` v0.3.3
    via cross-repo source `{"repo": "xpepper/pr-review-gemini", "path": ".", "ref": "v0.3.3"}`;
    install verified with `copilot plugin install gem-pr-review@xpepper-copilot-plugins`.

## Work on This Branch (`docs/post-51-sweep`)

Small docs increment, no code changes (version stays `0.3.3`):

* Red docs-consistency assertions first (`tests/skills.test.mjs`), then:
* `docs/plugin.md`: alias sentence now names the registered `pr_review_*`
  MCP tool aliases (`pr_review_threads`, `pr_review_architecture`,
  `pr_review_guidelines`, `pr_review_diagnostics`) instead of describing
  them by prefix omission.
* `docs/installation.md`: intro now enumerates the shapes plugin-first
  ("a Copilot CLI plugin, a GitHub Action, and a local CLI"), matching the
  page's section order.
* Staleness sweep: `TODO.md` (PR #51 landing + residual polish checked off,
  roadmap records the merge and this follow-up), `docs/roadmap.md`, and this
  file now reflect the post-merge state.

## Next Actions

1. Open the PR for this branch against `main`, dogfood-review it with this
   repository's own tool (dogfooding rule), triage findings, and merge.
2. Dogfood the marketplace-installed plugin interactively: from any checkout,
   run `/gem-pr-review <PR_NUMBER>` in Copilot CLI against that PR. This is
   the only still-unverified install path (marketplace entry ref-pinned at
   `v0.3.3`).
3. Next docs increment: focused reference pages for MCP tools, custom roles,
   repository guidelines, diagnostics, verification, and release, following
   the `docs/plugin.md` pattern — assertions red first.
4. At the next release, bump the marketplace entry's `version` and `ref` pin
   in `xpepper/copilot-plugins` to the new tag.

## Environment Notes

* The pre-commit hook runs this repo's own AI self-review on every commit —
  long output and 1–2 minutes are normal; verify the commit landed with
  `git log --oneline -1`.
* Never run `copilot plugin install/uninstall` while an interactive
  `copilot` session is open — it silently corrupts install records.
* Sibling project (not this repo): reinstalling
  `z-pr-review@xpepper-copilot-plugins` requires the `v0.2.5` tag to land in
  `xpepper/pr-review-glm` first.

## Where the History Lives

* Completed increment record (Increments 0–22 plus post-MVP work):
  [`docs/roadmap.md`](docs/roadmap.md).
* Implementation plan and per-increment status: [`TODO.md`](TODO.md).
* Dogfooding evidence and reviewer-calibration record:
  [`docs/dogfooding-feedback.md`](docs/dogfooding-feedback.md).
