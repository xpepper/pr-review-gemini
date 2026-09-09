---
name: pr-review
description: Comprehensive parallel AI code review for GitHub pull requests using specialized lenses and host-gated publishing.
license: MIT
compatibility: Node.js >= 20.0.0, GitHub CLI (gh), Agent Plugins 1.0
metadata:
  version: "0.1.0"
allowed-tools: Bash, gh, git
---

# PR Review: Parallel Multi-Lens AI Code Review

## Purpose

`pr-review` provides automated, multi-lens code review for GitHub pull requests following the Agent Plugins 1.0 standard.
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
