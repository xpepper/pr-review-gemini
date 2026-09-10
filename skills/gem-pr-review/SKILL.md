---
name: gem-pr-review
description: Comprehensive parallel AI code review for GitHub pull requests using specialized lenses and host-gated publishing.
license: MIT
compatibility: Node.js >= 20.0.0, GitHub CLI (gh), Agent Plugins 1.0
metadata:
  version: "0.1.0"
allowed-tools: Bash, gh, git, node
---

# Gem PR Review: Parallel Multi-Lens AI Code Review

## Purpose

`gem-pr-review` provides automated, multi-lens code review for GitHub pull requests following the Agent Plugins 1.0 standard.
It distributes review analysis across specialized lenses, captures high-signal findings with confidence ratings, grounds all inline comments in verified diff hunks, and safely submits host-gated GitHub reviews.

---

## Review Modes

Reviewers can trigger different modes based on PR complexity and speed requirements:

* **`--balanced` (default)**:
  Runs 5 core lenses in parallel: Correctness & Concurrency, Contracts & Data, Security & Trust, Performance & Resources, Conventions & Maintainability.
* **`--quick`**:
  High-speed triage running 3 critical lenses: Correctness, Security, Conventions. Optimized for fast feedback on straightforward PRs.
* **`--full`**:
  Comprehensive review running 6 lenses: adds Test Quality & Coverage alongside all 5 balanced lenses.
* **`--deep`**:
  Deep-focus mode targeting complex algorithmic or concurrency changes, dedicating maximum reasoning effort to Correctness & Concurrency.
* **`--incremental`**:
  Re-review mode that hunts only the new commit range (`prior_head...current_head`) since the previous review, classifying commit relationships and revalidating previous findings.

---

## Specialist Review Lenses

Each specialist lens inspects the unified diff through an independent, focused perspective:

### 1. Correctness & Concurrency (`correctness`)
- Logical flaws, calculation errors, inverted conditions, and off-by-one bounds.
- Race conditions, concurrent access without synchronization, deadlocks, and stale state.
- Unhandled error cases, null or undefined dereferences, and uncaught exceptions.
- Async lifecycle violations: unawaited promises, hanging timeouts, unhandled rejections.

### 2. Contracts & Data (`contracts`)
- API surface alterations, signature changes, and backwards compatibility.
- Schema mutations, serialisation/deserialisation risks, and missing field migrations.
- Typing consistency, interface violations, and loose invariants.

### 3. Security & Trust Boundaries (`security`)
- Injection vectors (SQL, command, HTML/XSS, template injection).
- Authentication and authorisation bypasses, missing privilege checks.
- Sensitive data exposure in logs, error traces, or client-facing responses.
- Insecure deserialisation, untrusted input handling, and supply-chain / dependency risks.

### 4. Performance & Resources (`performance`)
- Algorithmic complexity regressions (e.g. $O(N^2)$ loops where $O(N)$ is required).
- N+1 database queries, unbatched I/O calls, or redundant network roundtrips.
- Memory retention, event listener leaks, unclosed streams, file handles, or connections.
- Unnecessary large object allocations in hot loops.

### 5. Conventions & Maintainability (`conventions`)
- Architectural cohesion, project pattern adherence, and separation of concerns.
- Clear naming, self-documenting code, and avoidance of cryptic abstractions.
- Dead code, dangling commented lines, and duplicate logic.

### 6. Test Quality & Verification (`tests`)
- Missing test coverage for newly introduced branches, edge cases, or failure modes.
- Brittle assertions, non-deterministic timing / flaky assertions.
- Test ergonomics, mocking fidelity, and alignment with production behaviour.

---

## Structured Findings Contract

Reviewers must format findings using structured representations so they can be parsed deterministically:

### Finding Fields
- **Severity**:
  - `[P0]`: Critical blocker (security vulnerability, crash, data corruption).
  - `[P1]`: Major bug (functional defect, regression, broken contract).
  - `[P2]`: Medium concern (edge-case flaw, performance degradation).
  - `[P3]`: Minor improvement (code quality, maintainability suggestion).
  - `[nit]`: Trivial cosmetic or stylistic note.
- **Location**: Exact file path and line number (`path/to/file.js:42`), matching the diff.
- **Side**: `RIGHT` (new / added / modified code) or `LEFT` (removed code). Defaults to `RIGHT`.
- **Confidence**: Numerical score from `0.0` to `1.0`. Only findings with confidence $\ge 0.7$ should be reported.
- **Title & Explanation**: Concise summary line followed by technical explanation and suggested concrete remediation.

### Supported Output Formats

