# Reference Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create six focused, code-verified reference pages (`docs/mcp-tools.md`, `custom-roles.md`, `guidelines.md`, `diagnostics.md`, `verification.md`, `release.md`) with red-first docs-consistency assertions and cross-links, per the design spec at `docs/superpowers/specs/2026-09-14-reference-pages-design.md`.

**Architecture:** Documentation-only increment. Each page is one task: write the failing docs-consistency `it()` block in `tests/skills.test.mjs`, verify red, write the page from the verified facts below, verify green, commit. A final task wires cross-links into existing pages and sweeps the handoff docs.

**Tech Stack:** Markdown docs, Node built-in test runner (`node --test tests/skills.test.mjs`), content-pinning `assert.match` assertions.

## Global Constraints

- No production-code changes; no version bump (stays `0.3.3` in all four manifests).
- Never include local machine paths (e.g. `/Users/...`) in any committed content — use repo-relative paths only.
- Every page statement must come from the verified facts in this plan (extracted from `server/index.js`, `src/config.js`, `src/subagents.js`, `src/reviewer.js`, `src/guidelines.js`, `src/diagnostics.js`, `src/verify.js`, `src/semver.js`, `src/version.js`, `scripts/*.mjs`, `.github/workflows/release.yml`, `action.yml`). If a fact here conflicts with the code, the code wins — re-verify, then fix the page.
- Conventional commits, one commit per task. The pre-commit hook runs the repo's self-review (1–2 min, long output is normal; verify with `git log --oneline -1`).
- Assertion style: mirror the existing tests in `tests/skills.test.mjs` (path.resolve + fs.readFileSync + assert.match with failure messages).

## Verified facts (source of truth for all pages)

### MCP tools (`server/index.js`, `mcp.json`)
- 17 registered entries in `MCP_TOOLS` (returned by `tools/list`): `gem_pr_review_subagents`, `gem_pr_review_diff`, `gem_pr_review_diff_read`, `gem_pr_review_publish`, `gem_pr_review_publish_cached`, `gem_pr_review_prior`, `gem_pr_review_threads`, `pr_review_threads`, `gem_pr_review_architecture`, `pr_review_architecture`, `gem_pr_review_verify`, `gem_self_review`, `gem_pr_review_self`, `gem_pr_review_guidelines`, `pr_review_guidelines`, `gem_pr_review_diagnostics`, `pr_review_diagnostics`.
- 5 registered aliases: `pr_review_threads`, `pr_review_architecture`, `pr_review_guidelines`, `pr_review_diagnostics` (prefix aliases) and `gem_pr_review_self` (aliases `gem_self_review`).
- 8 dispatcher-only aliases (accepted in `tools/call`, NOT listed): `pr_review_diff`, `pr_review_diff_read`, `pr_review_subagents`, `pr_review_publish`, `pr_review_publish_cached`, `pr_review_prior`, `pr_review_verify`, `pr_review_self`.
- Mutating tools: `gem_pr_review_publish` (posts review), `gem_pr_review_publish_cached` (publishes cached findings); `gem_pr_review_subagents` publishes only when `publish: true` AND `dryRun: false` (dry-run is the default); `gem_pr_review_threads` resolves threads/posts replies only when `resolve: true`. Everything else is read-only or local-only. `gem_pr_review_verify` executes commands locally in a detached worktree (no GitHub mutation, no `repo` parameter).
- Safety: stale-head check via `expectedHeadSha`; diff-anchor validation demotes unanchored findings to summary; inline comments capped at 50; `diff_read` budget caps: max 16 reads, 640 KB default budget (1 MB hard ceiling), path-traversal rejection; verification commands restricted to npm/npx/node forms; error messages redact machine paths and truncate to 500 chars.
- `mcp.json`: name `gem-pr-review`, `server: { command: "node", args: ["server/index.js"] }`, stdio JSON-RPC 2.0.

