# Plugin-First Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the README lead with the tool's Agent Plugins 1.0 plugin identity (with the GitHub Action as an equal, complementary shape), add a deep plugin reference, and publish a verified Copilot CLI marketplace entry in `xpepper/copilot-plugins`.

**Architecture:** Docs-only restructure in this repository, gated by the existing docs-consistency tests (`tests/skills.test.mjs`). The marketplace entry lives in its own repository (`xpepper/copilot-plugins`) and points back at this repo via the cross-repo source form used by GitHub's reference marketplace — no `src/` or `scripts/` changes here. Spec: `docs/superpowers/specs/2026-09-13-plugin-first-docs-design.md`.

**Tech Stack:** Node.js >= 20 (ES Modules), `node --test`, Markdown docs, JSON manifests, `copilot` CLI, `gh`.

## Global Constraints

- Run tests with `npm test`; single file: `node --test tests/skills.test.mjs`.
- Never include local machine paths (e.g. `/Users/...`) in documentation, test fixtures, or code. `~/.copilot/gem-pr-review.json` (tilde form) is allowed. Scratch/experiment directories used only in the terminal are fine.
- README must keep the literal link text `(docs/cli.md)` (asserted by `tests/skills.test.mjs:179`).
- Current version is `0.3.3` everywhere; Action examples pin `xpepper/pr-review-gemini@v0.3.3`. Do not bump versions in this increment.
- Conventional commits on branch `docs/plugin-first-docs` (already checked out).
- The marketplace repository is `xpepper/copilot-plugins`; the marketplace's `name` field is `xpepper-copilot-plugins` (avoiding collision with GitHub's official `copilot-plugins` marketplace name). It does not exist yet and is created in Task 5.
- No code changes in this repository (`src/`, `scripts/` untouched).
- Portability wording (settled with owner): packaging is harness-agnostic per Agent Plugins 1.0; the engine's specialist lenses run on the Copilot CLI runtime; verified harness is GitHub Copilot CLI. Never claim "runs anywhere" unqualified.
- The repo's pre-commit hook runs the self-review engine on every commit; expect review output in commit logs and read it before assuming success.

---

### Task 1: Failing docs-consistency tests for the plugin-first structure

**Files:**
- Modify: `tests/skills.test.mjs`

**Interfaces:**
- Consumes: existing `describe` block and `path.resolve` consts at `tests/skills.test.mjs:6-10`.
- Produces: new const `pluginReferencePath` and three new `it(...)` blocks that Tasks 2-3 and 6 make pass.

- [ ] **Step 1: Add the const and test cases**

At `tests/skills.test.mjs:10`, after the `actionReferencePath` line, add:

```js
  const pluginReferencePath = path.resolve('docs/plugin.md');
```

After the existing `it('links first-time users to the CLI reference for advanced CLI usage', ...)` block (ends at line 181), add:

```js
  it('links first-time users to the plugin reference and plugin identity', () => {
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.match(readmeContent, /\(docs\/plugin\.md\)/, 'README should link to the plugin reference');
    assert.match(readmeContent, /Agent Plugins 1\.0/, 'README should state the Agent Plugins identity');
    assert.match(readmeContent, /copilot plugin install/, 'README should show the Copilot plugin install');
  });

  it('documents the plugin shape in the focused plugin reference', () => {
    assert.ok(fs.existsSync(pluginReferencePath), 'docs/plugin.md must exist');
    const content = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(content, /agent-plugins\.org/, 'Plugin reference should link the Agent Plugins spec');
    assert.match(content, /copilot plugin install/, 'Plugin reference should document install');
    assert.match(content, /Copilot CLI runtime/, 'Plugin reference should document the runtime requirement');
    assert.match(content, /\/gem-pr-review /, 'Plugin reference should document skill invocation');
    assert.match(content, /gem_pr_review_subagents/, 'Plugin reference should document MCP tools');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/skills.test.mjs`
Expected: FAIL — `docs/plugin.md must exist` and `README should link to the plugin reference`. All other tests in the file still pass.

- [ ] **Step 3: Commit (red baseline)**

```bash
git add tests/skills.test.mjs
git commit -m "test: add docs-consistency checks for plugin-first structure"
```

---

### Task 2: Create docs/plugin.md

**Files:**
- Create: `docs/plugin.md`

**Interfaces:**
- Consumes: Task 1's assertions (they define the required strings).
- Produces: the plugin deep-dive referenced by README (Task 3) and extended by Task 6.

- [ ] **Step 1: Write the file with exactly this content**

