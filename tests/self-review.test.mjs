import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSyntheticDiff,
  getWorktreeDiff,
  parseUnifiedDiff,
  isLineInHunk,
  isLineCommentable,
} from '../src/diff.js';
import {
  evaluateSelfReviewVerdict,
  formatSelfReviewSummary,
  runSelfReview,
} from '../src/self-review.js';

describe('One-Shot Self-Review (Increment 11)', () => {
  // --------------------------------------------------------------------------
  // 1. Synthetic Diff Generation
  // --------------------------------------------------------------------------
  describe('generateSyntheticDiff', () => {
    it('generates a valid unified diff for an empty file', () => {
      const diff = generateSyntheticDiff('empty.txt', '');
      assert.ok(diff.includes('diff --git a/empty.txt b/empty.txt'));
      assert.ok(diff.includes('new file mode 100644'));
      assert.ok(diff.includes('--- /dev/null'));
      assert.ok(diff.includes('+++ b/empty.txt'));
      assert.ok(!diff.includes('@@'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].path, 'empty.txt');
      assert.equal(parsed[0].status, 'added');
      assert.equal(parsed[0].hunks.length, 0);
    });

    it('generates a valid unified diff for a single-line text file with trailing newline', () => {
      const diff = generateSyntheticDiff('src/hello.js', 'console.log("hello");\n');
      assert.ok(diff.includes('diff --git a/src/hello.js b/src/hello.js'));
      assert.ok(diff.includes('new file mode 100644'));
      assert.ok(diff.includes('--- /dev/null'));
      assert.ok(diff.includes('+++ b/src/hello.js'));
      assert.ok(diff.includes('@@ -0,0 +1,1 @@'));
      assert.ok(diff.includes('+console.log("hello");'));
      assert.ok(!diff.includes('\\ No newline at end of file'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].path, 'src/hello.js');
      assert.equal(parsed[0].status, 'added');
      assert.equal(parsed[0].hunks.length, 1);
      assert.equal(parsed[0].hunks[0].newLines, 1);
      assert.equal(isLineInHunk(parsed[0], 1), true);
      assert.equal(isLineCommentable(parsed[0], 1), true);
    });

    it('generates a valid unified diff for a multi-line text file', () => {
      const content = 'const a = 1;\nconst b = 2;\nexport default a + b;\n';
      const diff = generateSyntheticDiff('src/math.js', content);
      assert.ok(diff.includes('@@ -0,0 +1,3 @@'));
      assert.ok(diff.includes('+const a = 1;'));
      assert.ok(diff.includes('+const b = 2;'));
      assert.ok(diff.includes('+export default a + b;'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].hunks[0].newLines, 3);
      assert.equal(isLineInHunk(parsed[0], 2), true);
      assert.equal(isLineInHunk(parsed[0], 3), true);
    });

    it('handles files without trailing newline by appending git marker', () => {
      const content = 'const noNewline = true;';
      const diff = generateSyntheticDiff('src/flag.js', content);
      assert.ok(diff.includes('@@ -0,0 +1,1 @@'));
      assert.ok(diff.includes('+const noNewline = true;'));
      assert.ok(diff.includes('\\ No newline at end of file'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].hunks.length, 1);
    });

    it('generates binary diff marker for binary content or null bytes', () => {
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]);
      const diff = generateSyntheticDiff('images/logo.png', binaryContent);
      assert.ok(diff.includes('diff --git a/images/logo.png b/images/logo.png'));
      assert.ok(diff.includes('new file mode 100644'));
      assert.ok(diff.includes('Binary files /dev/null and b/images/logo.png differ'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].isBinary, true);
      assert.equal(isLineCommentable(parsed[0], 1), false);
    });

    it('normalizes paths with leading ./ and Windows backslashes', () => {
      const diff = generateSyntheticDiff('.\\src\\sub\\mod.js', 'export const x = 10;\n');
      assert.ok(diff.includes('diff --git a/src/sub/mod.js b/src/sub/mod.js'));
      assert.ok(diff.includes('+++ b/src/sub/mod.js'));
    });
  });

  // --------------------------------------------------------------------------
  // 2. Local Diff Acquisition (getWorktreeDiff)
  // --------------------------------------------------------------------------
  describe('getWorktreeDiff', () => {
    it('returns empty string when working tree is completely clean', async () => {
      const execGitFn = async (args) => {
        if (args[0] === 'diff') return '';
        if (args[0] === 'status') return '';
        return '';
      };

      const diff = await getWorktreeDiff({ execGitFn });
      assert.equal(diff, '');
    });

    it('acquires unstaged changes when scope is unstaged', async () => {
      const mockUnstaged = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 function app() {
+  console.log("unstaged");
   return 0;
 }
`;
      const execGitFn = async (args) => {
        if (args[0] === 'diff') {
          assert.deepEqual(args, ['diff']);
          return mockUnstaged;
        }
        if (args[0] === 'status') return '';
        return '';
      };

      const diff = await getWorktreeDiff({ scope: 'unstaged', execGitFn, includeUntracked: false });
      assert.equal(diff, mockUnstaged);
    });

    it('acquires staged changes when scope is staged and excludes untracked by default', async () => {
      const mockStaged = `diff --git a/src/index.js b/src/index.js
index 3333333..4444444 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
`;
      const execGitFn = async (args) => {
        if (args[0] === 'diff' && args[1] === '--cached') {
          return mockStaged;
        }
        if (args[0] === 'status') {
          return '?? untracked.js\n';
        }
        return '';
      };

      const diff = await getWorktreeDiff({ scope: 'staged', execGitFn });
      assert.equal(diff, mockStaged);
      assert.ok(!diff.includes('untracked.js'));
    });

    it('acquires untracked files via git status --porcelain and converts them to synthetic diffs', async () => {
      const execGitFn = async (args) => {
        if (args[0] === 'diff') return '';
        if (args[0] === 'status') {
          return '?? new-feature.js\n?? "spaced name.js"\n';
        }
        return '';
      };

      const mockFs = {
        existsSync: () => true,
        statSync: () => ({ isFile: () => true, size: 30 }),
        readFileSync: (p) => {
          if (p.includes('new-feature.js')) return 'export const feature = true;\n';
          if (p.includes('spaced name.js')) return 'const spaced = true;\n';
          return '';
        },
      };

      const diff = await getWorktreeDiff({
        scope: 'all',
        execGitFn,
        fsModule: mockFs,
      });

      assert.ok(diff.includes('diff --git a/new-feature.js b/new-feature.js'));
      assert.ok(diff.includes('+export const feature = true;'));
      assert.ok(diff.includes('diff --git a/spaced name.js b/spaced name.js'));
      assert.ok(diff.includes('+const spaced = true;'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].path, 'new-feature.js');
      assert.equal(parsed[1].path, 'spaced name.js');
    });

    it('combines tracked worktree diff (git diff HEAD) with untracked synthetic diffs', async () => {
      const mockTracked = `diff --git a/src/core.js b/src/core.js
index aaaaaaa..bbbbbbb 100644
--- a/src/core.js
+++ b/src/core.js
@@ -5,3 +5,4 @@ export function run() {
+  validate();
   return true;
 }
`;
      const execGitFn = async (args) => {
        if (args[0] === 'diff' && args[1] === 'HEAD') {
          return mockTracked;
        }
        if (args[0] === 'status') {
          return '?? untracked.js\n';
        }
        return '';
      };

      const mockFs = {
        existsSync: () => true,
        statSync: () => ({ isFile: () => true, size: 20 }),
        readFileSync: () => 'const untracked = 1;\n',
      };

      const diff = await getWorktreeDiff({
        scope: 'all',
        execGitFn,
        fsModule: mockFs,
      });

      assert.ok(diff.includes('diff --git a/src/core.js b/src/core.js'));
      assert.ok(diff.includes('+  validate();'));
      assert.ok(diff.includes('diff --git a/untracked.js b/untracked.js'));
      assert.ok(diff.includes('+const untracked = 1;'));

      const parsed = parseUnifiedDiff(diff);
      assert.equal(parsed.length, 2);
    });

    it('falls back to git diff --cached + git diff when git diff HEAD fails (e.g. unborn branch)', async () => {
      const execGitFn = async (args) => {
        if (args[0] === 'diff' && args[1] === 'HEAD') {
          throw new Error('fatal: ambiguous argument "HEAD": unknown revision');
        }
        if (args[0] === 'diff' && args[1] === '--cached') {
          return 'diff --git a/staged.js b/staged.js\nnew file mode 100644\n--- /dev/null\n+++ b/staged.js\n@@ -0,0 +1,1 @@\n+const staged = 1;\n';
        }
        if (args[0] === 'diff' && args.length === 1) {
          return 'diff --git a/modified.js b/modified.js\n--- a/modified.js\n+++ b/modified.js\n@@ -1,1 +1,2 @@\n+const mod = 2;\n';
        }
        if (args[0] === 'status') return '';
        return '';
      };

      const diff = await getWorktreeDiff({
        scope: 'all',
        execGitFn,
        includeUntracked: false,
      });

      assert.ok(diff.includes('staged.js'));
      assert.ok(diff.includes('modified.js'));
    });

    it('rejects with descriptive error when git execution fails with real error', async () => {
      const execGitFn = async () => {
        throw new Error('fatal: not a git repository');
      };

      await assert.rejects(
        () => getWorktreeDiff({ execGitFn }),
        /Failed to acquire worktree diff: fatal: not a git repository/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Fail-Closed Safety Gate & Verdict Evaluation
  // --------------------------------------------------------------------------
  describe('evaluateSelfReviewVerdict', () => {
    it('returns passed when there are zero findings', () => {
      const verdict = evaluateSelfReviewVerdict([]);
      assert.equal(verdict.status, 'passed');
      assert.equal(verdict.verdict, 'PASS');
      assert.equal(verdict.blockingCount, 0);
      assert.deepEqual(verdict.blockingFindings, []);
      assert.deepEqual(verdict.counts, { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 });
    });

    it('returns passed when findings only contain advisory P2, P3, and nit severities', () => {
      const findings = [
        { severity: 'P2', title: 'Edge case check', file: 'src/a.js', line: 10, commentary: 'Fix edge case' },
        { severity: 'P3', title: 'Variable naming', file: 'src/b.js', line: 20, commentary: 'Rename var' },
        { severity: 'nit', title: 'Spacing', file: 'src/c.js', line: 30, commentary: 'Remove space' },
      ];

      const verdict = evaluateSelfReviewVerdict(findings);
      assert.equal(verdict.status, 'passed');
      assert.equal(verdict.verdict, 'PASS');
      assert.equal(verdict.blockingCount, 0);
      assert.equal(verdict.counts.P2, 1);
      assert.equal(verdict.counts.P3, 1);
      assert.equal(verdict.counts.nit, 1);
    });

    it('fails closed when a P1 finding is detected', () => {
      const findings = [
        { severity: 'P1', title: 'Potential unhandled rejection', file: 'src/async.js', line: 42, commentary: 'Add await' },
        { severity: 'P2', title: 'Minor perf improvement', file: 'src/perf.js', line: 15, commentary: 'Cache result' },
      ];

      const verdict = evaluateSelfReviewVerdict(findings);
      assert.equal(verdict.status, 'failed');
      assert.equal(verdict.verdict, 'FAIL');
      assert.equal(verdict.blockingCount, 1);
      assert.equal(verdict.blockingFindings.length, 1);
      assert.equal(verdict.blockingFindings[0].title, 'Potential unhandled rejection');
      assert.equal(verdict.remediation.length, 1);
      assert.equal(verdict.remediation[0].file, 'src/async.js');
    });

    it('fails closed when a P0 critical blocker is detected', () => {
      const findings = [
        { severity: 'P0', title: 'Remote code execution in eval', file: 'src/exec.js', line: 12, commentary: 'Do not use eval' },
      ];

      const verdict = evaluateSelfReviewVerdict(findings);
      assert.equal(verdict.status, 'failed');
      assert.equal(verdict.verdict, 'FAIL');
      assert.equal(verdict.blockingCount, 1);
      assert.equal(verdict.blockingFindings[0].severity, 'P0');
    });

    it('supports custom failOn threshold (e.g. failOn: "P2" flags P2 as blocking)', () => {
      const findings = [
        { severity: 'P2', title: 'Non-optimal loop', file: 'src/loop.js', line: 8, commentary: 'Use map' },
      ];

      const verdict = evaluateSelfReviewVerdict(findings, { failOn: 'P2' });
      assert.equal(verdict.status, 'failed');
      assert.equal(verdict.verdict, 'FAIL');
      assert.equal(verdict.blockingCount, 1);
    });

    it('supports custom failOn: "P0" (allows P1 to pass without failing)', () => {
      const findings = [
        { severity: 'P1', title: 'Inconsistent data type', file: 'src/data.js', line: 19, commentary: 'Cast to number' },
      ];

      const verdict = evaluateSelfReviewVerdict(findings, { failOn: 'P0' });
      assert.equal(verdict.status, 'passed');
      assert.equal(verdict.verdict, 'PASS');
      assert.equal(verdict.blockingCount, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Summary Formatting
  // --------------------------------------------------------------------------
  describe('formatSelfReviewSummary', () => {
    it('formats a clean report when working tree has no uncommitted changes', () => {
      const summary = formatSelfReviewSummary({
        verdict: 'PASS',
        status: 'passed',
        findings: [],
        counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
        mode: 'balanced',
        emptyDiff: true,
      });

      assert.ok(summary.includes('SELF-REVIEW PASSED (PASS)'));
      assert.ok(summary.includes('No uncommitted changes detected'));
    });

    it('formats a passing report with zero defects and listed lenses', () => {
      const summary = formatSelfReviewSummary({
        verdict: 'PASS',
        status: 'passed',
        findings: [],
        counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
        mode: 'balanced',
        diffStats: { totalFiles: 2, totalAdditions: 20, totalDeletions: 5, totalBytes: 500, isLarge: false },
        lenses: ['correctness', 'security', 'contracts'],
      });

      assert.ok(summary.includes('SELF-REVIEW PASSED (PASS)'));
      assert.ok(summary.includes('No defects detected'));
      assert.ok(summary.includes('2 files (+20 / -5)'));
      assert.ok(summary.includes('correctness'));
      assert.ok(summary.includes('security'));
    });

    it('formats a failing report with blocking issues and actionable remediation guidance', () => {
      const blockingFindings = [
        {
          severity: 'P1',
          title: 'Unchecked array index access',
          file: 'src/slice.js',
          line: 25,
          side: 'RIGHT',
          commentary: 'Ensure length check before indexing array.',
        },
      ];

      const summary = formatSelfReviewSummary({
        verdict: 'FAIL',
        status: 'failed',
        findings: blockingFindings,
        blockingFindings,
        counts: { P0: 0, P1: 1, P2: 0, P3: 0, nit: 0 },
        mode: 'balanced',
        diffStats: { totalFiles: 1, totalAdditions: 10, totalDeletions: 2, totalBytes: 250, isLarge: false },
        remediation: [
          {
            title: 'Unchecked array index access',
            severity: 'P1',
            file: 'src/slice.js',
            line: 25,
            remediation: 'Ensure length check before indexing array.',
          },
        ],
      });

      assert.ok(summary.includes('SELF-REVIEW FAILED (FAIL)'));
      assert.ok(summary.includes('1 blocking issue detected'));
      assert.ok(summary.includes('Unchecked array index access'));
      assert.ok(summary.includes('Ensure length check before indexing array.'));
      assert.ok(summary.includes('Action Required'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Orchestrator (runSelfReview)
  // --------------------------------------------------------------------------
  describe('runSelfReview', () => {
    it('returns passed cleanly on clean worktree without running subagents', async () => {
      let runnerCalled = false;
      const runnerFn = async () => {
        runnerCalled = true;
        return { output: '[]' };
      };

      const result = await runSelfReview({
        diffText: '',
        runnerFn,
      });

      assert.equal(result.status, 'passed');
      assert.equal(result.verdict, 'PASS');
      assert.equal(result.blockingCount, 0);
      assert.equal(runnerCalled, false);
      assert.deepEqual(result.findings, []);
    });

    it('orchestrates multi-lens review and fails closed when blocking issues are returned', async () => {
      const diffText = `diff --git a/src/app.js b/src/app.js
new file mode 100644
--- /dev/null
+++ b/src/app.js
@@ -0,0 +1,5 @@
+function app(input) {
+  eval(input);
+  return input;
+}
`;

      const runnerFn = async ({ lens }) => {
        if (lens.id === 'security') {
          return {
            output: `<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Use of dangerous eval with untrusted input",
    "severity": "P0",
    "file": "src/app.js",
    "line": 2,
    "side": "RIGHT",
    "confidence": 0.95,
    "body": "Avoid eval() due to arbitrary code execution risks."
  }
]
<<<END_PR_REVIEW_JSON>>>`,
          };
        }
        return { output: '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>' };
      };

      const result = await runSelfReview({
        diffText,
        mode: 'quick',
        runnerFn,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.blockingCount, 1);
      assert.equal(result.counts.P0, 1);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].title, 'Use of dangerous eval with untrusted input');
      assert.ok(result.summary.includes('SELF-REVIEW FAILED (FAIL)'));
      assert.equal(result.remediation.length, 1);
    });

    it('passes when multi-lens review only produces non-blocking P2 or nit findings', async () => {
      const diffText = `diff --git a/src/calc.js b/src/calc.js
new file mode 100644
--- /dev/null
+++ b/src/calc.js
@@ -0,0 +1,3 @@
+export function add(a, b) {
+  return a + b;
+}
`;

      const runnerFn = async () => {
        return {
          output: `<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Add parameter type check for robustness",
    "severity": "P2",
    "file": "src/calc.js",
    "line": 1,
    "side": "RIGHT",
    "confidence": 0.8,
    "body": "Consider validating that a and b are numbers."
  }
]
<<<END_PR_REVIEW_JSON>>>`,
        };
      };

      const result = await runSelfReview({
        diffText,
        mode: 'quick',
        runnerFn,
      });

      assert.equal(result.status, 'passed');
      assert.equal(result.verdict, 'PASS');
      assert.equal(result.blockingCount, 0);
      assert.equal(result.counts.P2, 1);
      assert.equal(result.findings.length, 1);
      assert.ok(result.summary.includes('SELF-REVIEW PASSED (PASS)'));
    });

    it('fails closed if all specialist subagent lenses fail to run', async () => {
      const diffText = `diff --git a/src/index.js b/src/index.js
