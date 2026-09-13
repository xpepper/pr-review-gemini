# CLI reference

## Commands

| Command | Use |
| --- | --- |
| `npm run dogfood:pr <PR_NUMBER>` | Streamlined PR review with `--model auto`. |
| `node scripts/dogfood-review.mjs <PR_NUMBER> [options]` | Full remote PR-review CLI. |
| `npm run self-review` | Fail-closed review of local uncommitted changes. |
| `npm run install-hook` | Installs a pre-commit hook that runs self-review. |

The script name `dogfood-review` describes this project's use of the tool; it
is the same Gem PR Review engine used by the Copilot CLI skill.

## PR review options

```text
node scripts/dogfood-review.mjs <PR_NUMBER> [options]
```

| Option | Description |
| --- | --- |
| `--quick`, `--balanced`, `--full`, `--deep` | Select a review mode; `balanced` is the default. |
| `--mode <mode>` | Select a mode by name. |
| `--dry-run`, `--no-comment` | Print results without GitHub publication. |
| `--publish`, `--comment` | Submit a host-gated review and anchored inline comments. |
| `--publish-cached` | Publish cached findings without rerunning model inference. |
| `--all` | Publish all findings without interactive selection. |
| `--interactive` | Select findings from an interactive table before publishing. |
| `--select <spec>` | Select indices, ranges, or severities, such as `1,3`, `p0,p1`, or `min:p2`. |
| `--incremental` | Review only new commits and revalidate prior findings. |
| `--resolve` | Verify and resolve addressed review threads. |
| `--architecture`, `--arch` | Generate an architecture walkthrough and Mermaid diagrams. |
| `--role <id>` | Run specific roles; repeat it or provide comma-separated IDs. |
| `--replace-standard-roles` | Run only custom or selected roles. |
| `--guidelines <path>` | Use a custom repository-guidelines file. |
| `--cache-dir <dir>` | Set the findings-cache directory (default: `.gem-pr-cache`). |
| `--base`, `--base-ref <ref>` | Set the base ref for diff and ground-truth checks. |
| `--repo <owner/repo>` | Set the target repository. |
| `--model <model>` | Override the review model. |
| `--mock` | Use a synthetic model runner. |
| `-V`, `--verbose` | Include sanitized diagnostic telemetry. |
| `--json` | Emit machine-readable results. |
| `-v`, `--version` | Show version information. |
| `-h`, `--help` | Show command help. |

### Review modes

`quick` uses correctness, security, and conventions lenses. `balanced` adds
contracts and performance. `full` adds test quality and coverage. `deep` is a
high-reasoning correctness and concurrency review.

### Examples

Standard dry run:

```bash
node scripts/dogfood-review.mjs 42 --dry-run
```

Fast triage:

```bash
node scripts/dogfood-review.mjs 42 --quick --dry-run
```

Incremental re-review:

```bash
node scripts/dogfood-review.mjs 42 --incremental --dry-run
```

Publish a host-gated review:

```bash
node scripts/dogfood-review.mjs 42 --publish
```

Inspect findings, then publish the cached result:

```bash
node scripts/dogfood-review.mjs 42 --dry-run
node scripts/dogfood-review.mjs 42 --publish-cached
```

Choose findings interactively:

```bash
node scripts/dogfood-review.mjs 42 --publish --interactive
```

`--dry-run` is the safe inspection path: it never publishes. Publication and
cached publication both enforce diff-anchor and current-head validation before
the host writes to GitHub.

## Self-review

```text
node scripts/self-review.mjs [options]
```

Self-review uses the same modes, `--role`, `--replace-standard-roles`,
`--architecture`, `--guidelines`, `--mock`, `--verbose`, `--json`, version, and
help flags as PR review. It additionally supports:

| Option | Description |
| --- | --- |
| `--all` | Review staged, unstaged, and untracked changes (default). |
| `--staged`, `--unstaged`, `--head` | Limit the local diff scope. |
| `--no-untracked` | Exclude untracked files. |
| `--fail-on <level>` | Fail when findings meet the threshold (default: `P1`). |
| `--install-hook`, `--uninstall-hook` | Manage the self-review pre-commit hook. |
| `--command <cmd>` | Set the pre-commit command (default: `npm run self-review`). |

```bash
npm run self-review
node scripts/self-review.mjs --staged --fail-on P1
```

Self-review returns `PASS` only when no finding meets its configured blocking
threshold. It works from the local worktree and makes no remote GitHub mutation.