### Custom roles (`src/config.js`, `src/subagents.js`, `src/reviewer.js`, `src/cli.js`)
- Config keys: `custom_roles` (aliases `customRoles`, `roles`), `replace_standard_roles` (alias `replaceStandardRoles`), `enabled_roles` (alias `enabledRoles`). Role object: `prompt` or `instructions` (one required; the other is derived), optional `name`, `description`, `model`, `reasoningEffort` (`off|low|medium|high`), `tier` (`light|medium|heavy`), `fallbacks` (string array). `__proto__`/`prototype`/`constructor` keys skipped.
- Standard lens ids: `correctness, contracts, security, performance, conventions, tests`. Mode sets: balanced = correctness+contracts+security+performance+conventions; quick = correctness+security+conventions; full = all six; deep = correctness only.
- Scheduling: explicit `roles`/`enabled_roles` list runs exactly that list (unknown id → error `Unknown review role`); else `replace_standard_roles: true` runs only custom roles; default = mode's standard lenses + custom role ids appended. A `custom_roles.<standard-lens-id>` entry overrides that standard lens.
- Config files: user `~/.copilot/gem-pr-review.json` (fallback `~/.copilot/pr-review.json`), project `.github/gem-pr-review.json` (fallback `.github/pr-review.json`); precedence user < project < runtime overrides. Per-lens overrides under `lenses: { <id>: { model, reasoningEffort, tier, fallbacks } }` apply to custom roles too.
- Custom instructions are wrapped as untrusted: they cannot modify or relax core reviewer safety policies.
- CLI: `--role <id>` (repeatable, comma-separated), `--replace-standard-roles`, in `scripts/dogfood-review.mjs` and `scripts/self-review.mjs` (also parsed by `src/cli.js` `parseCommonReviewOptions` and the `/gem-review` comment dispatcher in `src/ci.js`). MCP mirrors: `roles`, `replaceStandardRoles`, `customRoles` on `gem_pr_review_subagents`, `gem_self_review`, `gem_pr_review_self`.

### Guidelines (`src/guidelines.js`, `action.yml`, `server/index.js`)
- Discovery order: configured custom path (`guidelines.path`) first if set and safe; else `.github/gem-pr-review.md`, then `.github/review-instructions.md`.
- Section routing: headings level 1–4. `## Lens: <id>`, `## Role: <id>`, `## Role - <name>` route to that lens/role (standard lens names and aliases `concurrency→correctness, data→contracts, trust→security, resources→performance, maintainability→conventions, testability→tests`; explicit `Lens:`/`Role:` prefix also accepts arbitrary kebab-case ids for custom roles). Plain standard-name headings (e.g. `## Security`) route to that lens. Headings matching global pattern (`global|general|invariant|architecture|common|overview|shared|core|project memory|checklist`) and any non-lens heading route to global rules.
- Limits: file cap 64 KB default (`guidelines.max_bytes`, hard ceiling 512 KB) with an explicit truncation warning; 24 KB per-lens prompt budget.
- Safety: custom paths must be `.md`/`.markdown`/`.txt` inside the repo, in `.github/` or matching `guidelines.path`; sensitive patterns rejected (`.env`, `.git`, ssh keys, `.pem|.key|...`, credential/secret/token/password names); paths reported repo-relative only; guidelines from PR-modified files are marked untrusted (authenticity verified against base ref); content is tagged `UNTRUSTED_REPOSITORY_CONTENT` in MCP output.
- Surfaces: `--guidelines <path>` (dogfood-review, self-review), action input `guidelines_path`, MCP `gem_pr_review_guidelines` / `pr_review_guidelines`.