#### 1. Markdown Heading Format
```markdown
### [P1] Missing null check on user profile
- **File**: `src/auth.js:45`
- **Side**: RIGHT
- **Confidence**: 0.95

When `user.profile` is undefined for guest accounts, accessing `user.profile.id` throws a TypeError.

```javascript
// Suggested fix:
const profileId = user.profile?.id ?? null;
```
```

#### 2. Bullet List Format
```markdown
- **[P0]** `src/api.js:88` (confidence: 0.9): Unsanitized user query passed directly to SQL statement.
- **[P2]** `src/cache.js:12` (confidence: 0.8): Cache key collision possible when delimiter is present in input.
```

#### 3. Delimited JSON Envelope
```text
<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Missing null check on user profile",
    "severity": "P1",
    "file": "src/auth.js",
    "line": 45,
    "side": "RIGHT",
    "confidence": 0.95,
    "body": "When user.profile is undefined, accessing user.profile.id throws a TypeError."
  }
]
<<<END_PR_REVIEW_JSON>>>
```

---

## Incremental Re-reviews & Finding Revalidation (`--incremental`)

When re-evaluating pull requests that have received prior reviews, the `--incremental` workflow ensures that work is not repeated unnecessarily:

1. **Prior Review Discovery**:
   Fetches previous reviews and inline comments submitted for the PR via GitHub API, extracting prior findings and the evaluated commit SHA.
2. **Commit Relationship Classification**:
   - `same_head`: The PR head commit has not changed since the last review. Avoids redundant re-reviews.
   - `incremental`: The PR head directly extends the prior reviewed commit. Re-review inspects only the delta (`prior_head...current_head`).
   - `diverged`: The branch diverged or was rebased. Gracefully falls back to a full review of `base...head`.
   - `none`: No prior reviews were found. Proceeds with a standard full review.
3. **Prior Finding Revalidation**:
   Matches previous findings against the incremental diff:
   - **`resolved`**: The file and line range were modified in the incremental commits, addressing the issue.
   - **`still open`**: The flagged code remains untouched in the new commits and still requires attention.
   - **`obsolete`**: The flagged file was deleted or the surrounding block was refactored out.
4. **Focused Specialist Inspection**:
   Specialist lenses evaluate only the newly added/modified code in the incremental range, merging still-open prior findings with new findings for comprehensive coverage.

---

## Host-Gated Publishing & Safety Controls

The host execution environment validates all model outputs before submitting to GitHub:

1. **Diff Anchor Validation**:
   Every finding's `file`, `line`, and `side` are matched against actual unified diff hunks (`@@ -old,+new @@`). Only commentable lines receive inline GitHub comments.
2. **Safe Demotion**:
   Findings referencing lines outside diff hunks, deleted files on `RIGHT`, or untracked paths are demoted to an "Additional Findings" section in the overall review summary. No findings are dropped.
3. **Inline Comment Capping**:
   At most 50 inline comments are submitted per review to avoid GitHub API rate limits and review fatigue. Excess findings are demoted by priority (`P0` > `P1` > `P2` > `P3` > `nit`).
4. **Stale Head Protection**:
   Verifies that the PR head SHA on GitHub matches the evaluated commit SHA before posting.
5. **Review Event Safety**:
   - `REQUEST_CHANGES` is strictly forbidden and automatically forced to `COMMENT`.
   - `APPROVE` is only permissible if explicitly configured via `approveMaxPriorityLevel` and never on the author's own pull request.

---

## Safe Review Publishing Execution Workflow

To avoid shell escape errors, rate-limiting, and broken markdown formatting (e.g. literal `\n\n` on GitHub):

### 1. Primary Method: MCP Tool or CLI Runner (Recommended)
- **Via MCP Server Tool**:
  If the `gem_pr_review_publish` (or `pr_review_publish`) tool is available, invoke it directly with structured JSON:
  ```json
  {
    "prNumber": 123,
    "findings": [...],
    "reviewBody": "### 🟡 Changes recommended\n\nSummary text..."
  }
  ```
- **Via CLI Runner**:
  ```bash
  node scripts/dogfood-review.mjs <PR_NUMBER> --publish
  ```

### 2. Manual `gh api` Submission Rules (Formatting Safety)
If posting manually via `gh api` in bash/zsh:
- **CRITICAL**: Never pass multiline review markdown using single-quoted `-f body='...\n\n...'` or `-f 'comments[][body]=...'`. Single quotes in shells do NOT expand `\n`, which posts literal `\n\n` characters on GitHub.
- **ALWAYS** pipe the JSON payload via stdin using `--input -`:
  ```bash
  gh api --method POST repos/:owner/:repo/pulls/<PR_NUMBER>/reviews --input - <<'EOF'
  {
    "commit_id": "<HEAD_SHA>",
    "event": "COMMENT",
    "body": "### 🟡 Changes recommended\n\nExplanation of issues...",
    "comments": [
      {
        "path": "path/to/file.ext",
        "line": 42,
        "side": "RIGHT",
        "body": "**[P1] Finding Title** (confidence: 0.95)\n\nDetailed finding explanation."
      }
    ]
  }
  EOF
  ```

