import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommitRelationship,
  fetchPriorReviews,
  extractPriorFindings,
  revalidatePriorFindings,
  formatRevalidationSummary,
  getIncrementalDiff,
} from '../src/prior.js';

describe('Incremental Re-reviews & Prior Finding Discovery', () => {
  describe('classifyCommitRelationship', () => {
    it('returns "none" when no prior head SHA exists', async () => {
      const result = await classifyCommitRelationship({
        priorHeadSha: null,
        currentHeadSha: 'abc1234',
      });
      assert.deepEqual(result, {
        relationship: 'none',
        priorHeadSha: null,
        currentHeadSha: 'abc1234',
        canIncremental: false,
        reason: 'No prior review found on this pull request.',
      });
    });

    it('returns "same_head" when prior SHA matches current SHA', async () => {
      const result = await classifyCommitRelationship({
        priorHeadSha: 'abc1234',
        currentHeadSha: 'abc1234',
      });
      assert.deepEqual(result, {
        relationship: 'same_head',
        priorHeadSha: 'abc1234',
        currentHeadSha: 'abc1234',
        canIncremental: false,
        reason: 'PR head commit has not changed since the last review (abc1234).',
      });
    });

    it('returns "incremental" when current commit extends prior commit', async () => {
      const mockGit = async (args) => {
        if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
          return ''; // exit code 0 indicates ancestor
        }
        return '';
      };

      const result = await classifyCommitRelationship({
        priorHeadSha: 'aaa1111',
        currentHeadSha: 'bbb2222',
        execGitFn: mockGit,
      });

      assert.equal(result.relationship, 'incremental');
      assert.equal(result.priorHeadSha, 'aaa1111');
      assert.equal(result.currentHeadSha, 'bbb2222');
      assert.equal(result.canIncremental, true);
      assert.ok(result.reason.includes('extends'));
    });

    it('returns "diverged" when current commit does not contain prior commit', async () => {
      const mockGit = async (args) => {
        if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
          throw new Error('Not an ancestor (exit code 1)');
        }
        return '';
      };

      const result = await classifyCommitRelationship({
        priorHeadSha: 'aaa1111',
        currentHeadSha: 'ccc3333',
        execGitFn: mockGit,
      });

      assert.equal(result.relationship, 'diverged');
      assert.equal(result.priorHeadSha, 'aaa1111');
      assert.equal(result.currentHeadSha, 'ccc3333');
      assert.equal(result.canIncremental, false);
      assert.ok(result.reason.includes('rebased') || result.reason.includes('diverged'));
    });
  });

  describe('fetchPriorReviews & extractPriorFindings', () => {
    it('fetches reviews and review comments, extracting prior findings', async () => {
      const mockGh = async (args) => {
        const endpoint = args[1] || '';
        if (endpoint.includes('/reviews')) {
          return JSON.stringify([
            {
              id: 101,
              commit_id: 'commitaaa',
              state: 'COMMENTED',
              submitted_at: '2026-09-08T10:00:00Z',
              user: { login: 'copilot-reviewer' },
              body: '## PR Review Summary\n\n- **Total Findings**: 1\n\n### [P1] Missing null check\n- **File**: `src/auth.js:42`\n- **Side**: RIGHT\n\nNeed null check here.',
            },
          ]);
        }
        if (endpoint.includes('/comments')) {
          return JSON.stringify([
            {
              id: 201,
              pull_request_review_id: 101,
              path: 'src/api.js',
              line: 88,
              side: 'RIGHT',
              body: '**[P0] Unsanitized query parameter** (confidence: 0.95)\n\nSQL injection risk here.',
            },
          ]);
        }
        return '[]';
      };

      const priorData = await fetchPriorReviews({
        prNumber: 42,
        execGhFn: mockGh,
      });

      assert.ok(priorData);
      assert.equal(priorData.latestReview.id, 101);
      assert.equal(priorData.latestReview.commitId, 'commitaaa');
      assert.equal(priorData.findings.length, 2);

      const [finding1, finding2] = priorData.findings;
      assert.equal(finding1.filePath, 'src/auth.js');
      assert.equal(finding1.line, 42);
      assert.equal(finding1.severity, 'P1');

      assert.equal(finding2.filePath, 'src/api.js');
      assert.equal(finding2.line, 88);
      assert.equal(finding2.severity, 'P0');
    });

    it('returns null when PR has no prior reviews', async () => {
      const mockGh = async () => '[]';
      const priorData = await fetchPriorReviews({
        prNumber: 99,
        execGhFn: mockGh,
      });
      assert.equal(priorData, null);
    });
  });

  describe('revalidatePriorFindings', () => {
    const priorFindings = [
      {
        id: 'f1',
        title: 'Missing null check',
        filePath: 'src/auth.js',
        line: 42,
        severity: 'P1',
      },
      {
        id: 'f2',
        title: 'SQL injection risk',
        filePath: 'src/api.js',
        line: 88,
        severity: 'P0',
      },
      {
        id: 'f3',
        title: 'Dead code in legacy helper',
        filePath: 'src/legacy.js',
        line: 15,
        severity: 'P3',
      },
    ];

    const incrementalDiff = `diff --git a/src/auth.js b/src/auth.js
index 1111111..2222222 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -40,5 +40,6 @@ function authenticate(user) {
-  const id = user.id;
+  const id = user?.id ?? null;
   return id;
 }
diff --git a/src/legacy.js b/src/legacy.js
deleted file mode 100644
index 3333333..0000000 
--- a/src/legacy.js
+++ /dev/null
@@ -1,20 +0,0 @@
-function legacyHelper() {}
`;

    it('revalidates findings against incremental diff hunks', () => {
      const result = revalidatePriorFindings({
        priorFindings,
        incrementalDiffText: incrementalDiff,
      });

      assert.equal(result.findings.length, 3);
      assert.equal(result.counts.resolved, 1);
      assert.equal(result.counts.obsolete, 1);
      assert.equal(result.counts.stillOpen, 1);

      const f1 = result.findings.find((f) => f.filePath === 'src/auth.js');
      assert.equal(f1.status, 'resolved');
      assert.ok(f1.statusReason.includes('Modified'));

      const f2 = result.findings.find((f) => f.filePath === 'src/api.js');
      assert.equal(f2.status, 'still open');
      assert.ok(f2.statusReason.includes('Unchanged'));

      const f3 = result.findings.find((f) => f.filePath === 'src/legacy.js');
      assert.equal(f3.status, 'obsolete');
      assert.ok(f3.statusReason.includes('deleted'));
    });
  });

  describe('formatRevalidationSummary', () => {
    it('produces structured markdown report of revalidated findings', () => {
      const revalidation = {
        findings: [
          {
            filePath: 'src/auth.js',
            line: 42,
            severity: 'P1',
            title: 'Missing null check',
            status: 'resolved',
            statusReason: 'Modified in incremental diff',
          },
          {
            filePath: 'src/api.js',
            line: 88,
            severity: 'P0',
            title: 'SQL injection risk',
            status: 'still open',
            statusReason: 'Unchanged in incremental diff',
          },
        ],
        counts: { resolved: 1, stillOpen: 1, obsolete: 0 },
      };

      const markdown = formatRevalidationSummary(revalidation);
      assert.ok(markdown.includes('### Prior Findings Revalidation (Incremental Re-Review)'));
      assert.ok(markdown.includes('- **Resolved**: 1'));
      assert.ok(markdown.includes('- **Still Open**: 1'));
      assert.ok(markdown.includes('[x] **[P1]** `src/auth.js:42`: Missing null check'));
      assert.ok(markdown.includes('[ ] **[P0]** `src/api.js:88`: SQL injection risk'));
    });
  });

  describe('getIncrementalDiff', () => {
    it('executes git diff to fetch commits between prior and current head', async () => {
      const mockGit = async (args) => {
        if (args[0] === 'diff' && args[1] === 'aaa1111..bbb2222') {
          return 'diff --git a/a.js b/a.js\n...';
        }
        return '';
      };

      const diff = await getIncrementalDiff({
        priorHeadSha: 'aaa1111',
        currentHeadSha: 'bbb2222',
        execGitFn: mockGit,
      });

      assert.ok(diff.includes('diff --git'));
    });

    it('falls back to gh compare API if git diff is unavailable or fails', async () => {
      const mockGit = async () => {
        throw new Error('git not found');
      };
      const mockGh = async (args) => {
        if (args[0] === 'api' && args[1].includes('/compare/')) {
          return JSON.stringify({
            files: [
              {
                filename: 'src/diff.js',
                patch: '@@ -1,2 +1,3 @@\n+const x = 1;',
              },
            ],
          });
        }
        return '{}';
      };

      const diff = await getIncrementalDiff({
        priorHeadSha: 'aaa1111',
        currentHeadSha: 'bbb2222',
        repo: 'xpepper/pr-review-gemini',
        execGitFn: mockGit,
        execGhFn: mockGh,
      });

      assert.ok(diff.includes('diff --git a/src/diff.js b/src/diff.js'));
    });
  });
});
