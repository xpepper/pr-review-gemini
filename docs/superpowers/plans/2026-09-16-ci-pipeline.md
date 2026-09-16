# CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a green CI run a hard precondition for merging to `main` and for publishing any release, via one shared workflow definition.

**Architecture:** One dual-trigger workflow (`ci.yml`) runs the check set (version sync + Agent Plugins 1.0 conformance tests + full test suite) on pushes to `main` and on PRs, and is callable via `workflow_call`. The release workflow calls the same workflow at the tag ref, so the release gate is by construction identical to the CI gate. Branch protection (configured last, via `gh api`) requires the two matrix check names.

**Tech Stack:** GitHub Actions (checkout@v7, setup-node@v7), Node.js built-in test runner, `gh` CLI for repo settings. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-ci-pipeline-design.md`

## Global Constraints

- Zero npm dependencies — do not add any; tests use only `node:test`, `node:assert/strict`, `node:fs`, `node:path`.
- Node >= 20, ES Modules. Test command is exactly `npm test`.
- Action pins: `actions/checkout@v7`, `actions/setup-node@v7` (matches `release.yml`). CI workflow permissions: `contents: read`.
- Required status check names (exact strings): `checks (20)` and `checks (24)`.
- Branch protection on `main`: `strict: false`, no required approvals, force pushes and deletions blocked, admins may bypass.
- Release publishing stays dispatch-only and non-idempotent — do not change publish semantics.
- Never write absolute local machine paths into any committed file; use repo-relative paths.
- Conventional commits (`test:`, `ci:`, `docs:`, `chore:`). Every task ships as its own PR against `main`, merged before the next task starts. The pre-commit hook runs the repo's self-review; if it reports blocking findings, address them before committing.
- Each task starts from a fresh `main`: `git checkout main && git pull origin main && git checkout -b <branch>`.

---

### Task 0: Merge the design spec

**Files:** none (repo settings only)

- [ ] **Step 1: Push the spec branch and open its PR**

```bash
git checkout docs/ci-pipeline-design
git push -u origin docs/ci-pipeline-design
gh pr create --title "docs: CI pipeline design spec" \
  --body "Design spec for the CI pipeline: shared reusable CI workflow, branch protection with admin bypass, release gate via workflow_call. See docs/superpowers/specs/2026-09-16-ci-pipeline-design.md."