### Diagnostics (`src/diagnostics.js`, scripts, `src/ci.js`, `action.yml`)
- Flags: `--verbose`/`-V` and `--json` on `scripts/dogfood-review.mjs`, `scripts/dogfood-pr.mjs` (forwards args), `scripts/self-review.mjs`; `/gem-review --verbose` comment flag; action input `verbose` (`INPUT_VERBOSE` true/1); action output `diagnostics` (always emitted, JSON). Precedence: explicit option > comment flag > action input.
- Report sections (Markdown): `### 🔬 Review Execution Diagnostics`, Mode & Lenses, Phase Timing (Diff, Guidelines, Subagents, Architecture, Verification, Cache, Publish), Diff Metadata (incl. file-backed paging active > 200 KB), Guidelines (bytes, authentic/untrusted, truncated), Cache Status (Hit/Miss, stale head), Per-Lens Execution (status, duration, model, findings, fallbacks, errors), Findings & Anchoring (anchored/demoted, severities, avg confidence), Safety & Publication Decisions (stale-head check, inline comment count vs max 50, verdict, quality gate).
- Redaction guarantees: telemetry drops keys `prompt`, `diffText`, `env`, `headers`, `authorization`, etc.; token patterns (`ghp_`, `gho_`, `github_pat_`, Bearer …) → `[REDACTED_TOKEN]`; secret-like key/values → `[REDACTED]`; machine paths (`/Users/...`, `/home/...`, Windows drives, `/tmp/...`) → relative or `[REDACTED_PATH]`; zero exposure of prompt/diff bodies, tokens, credentials, machine paths.
- MCP: `gem_pr_review_diagnostics` / `pr_review_diagnostics` — params `prNumber` (reads cached diagnostics), `diagnostics` (object to format), `format` (`markdown|json`), `cacheDir`.

### Verification (`src/verify.js`, `scripts/ci-action.mjs`, `src/ci.js`, `src/publish.js`)
- Model: runs a command against the exact PR head in an isolated detached git worktree under the OS temp dir; head SHA auto-resolved via `gh pr view`; environment scrubbed to an allowlist (`PATH, HOME, TMPDIR, NODE_ENV, USER, LOGNAME, SHELL, TERM, LANG, LC_ALL, CI`); no shell (direct spawn), timeout ladder SIGTERM→SIGKILL.
- Built-in profiles: `test` → `npm test` (60s), `build` → `npm run build` (60s), `lint` → `npm run lint` (30s). Custom profiles via `verificationProfiles` config; in CI they require explicit opt-in `enableCustomCiProfiles: true` (plus optional `allowedCiVerificationProfiles` allowlist); commands must match npm/npx/node forms (shell metacharacters rejected).
- Fork safety: CI verification is disabled for cross-repository/fork PRs and fails closed on origin-check errors. The MCP tool takes no `repo` parameter (same-repo only).
- Surfaces: MCP `gem_pr_review_verify` (params `action` `run|list`, `prNumber` required, `headSha`, `profile` default `test`, `command`, `timeoutMs`); `/gem-review --verify[=<profile>]` comment flag; action output `verification_status` (`passed|failed|none`). No action input for verify — it is comment-command driven.
- Relation to verdicts: verification failure fails the CI run (verdict `FAIL`, exit 1) — it does NOT participate in the review-event decision. The review event (`COMMENT` vs `APPROVE`, never `REQUEST_CHANGES`) is governed by `approveMaxPriorityLevel` (`off` default; `P2`, `P3`, `nit` allowed): approval requires no finding more urgent than the threshold, is skipped for the PR author, and fails closed on subagent execution errors. On untrusted/PR-modified guidelines, `approveMaxPriorityLevel` is re-resolved from the base ref config.

### Release & versioning (`src/version.js`, `src/semver.js`, `scripts/bump-version.mjs`, `.github/workflows/release.yml`, `docs/plugin.md`)
- Canonical version: `package.json`, mirrored into 4 manifests — `package.json`, `plugin.json`, `mcp.json`, `skills/gem-pr-review/SKILL.md` frontmatter. `npm run version:check` verifies sync; `npm run bump` bumps (targets `auto`/`patch`/`minor`/`major`/`<x.y.z>`, options `--dry-run`, `--changelog`, `--tag`, `--release`); `npm run release` = `bump auto --release` (compute SemVer from conventional commits, bump 4 manifests atomically with rollback, prepend `CHANGELOG.md`, commit `chore(release): v<N>`, create annotated tag).
- SemVer rules: breaking change (footer `BREAKING CHANGE:` or `!`) → major; `feat` → minor; anything else → patch. Changelog sections: Breaking Changes / Features / Bug Fixes / Performance / Refactoring / Documentation / Tests / Maintenance.
- Release workflow: tag push `v*` runs the `verify` job (manifest sync + tag alignment `v$PKG_VERSION` + `npm test`); publishing a GitHub Release happens only via `workflow_dispatch` with a `tag` input, and refuses if the release already exists (not idempotent by design).
- Marketplace maintenance at release time (both listings): GitHub Action listing tracks the tag automatically via `uses: xpepper/pr-review-gemini@vX.Y.Z`; the Copilot plugin marketplace entry in `xpepper/copilot-plugins` must have BOTH its `version` and its `ref` pin updated to the new tag (ref-pinning convention).