```markdown
# Plugin reference (Agent Plugins 1.0)

Gem PR Review is packaged as an [Agent Plugins 1.0](https://agent-plugins.org/)
plugin. Any agent harness that implements the standard can install and invoke
it; GitHub Copilot CLI is the verified harness. The review engine's specialist
lenses run on the Copilot CLI runtime (`@github/copilot-sdk`) using your
Copilot subscription, and GitHub access goes through the GitHub CLI (`gh`).

## What the package contains

| Surface | File | What it gives a harness |
| --- | --- | --- |
| Plugin manifest | `plugin.json` | Standard manifest: name, version, description, keywords. |
| Agent Skill | `skills/gem-pr-review/SKILL.md` | Slash-command entry point and review playbook the harness's model follows. |
| MCP server | `mcp.json` + `server/index.js` | Model Context Protocol tools the harness can call directly. |

## Requirements

- Node.js >= 20.
- Authenticated [GitHub CLI](https://cli.github.com/) (`gh auth status`).
- Copilot CLI on the `PATH` for model inference. Optionally point the engine
  at a specific runtime with `COPILOT_CLI_PATH` and `COPILOT_SDK_PATH`.

## Install

From GitHub (verified path):

```bash
copilot plugin install xpepper/pr-review-gemini
```

Verify the skill is available by starting Copilot CLI and checking that
`/gem-pr-review` completes as a command. Invoke it with a pull request number:

```text
/gem-pr-review 42
```

During local development, load the repository without installing:

```bash
copilot --plugin-dir .
```

Other Agent Plugins 1.0 harnesses: install this repository as a plugin
according to your harness's plugin installation mechanism. The packaging
above is all standard; no Copilot-specific files are required for discovery.

## Steering a review

The skill accepts the same knobs as the CLI and Action shapes, expressed
naturally or as flags in the underlying commands:

- Modes: `quick` (3 lenses), `balanced` (default, 5 lenses), `full`
  (6 lenses), `deep` (high-reasoning correctness focus).
- `--incremental` re-reviews only new commits and revalidates prior findings.
- Dry-run vs publish, finding selection (`--select p0,p1` or interactive),
  thread resolution (`--resolve`), and architecture walkthroughs
  (`--architecture`) behave as documented in the
  [CLI reference](cli.md).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `gem_pr_review_subagents` | Run the parallel specialist-lens review (mode, roles, custom roles, dry-run/publish). |
| `gem_pr_review_diff` | Fetch PR diff metadata with file-backed paging. |
| `gem_pr_review_diff_read` | Read diff ranges by file, offset, or line. |
| `gem_pr_review_publish` | Submit the host-gated review. |
| `gem_pr_review_publish_cached` | Publish cached findings without re-running inference. |
| `gem_pr_review_prior` | Prior findings for incremental re-reviews. |
| `gem_pr_review_threads` | Inspect review threads; verify and resolve addressed ones. |
| `gem_pr_review_architecture` | Architecture walkthrough with Mermaid diagrams. |
| `gem_pr_review_verify` | Detached-worktree verification (safe profiles only). |
| `gem_self_review` / `gem_pr_review_self` | Fail-closed review of local uncommitted changes. |
| `gem_pr_review_guidelines` | Load repository review guidelines. |
| `gem_pr_review_diagnostics` | Sanitized execution telemetry. |

Short aliases without the `gem_pr_review_` prefix exist for the thread,
architecture, guidelines, and diagnostics tools.

## Configuration and tweaks

- **Custom roles:** define `custom_roles` (with optional `model` and
  `reasoningEffort` per role), `replace_standard_roles`, and `enabled_roles`
  in `.github/gem-pr-review.json` (repository) or
  `~/.copilot/gem-pr-review.json` (user). CLI mirrors: `--role`,
  `--replace-standard-roles`.
- **Repository guidelines:** `.github/gem-pr-review.md` by default, override
  with `--guidelines <path>`.
- **Model resilience:** when a configured model is unavailable (quota or
  capacity), the engine falls back through the model catalog to `auto`.

## How the shapes relate

The plugin, the [GitHub Action](github-action.md), and the
[local CLI](cli.md) run the same engine with the same host-gated safety
model. They are complementary: use the plugin interactively from your
harness, the Action in CI, and the CLI for scripting and dry runs.
```

- [ ] **Step 2: Run the docs tests**

Run: `node --test tests/skills.test.mjs`
Expected: The `documents the plugin shape...` test PASSES. The README test from Task 1 still FAILS (`README should link to the plugin reference`).