```

- [ ] **Step 2: Wait for the gem-pr-review workflow, then merge**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Expected: gem-pr-review advisory findings only; merge succeeds.

---

### Task 1: Agent Plugins 1.0 bundle conformance tests

**Files:**
- Modify: `tests/plugin-manifest.test.mjs` (append a new `describe` block)

**Interfaces:**
- Consumes: existing repo manifests `plugin.json`, `mcp.json`, `skills/gem-pr-review/SKILL.md`.
- Produces: `tests/plugin-manifest.test.mjs` exporting no code; later tasks rely on these tests existing inside `npm test` (run by `ci.yml` in Task 3).

- [ ] **Step 1: Write the conformance tests**

Append to `tests/plugin-manifest.test.mjs` (existing imports `describe`, `it`, `assert`, `fs` already cover what is needed):

```js
describe('Agent Plugins 1.0 bundle conformance', () => {
  const plugin = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
  const mcp = JSON.parse(fs.readFileSync('mcp.json', 'utf8'));
  const skillContent = fs.readFileSync('skills/gem-pr-review/SKILL.md', 'utf8');
  const skillFrontmatter = skillContent.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

  it('uses one plugin identity across plugin.json, mcp.json, and the skill', () => {
    assert.equal(mcp.name, plugin.name, 'mcp.json name must match plugin.json name');
    assert.match(
      skillFrontmatter,
      new RegExp(`^name:\\s*${plugin.name}\\b`, 'm'),
      'SKILL.md frontmatter name must match plugin.json name',
    );
  });

  it('declares the Agent Plugins 1.0 $schema in every JSON manifest', () => {
    assert.match(plugin.$schema, /agent-plugins\.org/, 'plugin.json must carry the Agent Plugins schema');
    assert.match(mcp.$schema, /agent-plugins\.org/, 'mcp.json must carry the Agent Plugins schema');
  });

  it('carries a SemVer version in every manifest', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const semver = /^\d+\.\d+\.\d+$/;
    assert.match(pkg.version, semver, 'package.json version must be SemVer');
    assert.match(plugin.version, semver, 'plugin.json version must be SemVer');
    assert.match(mcp.version, semver, 'mcp.json version must be SemVer');
    const skillVersion = skillFrontmatter.match(/^  version:\s*"?(\d+\.\d+\.\d+)"?/m)?.[1];
    assert.ok(skillVersion, 'SKILL.md metadata must carry a version');
    assert.match(skillVersion, semver, 'SKILL.md version must be SemVer');
    assert.equal(plugin.version, pkg.version, 'plugin.json version must match package.json');
    assert.equal(mcp.version, pkg.version, 'mcp.json version must match package.json');
    assert.equal(skillVersion, pkg.version, 'SKILL.md version must match package.json');
  });

  it('keeps every skills/ directory a valid skill named after its directory', () => {
    const dirs = fs
      .readdirSync('skills', { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.ok(dirs.length >= 1, 'skills/ must contain at least one skill');
    for (const dir of dirs) {
      const skillPath = `skills/${dir.name}/SKILL.md`;
      assert.ok(fs.existsSync(skillPath), `${skillPath} must exist`);
      const name = fs.readFileSync(skillPath, 'utf8').match(/^name:\s*(\S+)/m)?.[1];
      assert.equal(name, dir.name, `skill name in ${skillPath} must match its directory name`);
    }
  });

  it('mcp.json declares a runnable server pointing at an existing entrypoint', () => {
    assert.equal(mcp.server.command, 'node');
    assert.deepEqual(mcp.server.args, ['server/index.js']);
    assert.ok(fs.existsSync('server/index.js'), 'server/index.js must exist');
    assert.ok(mcp.mcpServers[plugin.name], `mcpServers must expose '${plugin.name}'`);
    assert.equal(mcp.mcpServers[plugin.name].command, 'node');
    assert.deepEqual(mcp.mcpServers[plugin.name].args, ['server/index.js']);
  });
});
```

- [ ] **Step 2: Run the tests — expect PASS (repo currently conforms)**

Run: `node --test tests/plugin-manifest.test.mjs`
Expected: all pass.

- [ ] **Step 3: Prove the tests fail for the right reason**

Temporarily break the plugin identity, run, restore:

```bash
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('mcp.json','utf8'));m.name='wrong-name';fs.writeFileSync('mcp.json',JSON.stringify(m,null,2)+'\n')"
node --test tests/plugin-manifest.test.mjs
git checkout -- mcp.json
```

Expected: middle command FAILS on `uses one plugin identity across plugin.json, mcp.json, and the skill` (mcp.json name no longer matches); final state restored.

- [ ] **Step 4: Re-run to confirm green, then full suite**

Run: `node --test tests/plugin-manifest.test.mjs && npm test`
Expected: all pass, 0 failures.

- [ ] **Step 5: Commit, PR, merge**

```bash
git checkout -b test/plugin-bundle-conformance
git add tests/plugin-manifest.test.mjs
git commit -m "test: add Agent Plugins 1.0 bundle conformance tests"
git push -u origin test/plugin-bundle-conformance
gh pr create --title "test: Agent Plugins 1.0 bundle conformance tests" \
  --body "Extends tests/plugin-manifest.test.mjs with identity, \$schema, SemVer, skill-directory, and mcp server-shape conformance checks (design spec Task 1)."