---

### Task 1: `docs/mcp-tools.md` — MCP tool reference

**Files:**
- Create: `docs/mcp-tools.md`
- Modify: `tests/skills.test.mjs` (insert new `it()` after the `names the registered pr_review_ MCP tool aliases…` test)

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
  it('documents the MCP tool inventory in the focused MCP tools reference', () => {
    const mcpToolsPath = path.resolve('docs/mcp-tools.md');
    assert.ok(fs.existsSync(mcpToolsPath), 'docs/mcp-tools.md must exist');
    const content = fs.readFileSync(mcpToolsPath, 'utf8');
    for (const tool of [
      'gem_pr_review_subagents',
      'gem_pr_review_diff',
      'gem_pr_review_diff_read',
      'gem_pr_review_publish',
      'gem_pr_review_publish_cached',
      'gem_pr_review_prior',
      'gem_pr_review_threads',
      'gem_pr_review_architecture',
      'gem_pr_review_verify',
      'gem_self_review',
      'gem_pr_review_guidelines',
      'gem_pr_review_diagnostics',
    ]) {
      assert.ok(content.includes(`\`${tool}\``), `MCP reference should document ${tool}`);
    }
    assert.ok(content.includes('`pr_review_threads`'), 'Should note the registered prefix aliases');
    assert.ok(content.includes('`gem_pr_review_self`'), 'Should note the gem_pr_review_self alias');
    assert.ok(content.includes('`pr_review_diff`'), 'Should document the dispatcher-only aliases');
    assert.match(content, /16 reads/, 'Should document the diff_read read cap');
    assert.match(content, /640 KB/, 'Should document the diff_read byte budget');
    assert.match(content, /50 inline comments/i, 'Should document the inline comment cap');
    assert.match(content, /host-gated/i, 'Should document host-gated publishing');
  });
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/skills.test.mjs`
Expected: exactly this test FAILS (`docs/mcp-tools.md must exist`); the rest pass.

- [ ] **Step 3: Write `docs/mcp-tools.md`**

Structure (facts from the "MCP tools" section above): intro (17 registered tools, stdio server `node server/index.js` per `mcp.json`); grouped tables — review execution (`gem_pr_review_subagents`, `gem_self_review`/`gem_pr_review_self`, `gem_pr_review_architecture`), diff access (`gem_pr_review_diff`, `gem_pr_review_diff_read` with budget caps: 16 reads, 640 KB default / 1 MB ceiling, path-traversal defense), publishing (`gem_pr_review_publish`, `gem_pr_review_publish_cached` — mutating), incremental state (`gem_pr_review_prior`, `gem_pr_review_threads`), verification (`gem_pr_review_verify` — local-only), guidance & telemetry (`gem_pr_review_guidelines`, `gem_pr_review_diagnostics`); a "Mutating vs read-only" note (subagents publishes only with `publish: true` + `dryRun: false`; threads resolve only with `resolve: true`); an "Aliases" section: 5 registered aliases + the 8 dispatcher-only `pr_review_*` names; a "Safety guarantees" section: stale-head `expectedHeadSha` check, diff-anchor validation with demotion, 50 inline comments cap, sanitized errors.

- [ ] **Step 4: Verify green**

Run: `node --test tests/skills.test.mjs` → all pass (34 tests).

- [ ] **Step 5: Commit**

```bash
git add docs/mcp-tools.md tests/skills.test.mjs
git commit -m "docs: add MCP tools reference"
```

### Task 2: `docs/custom-roles.md` — custom review roles

**Files:** Create `docs/custom-roles.md`; modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test** (insert after Task 1's test)

```js
  it('documents custom review roles in the focused roles reference', () => {
    const rolesPath = path.resolve('docs/custom-roles.md');
    assert.ok(fs.existsSync(rolesPath), 'docs/custom-roles.md must exist');
    const content = fs.readFileSync(rolesPath, 'utf8');
    for (const key of ['`custom_roles`', '`replace_standard_roles`', '`enabled_roles`', '`prompt`', '`reasoningEffort`', '`fallbacks`']) {
      assert.ok(content.includes(key), `Roles reference should document ${key}`);
    }
    assert.match(content, /--role/, 'Should document the --role flag');
    assert.match(content, /--replace-standard-roles/, 'Should document --replace-standard-roles');
    assert.match(content, /\.github\/gem-pr-review\.json/, 'Should document the project config file');
    assert.match(content, /~\/\.copilot\/gem-pr-review\.json/, 'Should document the user config file');
    assert.match(content, /override the standard/i, 'Should document lens override by id');
  });