- [ ] **Step 3: Commit**

```bash
git add docs/plugin.md
git commit -m "docs: add Agent Plugins plugin reference"
```

---

### Task 3: Rewrite README.md plugin-first

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: Task 1's README assertions; keeps the `(docs/cli.md)` link for `tests/skills.test.mjs:179`.
- Produces: the streamlined plugin-first README; sections 2 and 3 have equal weight.

- [ ] **Step 1: Replace README.md content with exactly this**

```markdown
# Gem PR Review

Gem PR Review is a parallel, multi-lens AI code reviewer for GitHub pull
requests. It is packaged as an [Agent Plugins 1.0](https://agent-plugins.org/)
plugin — any compliant agent harness can install and invoke it (verified with
GitHub Copilot CLI) — and it also ships as a GitHub Action for automated CI
review. Both shapes run the same engine and the same host-gated safety model;
they are complementary, not exclusive.

## Use it as a plugin

Works with any harness that supports the Agent Plugins protocol. With GitHub
Copilot CLI, the verified harness:

```bash
copilot plugin install xpepper/pr-review-gemini
```

Then start Copilot CLI and invoke the skill on a pull request:

```text
/gem-pr-review 42
```

During local development, load the repository without installing:

```bash
copilot --plugin-dir .
```

The specialist lenses run on the Copilot CLI runtime via your Copilot
subscription, and GitHub access uses an authenticated `gh`. For other
harnesses, exposed MCP tools, and configuration, see the
[plugin reference](docs/plugin.md).

## Run it as a GitHub Action

[Install from the GitHub Marketplace](https://github.com/marketplace/actions/gem-pr-review),
then add this workflow to `.github/workflows/gem-pr-review.yml`:

```yaml
name: Gem PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.ref }}
      - uses: xpepper/pr-review-gemini@v0.3.3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: balanced
          fail_on: P1
```

This minimal workflow handles pull-request events only. For the `/gem-review`
comment trigger and concurrency controls, see the complete
[GitHub Action reference](docs/github-action.md).

## Driving a review

The same knobs are available in every shape:

- **Modes:** `quick` (3 lenses), `balanced` (default, 5), `full` (6), `deep`
  (high-reasoning correctness focus); `--incremental` re-reviews only new
  commits.
- **Dry-run vs publish:** inspect findings first, then submit the host-gated
  review — optionally publishing cached findings without re-running inference.
- **Finding selection:** publish all, filter by severity or index
  (`--select p0,p1`), or choose interactively.
- **Thread lifecycle:** verify and resolve addressed review threads
  (`--resolve`).
- **Architecture walkthroughs:** Mermaid sequence and component diagrams
  (`--architecture`).
- **Custom reviewer roles:** per-repository or per-user role definitions with
  per-role model and reasoning effort.
- **Repository guidelines:** `.github/gem-pr-review.md` conventions applied to
  every review.
- **Model resilience:** automatic catalog fallback when a model is
  unavailable.

Full flag tables per shape: [plugin](docs/plugin.md),
[Action](docs/github-action.md), [CLI](docs/cli.md).

## Safety model

GitHub mutations are host-gated: the reviewer cannot write to GitHub directly.
Before publication, the host validates every inline comment against a changed
diff hunk, blocks publication when the PR head has become stale, and caps inline
comments. In CI, the Action analyzes the diff while the runner remains on the
trusted base branch; it does not check out or execute untrusted PR-head code by
default. Optional detached-worktree verification has additional same-repository
and safe-profile gates.

## Capabilities

- Parallel specialist review modes for correctness, contracts, security,
  performance, conventions, and tests.
- Incremental re-reviews, finding selection, cached publish-later workflows,
  and safe review-thread resolution.
- Local fail-closed self-review, optional architecture walkthroughs, and
  sanitized verbose diagnostics.

## Documentation

- [Installation and quick starts](docs/installation.md)
- [Plugin reference](docs/plugin.md)
- [GitHub Action reference](docs/github-action.md)
- [CLI reference](docs/cli.md)
- [Dogfooding feedback process](docs/dogfooding-feedback.md)
- [Architecture and roadmap](docs/roadmap.md)

## Support and feedback

Report reproducible bugs or documentation gaps through
[GitHub Issues](https://github.com/xpepper/pr-review-gemini/issues). For real
PR reviews, use the privacy-safe, evidence-based
[dogfooding feedback process](docs/dogfooding-feedback.md): verify findings
against the diff and repository context before recording them, and never include
credentials, raw prompts or diffs, sensitive diagnostics, or local machine
paths.

## License

MIT
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: ALL PASS (Task 1's assertions now satisfied; `(docs/cli.md)` link retained).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: lead README with the Agent Plugins identity"
```