gh pr checks --watch && gh pr merge --squash --delete-branch
```

---

### Task 2: action.yml modern-contract tests

**Files:**
- Modify: `tests/ci.test.mjs` (append a new `describe` block at end of file)

**Interfaces:**
- Consumes: repo root `action.yml`.
- Produces: tests inside `npm test` (run by `ci.yml` in Task 3). No exported symbols.

- [ ] **Step 1: Write the contract tests**

Append to `tests/ci.test.mjs` (`describe`, `it`, `assert`, `fs`, `path` are already imported at top of that file):

```js
describe('action.yml modern Action contract', () => {
  const content = fs.readFileSync(path.resolve('action.yml'), 'utf8');

  it('describes the action and runs a composite, not a container', () => {
    assert.match(content, /^description:\s*.+/m, 'action.yml must have a description');
    assert.match(content, /using:\s*['"]?composite['"]?/, 'action.yml must use the composite runner');
    assert.doesNotMatch(content, /using:\s*['"]?docker['"]?/, 'action.yml must not use the docker runner');
  });

  it('documents every declared input with a description', () => {
    const inputsBlock = content.split('inputs:')[1]?.split('outputs:')[0] ?? '';
    const inputNames = [...inputsBlock.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)].map((m) => m[1]);
    assert.ok(
      inputNames.length >= 10,
      `expected at least the 10 documented inputs, found ${inputNames.length}`,
    );
    for (const name of inputNames) {
      assert.match(
        inputsBlock,
        new RegExp(`^  ${name}:\\n    description:`, 'm'),
        `input '${name}' must declare a description as its first property`,
      );
    }
  });

  it('executes the review through the repo entrypoint script', () => {
    assert.match(content, /scripts\/ci-action\.mjs/, 'composite steps must invoke scripts/ci-action.mjs');
  });
});
```

The `inputNames` list is extracted from `action.yml` itself, so declaration is true by construction for every listed name; the `>= 10` length assertion only guards the extraction against silently matching nothing. The explicit required-input name set is already asserted by the existing `requiredInputs` check in `tests/ci.test.mjs`'s `action.yml Manifest Schema Validation` describe.

- [ ] **Step 2: Run the new tests — expect PASS**

Run: `node --test tests/ci.test.mjs`
Expected: all pass (every current input declares `description:` as its first property, 4-space indented).

- [ ] **Step 3: Prove failure for the right reason**

```bash
node -e "const fs=require('fs');let s=fs.readFileSync('action.yml','utf8');s=s.replace(\"    description: 'Review mode: balanced (default), quick, full, or deep'\n\",'');fs.writeFileSync('action.yml',s)"
node --test tests/ci.test.mjs
git checkout -- action.yml
```

Expected: middle command FAILS on `documents every declared input with a description` (mode's description removed); file restored after.

- [ ] **Step 4: Full suite green**

Run: `npm test`
Expected: 0 failures.

- [ ] **Step 5: Commit, PR, merge**

```bash
git checkout -b test/action-modern-contract
git add tests/ci.test.mjs
git commit -m "test: assert action.yml modern composite contract"
git push -u origin test/action-modern-contract
gh pr create --title "test: action.yml modern composite contract" \
  --body "Adds structural contract tests for action.yml: composite runner, per-input descriptions, repo-script execution (design spec Task 2)."
gh pr checks --watch && gh pr merge --squash --delete-branch
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run version:check` (package.json script) and `npm test` (includes Tasks 1–2 tests).
- Produces: reusable workflow `./.github/workflows/ci.yml` exposing `workflow_call` input `ref` (string, default `''`) and job `checks` with matrix legs reporting check names `checks (20)` and `checks (24)` — consumed by Task 4 (`uses` + `with: ref`) and Task 5 (required check names).

- [ ] **Step 1: Create the workflow file**

`.github/workflows/ci.yml`, complete content:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_call:
    inputs:
      ref:
        description: 'Commit ref to check out (empty = event default)'
        type: string
        default: ''

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  checks:
    name: checks
    strategy:
      fail-fast: false
      matrix:
        node-version: ['20', '24']
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref || github.ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node-version }}

      - name: Verify manifest synchronization
        run: npm run version:check

      - name: Run test suite
        run: npm test
```

Note: `name: checks` on the job is explicit so the check-run names are exactly `checks (20)` / `checks (24)` regardless of YAML key naming.

- [ ] **Step 2: Local syntax sanity check**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml"); puts "yaml ok"'`
Expected: `yaml ok` (ruby is used elsewhere in this repo's workflows; YAML 1.1 parsing `on` as boolean is expected and harmless — GitHub's parser treats it correctly).

- [ ] **Step 3: Commit, PR — CI dogfoods itself**

```bash
git checkout -b ci/workflow
git add .github/workflows/ci.yml
git commit -m "ci: add dual-trigger checks workflow (Node 20/24)"
git push -u origin ci/workflow
gh pr create --title "ci: add CI workflow" \
  --body "Dual-trigger CI workflow: push to main + PRs + workflow_call. Runs version:check and the full suite on Node 20 and 24 (design spec Task 3). The PR itself dogfoods the new workflow."
```

- [ ] **Step 4: Watch both matrix legs go green, then merge**

Run: `gh pr checks --watch`
Expected: `checks (20)` and `checks (24)` both report success (plus the advisory gem-pr-review check). Note the exact check names — Task 5 requires them verbatim.

```bash
gh pr merge --squash --delete-branch
```

---

### Task 4: Release workflow consumes the shared CI

**Files:**
- Modify: `.github/workflows/release.yml` (replace the `verify` job; rewire `publish`)
- Modify: `tests/ci.test.mjs:2815-2885` (rewrite the two `Release Workflow Template` tests)
- Modify: `docs/release.md` (Release workflow section)

**Interfaces:**
- Consumes: `./.github/workflows/ci.yml` from Task 3, `workflow_call` input `ref` (string).
- Produces: release gate = `verify-tag` + `ci` jobs; publish blocked unless both pass. No other workflows reference release.yml.

- [ ] **Step 1: Rewrite the release-workflow tests (TDD red first)**

In `tests/ci.test.mjs`, replace the entire `describe('Release Workflow Template (.github/workflows/release.yml)')` block with:

```js
  describe('Release Workflow Template (.github/workflows/release.yml)', () => {
    it('verifies release workflow gates publish on tag alignment and shared CI, dispatch-only', () => {
      const workflowPath = path.resolve('.github/workflows/release.yml');
      assert.equal(fs.existsSync(workflowPath), true, 'release.yml workflow must exist');

      const content = fs.readFileSync(workflowPath, 'utf8');
      assert.match(content, /name:\s*['"]?Release['"]?/);
      assert.match(content, /workflow_dispatch:/);
      assert.match(content, /description:\s*['"]Existing git tag to publish \(e\.g\. v0\.2\.0\)['"]/);
      assert.match(content, /push:\s*\n\s*tags:\s*\n\s*-\s*['"]v\*['"]/);
      assert.match(content, /ref:\s*\$\{\{\s*github\.event\.inputs\.tag \|\| github\.ref\s*\}\}/);
      assert.match(content, /uses:\s*\.\/\.github\/workflows\/ci\.yml/);
      assert.match(content, /needs:\s*\[verify-tag, ci\]/);
      assert.match(content, /if:\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]/);
      assert.match(content, /name:\s*['"]Publish GitHub Release['"]/);
      const existingReleaseCheck = content.indexOf('releases/tags/${TAG_NAME}');
      const releaseCreation = content.indexOf('gh release create "$TAG_NAME"');
      assert.ok(existingReleaseCheck >= 0, 'publish job must reject an existing release');
      assert.ok(existingReleaseCheck < releaseCreation, 'existing release check must run before release creation');
      assert.match(content, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/tags\/\$\{TAG_NAME\}"/);
      assert.match(content, /\*"Not Found"\*\)/);
      assert.match(content, /Unable to verify whether a release exists/);
    });

    it('fails closed unless the release lookup confirms the tag is missing', () => {
      const content = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
      const stepStart = content.indexOf('      - name: Check for Existing Release');
      const stepEnd = content.indexOf('      - name: Generate Release Notes', stepStart);
      const runStart = content.indexOf('        run: |\n', stepStart) + '        run: |\n'.length;
      const script = content
        .slice(runStart, stepEnd)
        .split('\n')
        .map((line) => line.replace(/^          /, ''))
        .join('\n');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-guard-'));
      const ghStub = path.join(tmpDir, 'gh');

      fs.writeFileSync(ghStub, '#!/bin/sh\nprintf "%s" "$GH_OUTPUT" >&2\nexit "$GH_EXIT"\n');
      fs.chmodSync(ghStub, 0o755);

      const runGuard = (exitCode, output) => spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GH_EXIT: String(exitCode),
            GH_OUTPUT: output,
            PATH: `${tmpDir}:${process.env.PATH}`,
            GITHUB_REPOSITORY: 'xpepper/pr-review-gemini',
            TAG_NAME: 'v1.2.3',
          },
        },
      );

      try {
        const existing = runGuard(0, '');
        assert.equal(existing.status, 1);
        assert.match(existing.stdout, /release for tag 'v1\.2\.3' already exists/);

        const missing = runGuard(1, 'gh: Not Found (HTTP 404)');
        assert.equal(missing.status, 0);

        const apiFailure = runGuard(1, 'gh: API rate limit exceeded (HTTP 403)');
        assert.equal(apiFailure.status, 1);
        assert.match(apiFailure.stdout, /Unable to verify whether a release exists/);
        assert.match(apiFailure.stderr, /API rate limit exceeded/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
```

- [ ] **Step 2: Run the tests — expect FAIL (red)**

Run: `node --test tests/ci.test.mjs`
Expected: both `Release Workflow Template` tests FAIL against the current release.yml (no `uses: ./.github/workflows/ci.yml`, no `needs: [verify-tag, ci]`, no `gh api .../releases/tags/...`).

- [ ] **Step 3: Rewrite release.yml**

Full new content of `.github/workflows/release.yml`:

```yaml
name: 'Release'

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Existing git tag to publish (e.g. v0.2.0)'
        required: true

permissions:
  contents: write

jobs:
  verify-tag:
    name: 'Verify Release Tag'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          ref: ${{ github.event.inputs.tag || github.ref }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '20'

      - name: Verify Tag Alignment
        env:
          TAG_NAME: ${{ github.event.inputs.tag || github.ref_name }}
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_NAME" != "v$PKG_VERSION" ]; then
            echo "::error::Release tag '$TAG_NAME' does not match manifest version 'v$PKG_VERSION'"
            exit 1
          fi

  ci:
    name: 'CI'
    uses: ./.github/workflows/ci.yml
    with:
      ref: ${{ github.event.inputs.tag || github.ref }}

  publish:
    name: 'Publish GitHub Release'
    needs: [verify-tag, ci]
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          ref: ${{ github.event.inputs.tag }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '20'

      - name: Check for Existing Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG_NAME: ${{ github.event.inputs.tag }}
        run: |
          response="$(gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${TAG_NAME}" 2>&1)" && {
            echo "::error::A release for tag '$TAG_NAME' already exists. Publish is not idempotent by design — delete the existing release first if you intend to republish, or dispatch a different tag."
            exit 1
          }
          case "$response" in
            *"Not Found"*) ;;
            *)
              echo "::error::Unable to verify whether a release exists for tag '$TAG_NAME'."
              echo "$response" >&2
              exit 1
              ;;
          esac

      - name: Generate Release Notes
        id: notes
        run: |
          node scripts/bump-version.mjs notes --notes-file RELEASE_NOTES.md
          cat RELEASE_NOTES.md

      - name: Create GitHub Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG_NAME: ${{ github.event.inputs.tag }}
        run: |
          gh release create "$TAG_NAME" \
            --title "Release $TAG_NAME" \
            --notes-file RELEASE_NOTES.md \
            --verify-tag
```

Deliberate changes vs the old file: the old `verify` job's manifest-sync check (`node scripts/bump-version.mjs --check`) and `npm test` steps are gone — they now run inside the called CI workflow; `verify-tag` keeps only the release-specific tag alignment; the `ci` job runs in parallel with `verify-tag` (no `needs`), and `publish` waits for both. The existing-release check is also hardened (found by the repo's self-review gate during plan review): it now queries `gh api repos/.../releases/tags/<tag>` and treats only the REST API's `Not Found` response as "no release yet" — every other failure (auth, rate limit, outage) aborts — instead of string-matching `gh release view`'s human-readable output. Publish behavior is unchanged, and the two `Release Workflow Template` tests in `tests/ci.test.mjs` are rewritten in Step 1 to assert the new guard (the executed-script test stubs `gh` and now feeds `gh: Not Found (HTTP 404)` as the missing-release case).

- [ ] **Step 4: Verify — YAML parses and tests go green**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml"); puts "yaml ok"'`
Expected: `yaml ok`.

Run: `node --test tests/ci.test.mjs && npm test`
Expected: all pass, 0 failures.

- [ ] **Step 5: Update docs/release.md**

In `docs/release.md`, replace the paragraph under `## Release workflow` (starting "Pushing a `v*` tag triggers the `verify` job...") with:

```markdown
Pushing a `v*` tag triggers two parallel gates: `verify-tag` (tag ↔
`package.json` version alignment) and `ci` (the shared reusable workflow
`.github/workflows/ci.yml`, running manifest sync, the full test suite,
and spec-conformance checks at the tag ref). Publishing a GitHub Release
is **dispatch-only** and requires both gates green: run the release
workflow via `workflow_dispatch` with the tag input. Publishing refuses to
overwrite — if a release already exists for the tag, it fails (delete the
existing release first); publishing is not idempotent by design.

Because the release gate and the merge gate are the same workflow
definition, a release cannot be published while CI is broken — the checks
re-run at the tag commit even if someone bypassed branch protection.
```

- [ ] **Step 6: Commit, PR, merge**

```bash
git checkout -b ci/release-gate
git add .github/workflows/release.yml tests/ci.test.mjs docs/release.md
git commit -m "ci: gate release on shared CI workflow"
git push -u origin ci/release-gate
gh pr create --title "ci: gate release on shared CI workflow" \
  --body "Reworks release.yml: verify-tag (alignment) + ci (reusable workflow_call at the tag ref) both gate publish; release-guard tests rewritten for the API-based lookup (design spec Task 4)."
gh pr checks --watch && gh pr merge --squash --delete-branch
```

- [ ] **Step 7: Smoke test — tag push (safe, publish skipped)**

On merged `main`, push a throwaway tag and watch the Release workflow:

```bash
git checkout main && git pull origin main
git tag v0.0.0-ci-smoke && git push origin v0.0.0-ci-smoke
gh run list --workflow Release --limit 1
gh run watch
```

Expected: `Verify Release Tag` FAILS with `Release tag 'v0.0.0-ci-smoke' does not match manifest version 'v1.0.1'` (proves alignment gate), `CI` runs green at the tag (proves the reusable call and `ref` input), `Publish GitHub Release` is skipped (tag push is not dispatch). Clean up:

```bash
git push origin :refs/tags/v0.0.0-ci-smoke && git tag -d v0.0.0-ci-smoke
```

- [ ] **Step 8: Smoke test — dispatch against an already-released tag (safe end-to-end)**

```bash
gh workflow run Release --ref main -f tag=v1.0.1
gh run watch
```

Expected: `verify-tag` green (v1.0.1 tag matches that commit's package.json), `ci` green, `publish` fails at the intended idempotency gate with `A release for tag 'v1.0.1' already exists` — proving the full chain without creating anything. (On `workflow_dispatch`, `uses: ./.github/workflows/ci.yml` resolves from the dispatched branch, which has the workflow file; only checkouts fetch the tag.)

---

### Task 5: Branch protection and docs

**Files:**
- Modify: `TODO.md`, `HANDOFF.md`, `docs/roadmap.md`
- Repo settings via `gh api` (no file)

**Interfaces:**
- Consumes: check names `checks (20)`, `checks (24)` produced by Task 3's workflow (must have reported at least once on `main` — true after Task 4's PR merged).
- Produces: protected `main`; final docs.

- [ ] **Step 1: Confirm the check names have reported on main**

```bash
gh api "repos/xpepper/pr-review-gemini/commits/main/check-runs" --jq '.check_runs[].name'
```

Expected output includes `checks (20)` and `checks (24)` (plus gem-pr-review entries).

- [ ] **Step 2: Apply branch protection**

```bash
gh api -X PUT repos/xpepper/pr-review-gemini/branches/main/protection \
  -H 'Accept: application/vnd.github+json' \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["checks (20)", "checks (24)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Expected: HTTP 200 with JSON echoing the settings. (`enforce_admins: false` is the admin-bypass decision from the spec.) If this legacy endpoint is ever rejected (404/410), the equivalent is a repository ruleset via `POST /repos/xpepper/pr-review-gemini/rulesets` with a `required_status_checks` rule and the Administrator role in `bypass_actors` — apply that instead and record it in HANDOFF.md.

- [ ] **Step 3: Verify protection is active**

```bash
gh api repos/xpepper/pr-review-gemini/branches/main/protection \
  --jq '{contexts: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, allow_force_pushes: .allow_force_pushes.enabled}'
```

Expected: `{"contexts":["checks (20)","checks (24)"],"enforce_admins":false,"allow_force_pushes":false}`.

- [ ] **Step 4: Update docs**

In `TODO.md`, append under the completed section:

```markdown
- [x] **Increment 23 / CI Pipeline: merge gate + shared release gate**
  - [x] Dual-trigger `.github/workflows/ci.yml` (push main, PRs, workflow_call) running `version:check` + full suite on Node 20/24.
  - [x] Agent Plugins 1.0 bundle conformance and action.yml modern-contract tests.
  - [x] `release.yml` gates publish on `verify-tag` + shared CI at the tag ref.
  - [x] Branch protection on `main`: required checks `checks (20)`/`checks (24)`, admin bypass, no required approvals.
```

In `docs/roadmap.md`, mark the CI pipeline item done if a matching entry exists (search for `CI`); otherwise append one line under the completed milestones: `- CI pipeline: merge gate on main + shared release gate (2026-09)`.

In `HANDOFF.md`, update the current-state section: branch `main` protected (checks `checks (20)`/`checks (24)` required, admin bypass), release flow unchanged for the operator (`npm run release` + dispatch), check names must be updated in protection if the CI matrix ever changes.

- [ ] **Step 5: Commit and merge docs**

```bash
git checkout -b docs/ci-pipeline-handoff
git add TODO.md HANDOFF.md docs/roadmap.md
git commit -m "docs: record CI pipeline merge and release gates"
git push -u origin docs/ci-pipeline-handoff
gh pr create --title "docs: record CI pipeline gates" \
  --body "Documents the completed CI pipeline: merge gate on main and shared release gate (design spec Task 5)."
gh pr checks --watch && gh pr merge --squash --delete-branch
```

Note: this PR is itself the first merge gated by the new required checks — if `checks (20)`/`checks (24)` do not appear as required within a minute of opening it, re-verify Step 3 before merging.

- [ ] **Step 6: Final verification**

```bash
gh api repos/xpepper/pr-review-gemini/branches/main --jq '.protected'
```

Expected: `true`. Merge to `main` now requires both CI checks; `npm run release` still works from a local admin clone.
