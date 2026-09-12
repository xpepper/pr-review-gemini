import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommitRelationship,
  fetchPriorReviews,
  extractPriorFindings,
  revalidatePriorFindings,
  formatRevalidationSummary,
  getIncrementalDiff,
  normalizeReviewThreads,
  fetchReviewThreads,
  evaluateReviewThread,
  evaluateReviewThreads,
  formatThreadResolutionSummary,
  resolveReviewThread,
  replyToReviewThread,
  resolveVerifiedThreads,
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

  describe('Review Threads & Automated Resolution (Increment 20)', () => {
    const sampleGraphqlThreads = [
      {
        id: 'PRRT_kw1',
        isResolved: false,
        isOutdated: false,
        path: 'src/auth.js',
        line: 42,
        originalLine: 40,
        diffSide: 'RIGHT',
        comments: {
          nodes: [
            {
              id: 'PRRC_1',
              databaseId: 1001,
              body: '**[P1] Missing null check**\n\n`user.id` can throw if user is undefined.',
              author: { login: 'gem-pr-reviewer' },
              createdAt: '2026-09-10T10:00:00Z',
            },
            {
              id: 'PRRC_2',
              databaseId: 1002,
              body: 'Good catch, added optional chaining in next commit!',
              author: { login: 'contributor' },
              createdAt: '2026-09-10T11:00:00Z',
            },
          ],
        },
      },
      {
        id: 'PRRT_kw2',
        isResolved: true,
        isOutdated: false,
        path: 'src/config.js',
        line: 15,
        originalLine: 15,
        diffSide: 'RIGHT',
        comments: {
          nodes: [
            {
              id: 'PRRC_3',
              databaseId: 1003,
              body: '**[P2] Unused variable**\n\nRemove unused variable `temp`.',
              author: { login: 'gem-pr-reviewer' },
              createdAt: '2026-09-10T09:00:00Z',
            },
          ],
        },
      },
    ];

    describe('normalizeReviewThreads', () => {
      it('normalizes GraphQL thread nodes and tracks discussion states', () => {
        const threads = normalizeReviewThreads(sampleGraphqlThreads);
        assert.equal(threads.length, 2);

        const t1 = threads[0];
        assert.equal(t1.threadId, 'PRRT_kw1');
        assert.equal(t1.path, 'src/auth.js');
        assert.equal(t1.line, 42);
        assert.equal(t1.side, 'RIGHT');
        assert.equal(t1.isResolved, false);
        assert.equal(t1.turnCount, 2);
        assert.equal(t1.replyCount, 1);
        assert.equal(t1.discussionState, 'author_replied');
        assert.equal(t1.authorReplies.length, 1);
        assert.equal(t1.authorReplies[0].author, 'contributor');
        assert.equal(t1.lastAuthor, 'contributor');
        assert.equal(t1.finding?.severity, 'P1');
        assert.equal(t1.finding?.title, 'Missing null check');

        const t2 = threads[1];
        assert.equal(t2.threadId, 'PRRT_kw2');
        assert.equal(t2.isResolved, true);
        assert.equal(t2.discussionState, 'resolved');
        assert.equal(t2.turnCount, 1);
        assert.equal(t2.replyCount, 0);
        assert.equal(t2.authorReplies.length, 0);
      });

      it('normalizes REST PR comments array into grouped threads', () => {
        const restComments = [
          {
            id: 2001,
            path: 'src/api.js',
            line: 88,
            side: 'RIGHT',
            body: '**[P0] SQL Injection**\n\nSanitize input query.',
            user: { login: 'gem-pr-reviewer' },
            created_at: '2026-09-11T12:00:00Z',
          },
          {
            id: 2002,
            in_reply_to_id: 2001,
            path: 'src/api.js',
            line: 88,
            side: 'RIGHT',
            body: 'Used parameterized query now.',
            user: { login: 'dev' },
            created_at: '2026-09-11T13:00:00Z',
          },
          {
            id: 2003,
            path: 'src/utils.js',
            line: 12,
            side: 'RIGHT',
            body: '**[P3] Typo in docstring**',
            user: { login: 'gem-pr-reviewer' },
            created_at: '2026-09-11T14:00:00Z',
          },
        ];

        const threads = normalizeReviewThreads(restComments);
        assert.equal(threads.length, 2);

        const t1 = threads.find((t) => t.path === 'src/api.js');
        assert.ok(t1);
        assert.equal(t1.turnCount, 2);
        assert.equal(t1.replyCount, 1);
        assert.equal(t1.discussionState, 'author_replied');
        assert.equal(t1.authorReplies[0].author, 'dev');
        assert.equal(t1.rootComment.id, '2001');

        const t2 = threads.find((t) => t.path === 'src/utils.js');
        assert.ok(t2);
        assert.equal(t2.turnCount, 1);
        assert.equal(t2.replyCount, 0);
        assert.equal(t2.discussionState, 'unresolved');
      });
    });

    describe('fetchReviewThreads', () => {
      it('fetches review threads via GraphQL when available', async () => {
        const mockGh = async (args) => {
          if (args[1] === 'graphql') {
            return JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      nodes: sampleGraphqlThreads,
                    },
                  },
                },
              },
            });
          }
          throw new Error('Unexpected command: ' + args.join(' '));
        };

        const threads = await fetchReviewThreads({
          prNumber: 42,
          repo: 'xpepper/pr-review-gemini',
          execGhFn: mockGh,
        });

        assert.equal(threads.length, 2);
        assert.equal(threads[0].threadId, 'PRRT_kw1');
      });

      it('gracefully falls back to REST comments if GraphQL query fails', async () => {
        const mockGh = async (args) => {
          if (args[1] === 'graphql') {
            throw new Error('GraphQL forbidden or scope missing');
          }
          if (args[1]?.includes('/comments')) {
            return JSON.stringify([
              {
                id: 3001,
                path: 'src/token.js',
                line: 5,
                body: '**[P1] Hardcoded Secret**',
                user: { login: 'reviewer' },
              },
            ]);
          }
          return '[]';
        };

        const threads = await fetchReviewThreads({
          prNumber: 42,
          repo: 'xpepper/pr-review-gemini',
          execGhFn: mockGh,
        });

        assert.equal(threads.length, 1);
        assert.equal(threads[0].path, 'src/token.js');
        assert.equal(threads[0].discussionState, 'unresolved');
      });
    });

    describe('evaluateReviewThread & evaluateReviewThreads', () => {
      const diffWithFix = `diff --git a/src/auth.js b/src/auth.js
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
--- a/src/legacy.js
+++ /dev/null
@@ -1,5 +0,0 @@
-const old = 1;
`;

      it('evaluates modified code as resolved with suggested resolution reply', () => {
        const thread = {
          threadId: 'PRRT_kw1',
          path: 'src/auth.js',
          line: 42,
          isResolved: false,
          authorReplies: [{ author: 'contributor', body: 'Fixed!' }],
          rootComment: { id: '1001', body: '**[P1] Missing null check**' },
        };

        const evalResult = evaluateReviewThread({ thread, diffText: diffWithFix });
        assert.equal(evalResult.verdict, 'RESOLVED');
        assert.equal(evalResult.canResolve, true);
        assert.equal(evalResult.status, 'resolved');
        assert.ok(evalResult.suggestedReply.includes('Resolved'));
      });

      it('evaluates deleted file as obsolete with suggested resolution reply', () => {
        const thread = {
          threadId: 'PRRT_kw2',
          path: 'src/legacy.js',
          line: 2,
          isResolved: false,
          authorReplies: [],
          rootComment: { id: '1002', body: '**[P2] Dead code**' },
        };

        const evalResult = evaluateReviewThread({ thread, diffText: diffWithFix });
        assert.equal(evalResult.verdict, 'OBSOLETE');
        assert.equal(evalResult.canResolve, true);
        assert.equal(evalResult.status, 'obsolete');
        assert.ok(evalResult.suggestedReply.includes('Obsolete') || evalResult.suggestedReply.includes('deleted'));
      });

      it('evaluates unchanged code with author reply as author_replied / pending action', () => {
        const thread = {
          threadId: 'PRRT_kw3',
          path: 'src/other.js',
          line: 10,
          isResolved: false,
          authorReplies: [{ author: 'contributor', body: 'Why is this needed?' }],
          rootComment: { id: '1003', body: '**[P2] Missing validation**' },
        };

        const evalResult = evaluateReviewThread({ thread, diffText: diffWithFix });
        assert.equal(evalResult.verdict, 'STILL_OPEN');
        assert.equal(evalResult.canResolve, false);
        assert.equal(evalResult.status, 'author_replied');
      });

      it('evaluates unchanged code without reply as still_open', () => {
        const thread = {
          threadId: 'PRRT_kw4',
          path: 'src/other.js',
          line: 10,
          isResolved: false,
          authorReplies: [],
          rootComment: { id: '1004', body: '**[P2] Missing validation**' },
        };

        const evalResult = evaluateReviewThread({ thread, diffText: diffWithFix });
        assert.equal(evalResult.verdict, 'STILL_OPEN');
        assert.equal(evalResult.canResolve, false);
        assert.equal(evalResult.status, 'still_open');
      });

      it('evaluateReviewThreads aggregates results across multiple threads', () => {
        const threads = [
          {
            threadId: 'T1',
            path: 'src/auth.js',
            line: 42,
            isResolved: false,
            authorReplies: [],
            rootComment: { id: '1', body: 'Issue 1' },
          },
          {
            threadId: 'T2',
            path: 'src/other.js',
            line: 5,
            isResolved: false,
            authorReplies: [{ author: 'dev', body: 'Need clarification' }],
            rootComment: { id: '2', body: 'Issue 2' },
          },
          {
            threadId: 'T3',
            path: 'src/legacy.js',
            line: 1,
            isResolved: false,
            authorReplies: [],
            rootComment: { id: '3', body: 'Issue 3' },
          },
        ];

        const res = evaluateReviewThreads({ threads, diffText: diffWithFix });
        assert.equal(res.threads.length, 3);
        assert.equal(res.counts.total, 3);
        assert.equal(res.counts.resolved, 1);
        assert.equal(res.counts.obsolete, 1);
        assert.equal(res.counts.authorReplied, 1);
        assert.equal(res.counts.resolvable, 2);

        const summary = formatThreadResolutionSummary(res);
        assert.ok(summary.includes('Review Thread Verification'));
        assert.ok(summary.includes('Verified Resolved'));
      });
    });

    describe('resolveReviewThread, replyToReviewThread, resolveVerifiedThreads', () => {
      it('resolveReviewThread invokes GraphQL resolveReviewThread mutation', async () => {
        let calledWith = null;
        const mockGh = async (args) => {
          calledWith = args;
          return JSON.stringify({
            data: {
              resolveReviewThread: {
                thread: { id: 'PRRT_123', isResolved: true },
              },
            },
          });
        };

        const res = await resolveReviewThread({
          threadId: 'PRRT_123',
          execGhFn: mockGh,
        });

        assert.equal(res.success, true);
        assert.equal(res.isResolved, true);
        assert.ok(calledWith.join(' ').includes('mutation($threadId: ID!)'));
        assert.ok(calledWith.join(' ').includes('threadId=PRRT_123'));
      });

      it('replyToReviewThread invokes GraphQL addPullRequestReviewThreadReply mutation', async () => {
        let calledWith = null;
        const mockGh = async (args) => {
          calledWith = args;
          return JSON.stringify({
            data: {
              addPullRequestReviewThreadReply: {
                comment: { id: 'PRRC_new', body: 'Verified fix', createdAt: '2026-09-12T00:00:00Z' },
              },
            },
          });
        };

        const res = await replyToReviewThread({
          threadId: 'PRRT_123',
          body: 'Verified fix',
          execGhFn: mockGh,
        });

        assert.equal(res.success, true);
        assert.ok(calledWith.join(' ').includes('addPullRequestReviewThreadReply'));
        assert.ok(calledWith.join(' ').includes('threadId=PRRT_123'));
      });

      it('resolveVerifiedThreads replies and resolves all resolvable threads', async () => {
        const calls = [];
        const mockGh = async (args) => {
          calls.push(args);
          if (args.join(' ').includes('addPullRequestReviewThreadReply')) {
            return JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c1' } } } });
          }
          if (args.join(' ').includes('resolveReviewThread')) {
            return JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } } });
          }
          return '{}';
        };

        const evaluatedThreads = [
          {
            threadId: 'PRRT_1',
            path: 'src/auth.js',
            line: 42,
            canResolve: true,
            isResolved: false,
            verdict: 'RESOLVED',
            suggestedReply: '✅ Resolved: verified in diff.',
          },
          {
            threadId: 'PRRT_2',
            path: 'src/other.js',
            line: 10,
            canResolve: false,
            isResolved: false,
            verdict: 'STILL_OPEN',
          },
        ];

        const res = await resolveVerifiedThreads({
          threads: evaluatedThreads,
          prNumber: 42,
          repo: 'xpepper/pr-review-gemini',
          reply: true,
          execGhFn: mockGh,
        });

        assert.equal(res.resolvedCount, 1);
        assert.equal(res.resolvedThreads.length, 1);
        assert.equal(res.resolvedThreads[0].threadId, 'PRRT_1');
        assert.equal(calls.length, 2); // 1 reply + 1 resolve
      });
    });
  });
});