---

### Task 4: Reorder installation.md and add cross-links

**Files:**
- Modify: `docs/installation.md` (reorder sections)
- Modify: `docs/github-action.md:1-5` (one cross-link sentence)
- Modify: `docs/cli.md:12-13` (extend the existing cross-reference)

**Interfaces:**
- Consumes: `docs/plugin.md` from Task 2.
- Produces: install order matching the README (plugin → Action → CLI).

- [ ] **Step 1: Rewrite installation.md section order**

Replace the `## GitHub Marketplace and Action` and `## Copilot CLI plugin` sections so the file reads: intro paragraph (unchanged), `## Copilot CLI plugin` (unchanged content), `## GitHub Marketplace and Action` (unchanged content), `## Local CLI quick starts` (unchanged). Additionally, at the end of the `## Copilot CLI plugin` section add:

```markdown
For other Agent Plugins 1.0 harnesses, MCP tools, and configuration, see the
[plugin reference](plugin.md).
```

- [ ] **Step 2: Add the Action cross-link**

In `docs/github-action.md`, after the intro paragraph (line 5), add:

```markdown
The same engine is available as an Agent Plugins 1.0 plugin and a local CLI;
see the [plugin reference](plugin.md) and [CLI reference](cli.md).
```

- [ ] **Step 3: Add the CLI cross-link**

In `docs/cli.md`, after the existing note about `dogfood-review` naming (line 13), add:

```markdown
The same engine is available as an Agent Plugins 1.0 plugin and a GitHub
Action; see the [plugin reference](plugin.md) and
[Action reference](github-action.md).
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test` — Expected: ALL PASS.

```bash
git add docs/installation.md docs/github-action.md docs/cli.md
git commit -m "docs: align install order with plugin-first structure"
```

---

### Task 5: Marketplace — root-path experiment, then create `xpepper/copilot-plugins`

**Files:**
- Create (outside this repo): scratch experiment dir, then the `xpepper/copilot-plugins` repository
- Nothing is committed to THIS repository in this task.

**Interfaces:**
- Consumes: the published `main` of `xpepper/pr-review-gemini` (its root `plugin.json`, unchanged by this branch).
- Produces: the live marketplace `xpepper/copilot-plugins` listing `gem-pr-review` via cross-repo source; verified commands that Task 6 documents.

**Decision gate:** resolves whether the object source's `path` accepts the repository root. If `"."`, `""`, and `"/"` are all rejected, STOP and report — restructuring this repo is out of scope and needs the owner's decision; Task 6 is then void.

- [ ] **Step 1: Build the scratch marketplace and test root-path resolution**

Create a scratch directory (terminal-only; never committed) containing `.github/plugin/marketplace.json`:

```json
{
  "name": "xpepper-copilot-plugins-scratch",
  "owner": {
    "name": "Pietro Di Bello",
    "email": "pierodibello@gmail.com"
  },
  "metadata": {
    "description": "Scratch verification of cross-repo root-path source resolution.",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "gem-pr-review",
      "description": "Parallel, multi-lens AI code review for GitHub pull requests.",
      "version": "0.3.3",
      "source": {
        "source": "github",
        "repo": "xpepper/pr-review-gemini",
        "path": "."
      }
    }
  ]
}
```

Then:

```bash
copilot plugin marketplace add <scratch-dir>
copilot plugin marketplace list
copilot plugin install gem-pr-review
```

Start `copilot` and confirm `/gem-pr-review` completes as a command. Expected: the plugin resolves from the repository root.

- If resolution FAILS with `path: "."`: retry the whole step with `path: ""`, then `path: "/"`.
- If all three fail: `copilot plugin uninstall gem-pr-review` (if installed), `copilot plugin marketplace remove xpepper-copilot-plugins-scratch`, delete the scratch dir, STOP, and report.
- On success, note which `path` value worked, uninstall, remove the scratch marketplace, and delete the scratch dir.

- [ ] **Step 2: Create the marketplace repository**

```bash
gh repo create xpepper/copilot-plugins --public --description "Copilot CLI plugin marketplace for xpepper plugins" --clone
```