---

## Large-Diff Transport & Host-Supervised Reading (> 200 KB)

Pull requests with extensive changes can exceed LLM context windows or degrade review precision if completely inlined into prompts.
`gem-pr-review` includes an automated file-backed transport for diffs exceeding **200 KB** (`200 * 1024` bytes):

1. **Threshold Detection**:
   - Diffs $\le$ **200 KB** maintain direct backward compatibility via standard in-memory prompt inlining.
   - Diffs $>$ **200 KB** automatically activate file-backed paging transport.

2. **File-Backed Transport & Changed-File Manifest**:
   - The unified diff is persisted to temporary file storage during review execution and cleaned up immediately upon completion.
   - Reviewer prompts receive a structured changed-file manifest table detailing file status (`modified`, `added`, `deleted`, `renamed`, `binary`), additions, deletions, hunk counts, and byte sizes.

3. **Host-Supervised Inspection Tools**:
   Specialist review passes are equipped with host-supervised tools to inspect critical diff sections on demand:
   - **`diff_read`** (or `read`): Slices unified diff sections by file path, character offset, limit, or line range.
   - **`diff_grep`** (or `grep`): Searches diff content for literal or regex patterns with line numbers and file context.
   - **`diff_find`** (or `find`): Filters files in the changed manifest by filename pattern or status without consuming read operations.

4. **Access Budget Safeguards**:
   To prevent context saturation and runaway tool recursion, host-supervised reading is strictly capped:
   - Maximum **16 reads** per review pass.
   - Access budget capped at **~640 KB** across operations (with a hard ceiling of 1 MB maximum).
   - Attempts exceeding the budget or accessing paths outside the diff (e.g. path traversal) are rejected safely.

---

## Interactive Finding Selection & Cached Publish-Later

`gem-pr-review` provides reviewer controls to triage findings interactively and publish cached findings later without rerunning expensive model subagents:

### 1. Interactive Finding Selection
- **Interactive Triage Prompt**:
  When publishing reviews interactively, reviewers are presented with a clean findings table displaying:
  - Finding index (`[1]`, `[2]`, ...)
  - Severity (`[P0]`, `[P1]`, `[P2]`, `[P3]`, `[nit]`)
  - Confidence rating (e.g. `95%`)
  - Diff location (`file:line (side)`)
  - Concise title
- **Flexible Selection Syntax**:
  - `all` or `*`: Select all findings.
  - `none`: Deselect all findings.
  - Comma-separated indices: `1, 3, 5`
  - Ranges: `1-3`
  - Exclusions: `all, -2` or `1-4, !2`
  - Severity filters: `p0, p1`, `min:p2` / `>=p2`
  - Stylistic filters: `no-nits`
  - `q` or `cancel`: Abort review publishing cleanly without changes.
- **Direct CLI Overrides**:
  - `--all`: Publish all findings immediately without prompting.
  - `--interactive`: Explicitly force interactive finding selection prompt.
  - `--select="<spec>"`: Batch-select findings matching specification (e.g. `--select="p0,p1"`).

### 2. In-Session Caching & Publish-Later (`--publish-cached`)
- Every review pass automatically caches evaluated findings keyed by PR number and head commit SHA (defaults to `.gem-pr-cache/` in project root).
- Reviewers can inspect findings locally during a dry-run and publish them later without rerunning subagent model inference:
  ```bash
  # Step 1: Run analysis and inspect findings
  node scripts/dogfood-review.mjs 123 --dry-run

  # Step 2: Publish cached findings later
  node scripts/dogfood-review.mjs 123 --publish-cached
  ```
- **MCP Tool `gem_pr_review_publish_cached`**:
  Agents can publish cached findings programmatically using the MCP server tool:
  ```json
  {
    "prNumber": 123,
    "expectedHeadSha": "abcdef1234567890",
    "selectedIndices": [0, 2]
  }
  ```

### 3. Head Freshness & Stale Check Invalidation
- Cached findings are strictly verified against the current PR head SHA on GitHub before publication.
- If the PR head commit has moved (new commits pushed), cached findings are flagged as stale and rejected/invalidated to prevent anchoring comments to obsolete code.

### 4. Preservation of Host-Gated Safety Guarantees
- All selected or cached findings remain subject to host-enforced diff hunk validation (`isLineCommentable`).
- Unanchored findings are safely demoted to the review summary body; comments remain strictly capped at 50; and author safety checks are enforced.

