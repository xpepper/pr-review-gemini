# Release and versioning reference

## Version model

`package.json` is the canonical version. Three other manifests must carry
the identical version and are checked for drift:

- `package.json`
- `plugin.json`
- `mcp.json`
- `skills/gem-pr-review/SKILL.md` (frontmatter `version`)

## Commands

| Command | What it does |
| --- | --- |
| `npm run version:check` | Verifies all four manifests agree; exits non-zero on drift. |
| `npm run bump` | Bumps the manifests. Target `auto` (default), `patch`, `minor`, `major`, or an explicit `x.y.z`; options include `--dry-run`, `--changelog`, `--tag`, `--release`. |
| `npm run release` | `bump auto --release`: computes the next version from conventional commits, writes all four manifests atomically (with rollback on failure), prepends `CHANGELOG.md`, commits `chore(release): v<N>`, and creates the annotated tag `v<N>`. |

## SemVer rules

Conventional commits decide the bump:

- `BREAKING CHANGE:` footer (or `!` after the type) → **major**
- `feat:` → **minor**
- everything else → **patch**

The changelog groups entries into Breaking Changes, Features, Bug Fixes,
Performance, Refactoring, Documentation, Tests, and Maintenance sections.

## Release workflow

Pushing a `v*` tag triggers two parallel gates: `verify-tag` (tag ↔
`package.json` version alignment) and `ci` (the shared reusable workflow
`.github/workflows/ci.yml`, running manifest sync, the full test suite,
and spec-conformance checks at the tag ref). Publishing a GitHub Release
is **dispatch-only** and requires both gates green: run the release
workflow via `workflow_dispatch` with the tag input. Publishing refuses to
overwrite — if a release already exists for the tag, it fails (delete the
existing release first); publishing is not idempotent by design.

Because the release gate and the merge gate share the same workflow
definition, a release cannot be published while CI is broken — the checks
re-run at the tag ref even if someone bypassed branch protection. Note
the ref semantics: on `workflow_dispatch` the workflow definitions
resolve from the dispatched branch (checkouts are pinned to the tag),
while on tag push both the definitions and the checkouts come from the
tag commit.

## Release runbook

The operator sequence, validated end-to-end with v1.0.2 (2026-09-17).
Requires admin rights on the repository. **Start from an up-to-date
`main`** (`git checkout main && git pull origin main`): the release
commit and tag are created at your current HEAD, so running the sequence
from another branch leaves them unreachable from `main`.

1. `npm run release` — computes the next version from conventional
   commits since the last tag, syncs the four manifests, prepends
   `CHANGELOG.md`, commits `chore(release): v<N>`, and creates the
   annotated tag `v<N>`. It does **not** push anything.
2. `git push origin main --follow-tags` — pushes the release commit and
   the tag together. The direct push to `main` relies on the admin
   bypass in branch protection (`enforce_admins: false`). Use annotated
   tags: environments with `tag.gpgsign=true` reject lightweight tags,
   and `npm run release` already creates annotated ones.
3. The tag push automatically triggers the Release workflow's two gates
   (`verify-tag` + shared CI at the tag). Find the run with
   `gh run list --workflow=Release --event=push --limit 1` (filtering by
   event avoids picking an unrelated dispatch run) and watch it with
   `gh run watch <id>`. The `Publish GitHub Release` job stays
   **skipped** on tag pushes — that is by design, not a failure.
4. Publish (dispatch-only): `gh workflow run Release --ref main -f tag=v<N>`,
   then find and watch the new run with
   `gh run list --workflow=Release --event=workflow_dispatch --limit 1`.
   Publishing fails outright if a release already exists for the tag
   (non-idempotent by design).
5. Bump the marketplace entry (next section).

## Marketplace maintenance at release time

Two listings track releases, with different mechanics:

- **GitHub Action listing** — workflows pin the tag
  (`uses: xpepper/pr-review-gemini@vX.Y.Z`), so the listing follows the
  tag automatically once the release exists.
- **Copilot plugin marketplace** — the `gem-pr-review` entry in
  [`xpepper/copilot-plugins`](https://github.com/xpepper/copilot-plugins)
  must be updated by hand at every release: set the entry's `version`
  **and** its `ref` pin to the new `vX.Y.Z` tag. The marketplace's
  hosting convention is ref-pinning, so both fields move together; until
  they are bumped, marketplace installs keep serving the previous
  release.