```

- [ ] **Step 2: Verify red** — same pattern; expect only this test failing.
- [ ] **Step 3: Write the page** — role schema (facts above), scheduling semantics (explicit list / replace / default-append; `Unknown review role` error), override-by-id, config files + precedence (user < project < runtime), `lenses` per-role overrides, untrusted-instruction wrapping note, CLI/MCP mirrors, one worked JSON example mounting a domain role (e.g. `db` role with a prompt) alongside standard lenses, and a `replace_standard_roles` example.
- [ ] **Step 4: Verify green.**
- [ ] **Step 5: Commit** `docs: add custom roles reference`

### Task 3: `docs/guidelines.md` — repository review guidelines

**Files:** Create `docs/guidelines.md`; modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test**

```js
  it('documents repository review guidelines in the focused guidelines reference', () => {
    const guidelinesPath = path.resolve('docs/guidelines.md');
    assert.ok(fs.existsSync(guidelinesPath), 'docs/guidelines.md must exist');
    const content = fs.readFileSync(guidelinesPath, 'utf8');
    assert.match(content, /\.github\/gem-pr-review\.md/, 'Should document the default guidelines file');
    assert.match(content, /\.github\/review-instructions\.md/, 'Should document the fallback filename');
    assert.match(content, /## Lens:/, 'Should document Lens section routing');
    assert.match(content, /## Role:/, 'Should document Role section routing');
    assert.match(content, /64 KB/, 'Should document the size cap');
    assert.match(content, /gem_pr_review_guidelines/, 'Should document the inspection tool');
    assert.match(content, /--guidelines/, 'Should document the CLI flag');
    assert.match(content, /guidelines_path/, 'Should document the Action input');
  });
```

- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Write the page** — discovery order, section-routing syntax with examples (global headings, `## Security`, `## Lens: contracts`, `## Role: db`, alias names), limits + truncation warnings, safety (path rules, sensitive-pattern rejection, repo-relative paths, untrusted-on-PR-modified + base-ref authenticity check, `UNTRUSTED_REPOSITORY_CONTENT` tag), surfaces (`--guidelines`, `guidelines_path`, MCP tools), a worked example guidelines file.
- [ ] **Step 4: Verify green.**
- [ ] **Step 5: Commit** `docs: add repository guidelines reference`

### Task 4: `docs/diagnostics.md` — verbose diagnostics

**Files:** Create `docs/diagnostics.md`; modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test**

```js
  it('documents verbose diagnostics in the focused diagnostics reference', () => {
    const diagnosticsPath = path.resolve('docs/diagnostics.md');
    assert.ok(fs.existsSync(diagnosticsPath), 'docs/diagnostics.md must exist');
    const content = fs.readFileSync(diagnosticsPath, 'utf8');
    assert.match(content, /--verbose/, 'Should document --verbose');
    assert.match(content, /-V/, 'Should document the -V short flag');
    assert.match(content, /--json/, 'Should document --json');
    assert.match(content, /gem_pr_review_diagnostics/, 'Should document the MCP diagnostics tool');
    assert.match(content, /Phase Timing/, 'Should document phase timing');
    assert.match(content, /Per-Lens Execution/, 'Should document per-lens execution');
    assert.match(content, /redact/i, 'Should document redaction');
    assert.match(content, /machine paths/i, 'Should document machine path redaction');
  });
```

- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Write the page** — flags per surface (dogfood-review, dogfood-pr, self-review, `/gem-review --verbose`, action `verbose` input + `diagnostics` output, precedence), report sections (exact labels from facts), what is collected per lens (model, fallbacks, findings, errors), redaction guarantees (forbidden keys, token patterns, machine paths; zero exposure claim), MCP tool params.
- [ ] **Step 4: Verify green.**
- [ ] **Step 5: Commit** `docs: add diagnostics reference`

### Task 5: `docs/verification.md` — detached-worktree verification & gated approval

**Files:** Create `docs/verification.md`; modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test**

```js
  it('documents verification and gated approval in the focused verification reference', () => {
    const verificationPath = path.resolve('docs/verification.md');
    assert.ok(fs.existsSync(verificationPath), 'docs/verification.md must exist');
    const content = fs.readFileSync(verificationPath, 'utf8');
    assert.match(content, /`test`/, 'Should document the test profile');
    assert.match(content, /`build`/, 'Should document the build profile');
    assert.match(content, /`lint`/, 'Should document the lint profile');
    assert.match(content, /verificationProfiles/, 'Should document custom profiles');
    assert.match(content, /enableCustomCiProfiles/, 'Should document the CI opt-in');
    assert.match(content, /fork/i, 'Should document fork fail-closed behavior');
    assert.match(content, /approveMaxPriorityLevel/, 'Should document gated approval');
    assert.match(content, /gem_pr_review_verify/, 'Should document the verify MCP tool');
    assert.match(content, /--verify/, 'Should document the comment flag');
  });
```

- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Write the page** — model (detached worktree, scrubbed env, no-shell spawn, timeouts), built-in profiles with commands/timeouts, custom profiles + CI opt-in + command allowlist (npm/npx/node), fork fail-closed + same-repo MCP, surfaces (`gem_pr_review_verify` params, `--verify[=<profile>]`, `verification_status` output), verdict coupling (verification fails the CI run; does NOT drive APPROVE), gated approval section (`approveMaxPriorityLevel` values off/P2/P3/nit, never REQUEST_CHANGES, author check, execution-error fail-closed, base-ref re-resolution on untrusted guidelines).
- [ ] **Step 4: Verify green.**
- [ ] **Step 5: Commit** `docs: add verification and gated approval reference`

### Task 6: `docs/release.md` — versioning & release

**Files:** Create `docs/release.md`; modify `docs/plugin.md` (replace the marketplace-maintenance paragraph with a link to the release page); modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test**

```js
  it('documents release and marketplace maintenance in the focused release reference', () => {
    const releasePath = path.resolve('docs/release.md');
    assert.ok(fs.existsSync(releasePath), 'docs/release.md must exist');
    const content = fs.readFileSync(releasePath, 'utf8');
    assert.match(content, /npm run version:check/, 'Should document version:check');
    assert.match(content, /npm run bump/, 'Should document bump');
    assert.match(content, /npm run release/, 'Should document release');
    assert.match(content, /skills\/gem-pr-review\/SKILL\.md/, 'Should list all four synchronized manifests');
    assert.match(content, /workflow_dispatch/, 'Should document the dispatch-only publish');
    assert.match(content, /xpepper\/copilot-plugins/, 'Should document the plugin marketplace update');
    assert.match(content, /`ref`/, 'Should document the ref pin bump');
    const pluginContent = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(pluginContent, /\[release reference\]\(release\.md\)|release\.md/, 'plugin.md should link to the release reference');
  });
```

- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Write the page** (facts above): canonical version + 4 manifests, the three npm scripts and what `--release` does, SemVer rules + changelog sections, release workflow (tag push verifies; publish is `workflow_dispatch`-only, refuses existing releases), marketplace maintenance (GitHub Action listing via tag; Copilot marketplace entry `version` + `ref` bump in `xpepper/copilot-plugins`, ref-pinning convention). Then edit `docs/plugin.md`: replace the final "Marketplace maintenance:" paragraph with one line: "Release and marketplace maintenance steps live in the [release reference](release.md)."
- [ ] **Step 4: Verify green** — including the pre-existing plugin-shape tests (the marketplace `add`/`install` commands remain in plugin.md, so those assertions stay green).
- [ ] **Step 5: Commit** `docs: add release reference and move marketplace maintenance there`

### Task 7: Cross-links from existing pages

**Files:** Modify `README.md` (Documentation section), `docs/plugin.md`, `docs/cli.md`, `docs/github-action.md`; modify `tests/skills.test.mjs`.

- [ ] **Step 1: Failing test**

```js
  it('cross-links the focused reference pages from the landing and shape pages', () => {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    for (const page of ['mcp-tools', 'custom-roles', 'guidelines', 'diagnostics', 'verification', 'release']) {
      assert.ok(readmeContent.includes(`docs/${page}.md`), `README should link docs/${page}.md`);
    }
    const pluginContent = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(pluginContent, /mcp-tools\.md/, 'plugin.md should link the MCP tools reference');
    assert.match(pluginContent, /custom-roles\.md/, 'plugin.md should link the roles reference');
    assert.match(pluginContent, /guidelines\.md/, 'plugin.md should link the guidelines reference');
    const cliContent = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(cliContent, /diagnostics\.md/, 'cli.md should link the diagnostics reference');
    assert.match(cliContent, /verification\.md/, 'cli.md should link the verification reference');
    const actionContent = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(actionContent, /verification\.md/, 'github-action.md should link the verification reference');
  });
```

- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Apply links** — README "Documentation" section gains one line per page (one-phrase descriptions); plugin.md "MCP tools" section gets a pointer line to `mcp-tools.md` for the full inventory and schemas; "Configuration and tweaks" bullets link `custom-roles.md` and `guidelines.md`; cli.md links diagnostics.md and verification.md where those topics are mentioned (or in a "Further reference" note); github-action.md links verification.md (profiles/fail-closed) and diagnostics.md (verbose input).
- [ ] **Step 4: Verify green** (40 tests).
- [ ] **Step 5: Commit** `docs: cross-link the focused reference pages`

### Task 8: Handoff sweep and full verification

**Files:** Modify `TODO.md`, `docs/roadmap.md`, `HANDOFF.md`.

- [ ] **Step 1:** Run `npm test` → expect all pass (853 product + 7 new = 860 tests, 159 suites). Record the count.
- [ ] **Step 2:** Run `npm run version:check` → all four manifests at `0.3.3`.
- [ ] **Step 3:** Update `TODO.md` (check off the reference-pages item), `docs/roadmap.md` (new post-MVP increment entry with the test count), `HANDOFF.md` (branch state, next actions: PR + dogfood + merge; marketplace bump still pending next release).
- [ ] **Step 4: Commit** `docs: record reference-pages increment in handoff docs`
- [ ] **Step 5:** Push, open PR against `main`, dogfood-review via this repo's own tool (CI Action + a `/gem-pr-review <N>` marketplace-plugin run), independently validate every finding before fixing, squash-merge.

## Self-review notes

- Spec coverage: all six pages have tasks (1–6); cross-linking decision → Task 7; test-first → every task's Step 1–2; handoff sweep → Task 8; "verification feeds approval" spec inaccuracy is corrected in Task 5 facts (verification fails the CI verdict; `approveMaxPriorityLevel` governs approval) — the spec's wording is superseded by code.
- Execution: inline (superpowers:executing-plans), not subagent-per-task — the six tasks share one test file and the pages must read with one voice; facts are pre-verified above so fresh-context subagents add coordination cost without accuracy gain. The user was unavailable to choose; this is recorded here for review.