---

## Automatic Fallback Model Retry on Quota/Capacity Errors (Zero Timeouts)

`gem-pr-review` provides automated failover resilience against API rate limits and model capacity constraints:

### 1. Quota & Capacity Error Classification
When executing review passes across specialist subagents, errors are classified in real time:
- **HTTP 429 & Rate Limits**: Status 429, `RATE_LIMIT_EXCEEDED`, TPM/RPM limits.
- **Capacity & Quota Exhaustion**: `RESOURCE_EXHAUSTED`, `INSUFFICIENT_QUOTA`, server capacity limits, model overload errors.
- **Fail-Fast on Bugs**: Unrelated errors (syntax errors, type errors, invalid credentials) fail immediately without retrying to preserve debugging clarity.

### 2. Automatic Failover Retry
- When a specialist lens fails due to quota or capacity limits, the orchestrator automatically retries that lens against the next model configured in the fallback tier (e.g. `heavy_fallbacks`, `medium_fallbacks`, or per-lens fallbacks).
- **Zero Loss of Sibling Passes**: Completed passes by sibling subagents running in parallel are fully preserved and never dropped or re-evaluated.

### 3. Zero Timeouts
- Review subagents execute without artificial plugin-imposed execution deadlines, timers, or stuck-reviewer heuristics.

---

## One-Shot Coding-Task Self-Review (`gem_self_review`)

`gem-pr-review` provides a fail-closed self-review tool for coding agents to inspect local uncommitted working tree changes before finalizing tasks or creating commits, ensuring defects are caught and corrected early without requiring a published GitHub pull request.

### 1. Local Git Worktree Diff Acquisition
- Inspects uncommitted changes across the local repository without remote PR or GitHub API dependencies:
  - **Staged changes**: `git diff --cached`
  - **Unstaged changes**: `git diff`
  - **Untracked files**: Automatically discovered via `git status --porcelain` and converted into synthetic unified diffs with valid hunk headers.
  - **Combined scope**: `git diff HEAD` combined with untracked synthetic diffs (default `scope: "all"`).
- Handles clean working trees gracefully: returns immediate `status: "passed"` with zero defects when no uncommitted changes exist.

### 2. Local Multi-Lens Analysis
- Dispatches specialist review lenses (e.g. Correctness, Contracts, Security, Performance, Conventions) locally using Copilot SDK or configured model tiers.
- Supports all standard modes: `--quick` (3 lenses), `--balanced` (5 lenses), `--full` (6 lenses), and `--deep` (focused correctness).
- Reuses existing prompt builders, structured Markdown findings envelopes, and deduplication logic without network mutations.

### 3. Fail-Closed Safety Gate
- Returns an explicit status and verdict:
  - `status: "passed"` (`verdict: "PASS"`) when zero blocking issues are found.
  - `status: "failed"` (`verdict: "FAIL"`) when blocking issues (`P0` or `P1`) are detected.
- **Configurable Threshold (`failOn`)**: Defaults to `P1`, blocking on any `P0` or `P1` defect. Can be configured to `P0`, `P2`, etc.
- **Actionable Remediation**: Formats concrete remediation steps for each blocking defect so coding agents can immediately self-correct before committing.

### 4. MCP Tool Reference (`gem_self_review`)
Agents can invoke self-review via MCP:
- **Tool**: `gem_self_review` (or alias `gem_pr_review_self`)
- **Arguments**:
  - `scope` *(string)*: `"all"` (default), `"staged"`, `"unstaged"`, or `"head"`.
  - `mode` *(string)*: `"balanced"` (default), `"quick"`, `"full"`, or `"deep"`.
  - `includeUntracked` *(boolean)*: Include new untracked files (default: `true`).
  - `failOn` *(string)*: Severity threshold to trigger failure (`"P0"`, `"P1"`, `"P2"`, default: `"P1"`).
  - `diffText` *(string, optional)*: Direct unified diff text override.
  - `customInstructions` *(string, optional)*: Additional review guidance.

### 5. CLI Execution
- **Dedicated Self-Review Runner**:
  ```bash
  # Review all uncommitted changes
  npm run self-review

  # Fast triage on staged changes only
  node scripts/self-review.mjs --staged --quick

  # Machine-readable JSON output
  node scripts/self-review.mjs --json
  ```
- **Dogfood Review Runner Integration**:
  ```bash
  node scripts/dogfood-review.mjs --self --quick
  ```
- **Exit Code**: Returns `0` on `status: "passed"` and `1` on `status: "failed"`, suitable for pre-commit git hooks and agent loop guardrails.