In the cloned repo, create `.github/plugin/marketplace.json` (same content as the scratch file, with `name` changed to `xpepper-copilot-plugins` and the description `"Marketplace listing xpepper's Copilot CLI plugins."`, keeping the `path` value verified in Step 1), plus a minimal `README.md`:

```markdown
# xpepper/copilot-plugins

Copilot CLI plugin marketplace. Register it and install plugins:

    copilot plugin marketplace add xpepper/copilot-plugins
    copilot plugin install gem-pr-review

Plugin sources live in their own repositories; each entry's `source` field
points at the plugin's repository and path.
```

Commit and push (in the marketplace clone, `main` branch):

```bash
git add README.md .github/plugin/marketplace.json
git commit -m "feat: add gem-pr-review marketplace listing"
git push -u origin main
```

- [ ] **Step 3: Verify end to end and leave it installed**

```bash
copilot plugin marketplace add xpepper/copilot-plugins
copilot plugin install gem-pr-review
```

Start `copilot`, confirm `/gem-pr-review` completes. Leave the marketplace and plugin registered on this machine (the owner dogfoods this plugin daily). Record the verified `path` value in the task report for Task 6.

---

### Task 6: Document the marketplace install path and release-time maintenance

**Files:**
- Modify: `docs/plugin.md` (Install section), `README.md` (plugin section)
- Modify: `tests/skills.test.mjs`

**Interfaces:**
- Consumes: verified marketplace commands and `path` value from Task 5 (abort this task if Task 5 stopped at its decision gate).
- Produces: final documented install flows.

- [ ] **Step 1: Add the failing assertion**

In `tests/skills.test.mjs`, inside `it('documents the plugin shape in the focused plugin reference', ...)`, add:

```js
    assert.match(content, /marketplace add xpepper\/copilot-plugins/, 'Plugin reference should document marketplace install');
```

Run: `node --test tests/skills.test.mjs` — Expected: FAIL on this assertion.

- [ ] **Step 2: Document in plugin.md**

In the `## Install` section of `docs/plugin.md`, after the GitHub install command block and before "Verify the skill is available", insert:

```markdown
Or register xpepper's Copilot plugin marketplace and install from it:

```bash
copilot plugin marketplace add xpepper/copilot-plugins
copilot plugin install gem-pr-review
```
```

And at the end of the `## How the shapes relate` section, add the maintenance note:

```markdown
Marketplace maintenance: at release time, update the `gem-pr-review` entry's
`version` in the [`xpepper/copilot-plugins`](https://github.com/xpepper/copilot-plugins)
marketplace to the released version.
```

- [ ] **Step 3: Document in README**

In `README.md`'s `## Use it as a plugin` section, after the `copilot plugin install xpepper/pr-review-gemini` code block, add:

```markdown
Alternatively, register xpepper's Copilot plugin marketplace:
`copilot plugin marketplace add xpepper/copilot-plugins`.
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/skills.test.mjs` — Expected: PASS.

```bash
git add docs/plugin.md README.md tests/skills.test.mjs
git commit -m "docs: document marketplace install path"
```

---

### Task 7: Full verification and handoff updates

**Files:**
- Modify: `TODO.md`, `docs/roadmap.md`, `HANDOFF.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: green suite and updated handoff context.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: ALL PASS, including the repo's own review of the docs diff via the docs-consistency path.

- [ ] **Step 2: Update handoff docs**

- `TODO.md`: mark the plugin-first docs + marketplace entry work as done; set the next active step.
- `docs/roadmap.md`: append a dated increment entry summarizing this work (mirror the existing increment-entry style).
- `HANDOFF.md`: current branch `docs/plugin-first-docs`, commit status, and next actions (open PR against `main`; the PR will be reviewed by this tool itself per the dogfooding rule).

- [ ] **Step 3: Commit**

```bash
git add TODO.md docs/roadmap.md HANDOFF.md
git commit -m "docs: record plugin-first docs increment in handoff"
```

---

## Self-Review Notes

- Spec coverage: README rewrite (Task 3), plugin.md (Task 2), installation reorder + cross-links (Task 4), docs tests (Tasks 1, 6), marketplace experiment + repo creation (Task 5), marketplace docs + maintenance note (Task 6), AGENTS.md §4 handoff (Task 7). Success criteria map 1:1.
- Task 5 is the only task with a STOP branch; if it stops, Task 6 is void and the owner decides restructuring.
- No code changes in this repository; version stays 0.3.3 everywhere.
- Task 5 creates a public repository under the owner's account (`xpepper/copilot-plugins`) — explicitly decided with the owner before execution.
