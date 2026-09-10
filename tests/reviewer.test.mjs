import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_MODES,
  LENS_DEFINITIONS,
  resolveReviewMode,
  buildReviewerPrompt,
  deduplicateFindings,
  runReview,
} from '../src/reviewer.js';

describe('Reviewer Core & Orchestration', () => {
  describe('Mode and Lens Definitions', () => {
    it('defines standard review modes: balanced, quick, full, deep', () => {
      assert.ok(REVIEW_MODES.balanced, 'Should define balanced mode');
      assert.ok(REVIEW_MODES.quick, 'Should define quick mode');
      assert.ok(REVIEW_MODES.full, 'Should define full mode');
      assert.ok(REVIEW_MODES.deep, 'Should define deep mode');

      assert.deepEqual(REVIEW_MODES.quick.lenses, ['correctness', 'security', 'conventions']);
      assert.equal(REVIEW_MODES.balanced.lenses.length, 5);
      assert.equal(REVIEW_MODES.full.lenses.length, 6);
      assert.deepEqual(REVIEW_MODES.deep.lenses, ['correctness']);
    });

    it('defines specialist lenses with guidance', () => {
      const requiredLenses = ['correctness', 'contracts', 'security', 'performance', 'conventions', 'tests'];
      for (const lensId of requiredLenses) {
        const lens = LENS_DEFINITIONS[lensId];
        assert.ok(lens, `Lens ${lensId} should be defined`);
        assert.ok(lens.name, `Lens ${lensId} should have a human-readable name`);
        assert.ok(lens.instructions, `Lens ${lensId} should have instructions`);
      }
    });

    it('resolveReviewMode resolves names, flags, and fallbacks', () => {
      assert.equal(resolveReviewMode().name, 'balanced');
      assert.equal(resolveReviewMode('quick').name, 'quick');
      assert.equal(resolveReviewMode('--quick').name, 'quick');
      assert.equal(resolveReviewMode('--full').name, 'full');
      assert.equal(resolveReviewMode('--deep').name, 'deep');
      assert.equal(resolveReviewMode('non-existent').name, 'balanced');
    });
  });

  describe('buildReviewerPrompt', () => {
    it('builds comprehensive lens prompt with diff and instructions', () => {
      const prompt = buildReviewerPrompt({
        lens: 'security',
        diffText: 'diff --git a/app.js b/app.js\n+const token = "123";',
        prMetadata: { number: 42, title: 'Add auth token' },
      });

      assert.match(prompt, /security/i);
      assert.match(prompt, /PR #42/);
      assert.match(prompt, /Add auth token/);
      assert.match(prompt, /const token = "123"/);
      assert.match(prompt, /<<<PR_REVIEW_JSON>>>/);
    });

    it('includes custom instructions if provided', () => {
      const prompt = buildReviewerPrompt({
        lens: 'correctness',
        diffText: 'diff --git a/index.js b/index.js\n+console.log(1);',
        customInstructions: 'Strictly inspect for TypeScript-safe patterns.',
      });

      assert.match(prompt, /Strictly inspect for TypeScript-safe patterns/);
    });

    it('inlines full unified diff when diff is <= 200 KB (backward compatibility)', () => {
      const normalDiff = 'diff --git a/file.js b/file.js\n+console.log("hello");';
      const prompt = buildReviewerPrompt({
        lens: 'correctness',
        diffText: normalDiff,
      });

      assert.match(prompt, /## Unified Diff to Inspect:/);
      assert.match(prompt, /console\.log\("hello"\);/);
      assert.doesNotMatch(prompt, /Large Diff Transport Notice/i);
    });

    it('uses file-backed manifest notice when diffTransport is large (> 200 KB)', () => {
      const fakeTransport = {
        isLarge: true,
        byteSize: 350 * 1024,
        diffFilePath: '/tmp/pr-review-diff-12345/diff.patch',
        formattedManifest: '| modified | `src/big.js` | +500 / -200 | 350 KB | 5 |',
      };

      const prompt = buildReviewerPrompt({
        lens: 'correctness',
        diffText: '',
        diffTransport: fakeTransport,
      });

      assert.match(prompt, /Large Diff Transport Notice/i);
      assert.match(prompt, /350\.0 KB/);
      assert.match(prompt, /diff\.patch/);
      assert.match(prompt, /src\/big\.js/);
      assert.match(prompt, /read.*grep.*find/i);
      assert.doesNotMatch(prompt, /## Unified Diff to Inspect:/);
    });

    it('automatically activates file-backed manifest notice when raw diff exceeds 200 KB', () => {
      const largeDiff = 'diff --git a/huge.js b/huge.js\n' + '+line\n'.repeat(40000);
      const prompt = buildReviewerPrompt({
        lens: 'correctness',
        diffText: largeDiff,
      });

      assert.match(prompt, /Large Diff Transport Notice/i);
      assert.match(prompt, /huge\.js/);
      assert.doesNotMatch(prompt, /## Unified Diff to Inspect:/);
    });
  });

  describe('deduplicateFindings', () => {
    it('returns empty array when input is empty', () => {
      assert.deepEqual(deduplicateFindings([]), []);
    });

    it('preserves distinct findings across files and lines', () => {
      const findings = [
        { file: 'src/a.js', line: 10, severity: 'P1', title: 'Issue 1', side: 'RIGHT' },
        { file: 'src/b.js', line: 20, severity: 'P2', title: 'Issue 2', side: 'RIGHT' },
      ];
      assert.equal(deduplicateFindings(findings).length, 2);
    });

    it('merges duplicate findings on same file and line, selecting higher severity', () => {
      const findings = [
        { file: 'src/a.js', line: 10, severity: 'P2', title: 'Potential null dereference', side: 'RIGHT', confidence: 0.8 },
        { file: 'src/a.js', line: 10, severity: 'P0', title: 'Null crash on startup', side: 'RIGHT', confidence: 0.95 },
      ];
      const result = deduplicateFindings(findings);
      assert.equal(result.length, 1);
      assert.equal(result[0].severity, 'P0');
      assert.equal(result[0].confidence, 0.95);
    });
  });

  describe('runReview Orchestration', () => {
    const sampleDiff = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,6 +10,7 @@ function start() {
   init();
+  dangerousEval(input);
   return true;
 }
`;

    it('executes multi-lens review dry-run with mock runner', async () => {
      const executedLenses = [];
      const mockRunner = async ({ lens }) => {
        executedLenses.push(lens.id);
        if (lens.id === 'security') {
          return `
### [P0] Critical code injection via eval
- **File**: \`src/app.js:12\`
- **Side**: RIGHT
- **Confidence**: 0.95

Direct execution of user input with eval.
`;
        }
        return 'No defects identified.';
      };

      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'abcdef1234567890abcdef1234567890abcdef12',
            author: { login: 'contributor' },
            title: 'Add start routine',
          });
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'reviewer-bot' });
        }
        return '';
      };

      const result = await runReview({
        prNumber: 5,
        mode: 'quick',
        diffText: sampleDiff,
        runnerFn: mockRunner,
        execGhFn: mockExecGh,
        dryRun: true,
      });

      assert.equal(result.prNumber, 5);
      assert.equal(result.mode, 'quick');
      assert.deepEqual(executedLenses, ['correctness', 'security', 'conventions']);
      assert.ok(Array.isArray(result.subagentPlan));
      assert.equal(result.subagentPlan.length, 3);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].severity, 'P0');
      assert.equal(result.findings[0].file, 'src/app.js');
      assert.equal(result.findings[0].line, 12);
      assert.equal(result.published, false, 'Should not publish when dryRun: true');
      assert.ok(result.summary.includes('PR Review Summary'));
    });

    it('publishes review atomically when dryRun is false', async () => {
      let publishedPayload = null;
      const mockRunner = async ({ lens }) => {
        if (lens.id === 'correctness') {
          return `
- **[P1]** \`src/app.js:12\` (confidence: 0.9): Potential syntax issue.
`;
        }
        return '';
      };

      const mockExecGh = async (args, options) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'abcdef1234567890abcdef1234567890abcdef12',
            author: { login: 'other-author' },
            title: 'Sample feature',
          });
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'reviewer-bot' });
        }
        if (args[0] === 'api' && args.includes('POST')) {
          publishedPayload = JSON.parse(options?.input || '{}');
          return JSON.stringify({ id: 999, state: 'COMMENTED' });
        }
        return '';
      };

      const result = await runReview({
        prNumber: 10,
        mode: 'deep',
        diffText: sampleDiff,
        runnerFn: mockRunner,
        execGhFn: mockExecGh,
        dryRun: false,
        publish: true,
      });

      assert.equal(result.published, true);
      assert.ok(publishedPayload, 'Review API payload should be sent');
      assert.equal(publishedPayload.event, 'COMMENT');
      assert.equal(publishedPayload.comments.length, 1);
      assert.equal(publishedPayload.comments[0].line, 12);
    });

    it('rejects with error when diff is empty', async () => {
      await assert.rejects(
        async () => {
          await runReview({
            prNumber: 1,
            diffText: '',
            runnerFn: async () => '',
            execGhFn: async () => '{}',
          });
        },
        /diff is empty/i
      );
    });

    it('handles incremental re-review when head is unchanged (same_head)', async () => {
      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'head123',
            author: { login: 'dev' },
            title: 'Feature',
          });
        }
        if (args[0] === 'api' && args[1].includes('/reviews')) {
          return JSON.stringify([
            {
              id: 11,
              commit_id: 'head123',
              state: 'COMMENTED',
              submitted_at: '2026-09-08T00:00:00Z',
              body: 'Prior review summary',
            },
          ]);
        }
        return '[]';
      };

      const result = await runReview({
        prNumber: 5,
        diffText: sampleDiff,
        incremental: true,
        execGhFn: mockExecGh,
        runnerFn: async () => '',
      });

      assert.equal(result.relationship, 'same_head');
      assert.ok(result.summary.includes('not changed'));
      assert.equal(result.published, false);
    });

    it('handles incremental re-review with new commits, revalidating prior findings', async () => {
      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'head222',
            author: { login: 'dev' },
            title: 'Feature v2',
          });
        }
        if (args[0] === 'api' && args[1].includes('/reviews')) {
          return JSON.stringify([
            {
              id: 11,
              commit_id: 'head111',
              state: 'COMMENTED',
              submitted_at: '2026-09-08T00:00:00Z',
              body: '### [P1] Missing check\n- **File**: `src/app.js:12`\n- **Side**: RIGHT\n',
            },
          ]);
        }
        return '[]';
      };

      const mockGit = async (args) => {
        if (args[0] === 'merge-base') return '';
        if (args[0] === 'diff') {
          return `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,4 +10,4 @@
-const old = 1;
+const old = 2;
`;
        }
        return '';
      };

      const mockRunner = async () => '';

      const result = await runReview({
        prNumber: 5,
        diffText: sampleDiff,
        incremental: true,
        execGhFn: mockExecGh,
        execGitFn: mockGit,
        runnerFn: mockRunner,
      });

      assert.equal(result.relationship, 'incremental');
      assert.ok(result.revalidation);
      assert.equal(result.revalidation.counts.resolved, 1);
      assert.ok(result.summary.includes('Prior Findings Revalidation'));
    });

    it('detects diff > 200 KB in runReview, activates file-backed transport and cleans up', async () => {
      const largeDiff = 'diff --git a/big.js b/big.js\n' + '+line\n'.repeat(40000);
      let capturedPrompt = '';
      let capturedTransport = null;

      const mockRunner = async ({ prompt, diffTransport }) => {
        capturedPrompt = prompt;
        capturedTransport = diffTransport;
        return `
### [P1] Performance bottleneck in big loop
- **File**: \`big.js:100\`
- **Side**: RIGHT
- **Confidence**: 0.9

Expensive computation inside hot path.
`;
      };

      const result = await runReview({
        prNumber: 42,
        diffText: largeDiff,
        runnerFn: mockRunner,
        dryRun: true,
      });

      assert.equal(result.prNumber, 42);
      assert.ok(result.diffTransport);
      assert.equal(result.diffTransport.isLarge, true);
      assert.ok(result.diffTransport.byteSize > 200 * 1024);

      // Verify runner received file-backed transport and formatted manifest prompt
      assert.ok(capturedTransport);
      assert.equal(capturedTransport.isLarge, true);
      assert.match(capturedPrompt, /Large Diff Transport Notice/i);
      assert.match(capturedPrompt, /big\.js/);
      assert.doesNotMatch(capturedPrompt, /## Unified Diff to Inspect:\n```diff/);

      // Verify findings were extracted properly
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].file, 'big.js');
      assert.equal(result.findings[0].severity, 'P1');

      // Summary includes notice of file-backed transport
      assert.match(result.summary, /file-backed transport/i);
    });
  });
});