new file mode 100644
--- /dev/null
+++ b/src/index.js
@@ -0,0 +1,2 @@
+console.log(1);
`;

      const runnerFn = async () => {
        throw new Error('LLM connection failed');
      };

      const result = await runSelfReview({
        diffText,
        mode: 'quick',
        runnerFn,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.verdict, 'FAIL');
      assert.ok(result.summary.includes('Execution Error') || result.summary.includes('FAILED'));
    });

    it('recovers findings from degraded/malformed JSON envelope in self-review and fails closed on blocking defect', async () => {
      const diffText = `diff --git a/src/auth.js b/src/auth.js
new file mode 100644
--- /dev/null
+++ b/src/auth.js
@@ -0,0 +1,5 @@
+export function login(user) {
+  return user.admin === true;
+}
+`;

      // Simulates truncated JSON envelope with trailing comma from local LLM pass
      const runnerFn = async () => ({
        output: `
<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Insecure authorization bypass",
    "severity": "P1",
    "file": "src/auth.js",
    "line": 2,
    "confidence": 0.9,
    "body": "Does not verify password or token before checking admin flag.",
  },
`,
      });

      const result = await runSelfReview({
        diffText,
        mode: 'quick',
        runnerFn,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.blockingCount, 1);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].title, 'Insecure authorization bypass');
      assert.equal(result.findings[0].severity, 'P1');
      assert.equal(result.findings[0].filePath, 'src/auth.js');
    });
  });
});
