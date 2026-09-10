import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdownFindings,
  classifyFindings,
  determineReviewEvent,
  formatInlineComment,
  formatReviewSummary,
  checkHeadFreshness,
  publishReview,
  MAX_INLINE_COMMENTS,
} from '../src/publish.js';
import { parseUnifiedDiff } from '../src/diff.js';

describe('Host-Gated GitHub Review Publisher', () => {
  // --------------------------------------------------------------------------
  // Fixtures
  // --------------------------------------------------------------------------
  const SAMPLE_DIFF = `diff --git a/src/calc.js b/src/calc.js
index 1234567..89abcdef 100644
--- a/src/calc.js
+++ b/src/calc.js
@@ -10,6 +10,8 @@ function calculate(a, b) {
   const sum = a + b;
-  const diff = a - b;
+  const diff = Math.abs(a - b);
+  const product = a * b;
   return sum + diff;
 }
diff --git a/src/binary.png b/src/binary.png
index 0000000..1111111 100644
Binary files a/src/binary.png and b/src/binary.png differ
diff --git a/src/deleted.js b/src/deleted.js
deleted file mode 100644
--- a/src/deleted.js
+++ /dev/null
@@ -1,5 +0,0 @@
-const old = true;
`;

  const SAMPLE_FINDINGS_MARKDOWN = `
### [P1] Potential overflow in product calculation
- **File**: \`src/calc.js\`
- **Line**: 12
- **Confidence**: 0.95
- **Side**: RIGHT

Large integer multiplication might exceed safe representation limits.

### [P2] Unanchored finding outside diff hunks
- **File**: \`src/calc.js\`
- **Line**: 99
- **Confidence**: 0.8

This line is not part of the PR diff hunks.

### [nit] Trailing comment formatting
- **File**: \`src/calc.js\`
- **Line**: 11
- **Confidence**: 0.7

Minor spacing recommendation.
`;

  // --------------------------------------------------------------------------
  // 1. parseMarkdownFindings
  // --------------------------------------------------------------------------
  describe('parseMarkdownFindings', () => {
    it('returns empty array when input is empty or invalid', () => {
      assert.deepEqual(parseMarkdownFindings(''), []);
      assert.deepEqual(parseMarkdownFindings('   '), []);
      assert.deepEqual(parseMarkdownFindings(null), []);
      assert.deepEqual(parseMarkdownFindings(undefined), []);
      assert.deepEqual(parseMarkdownFindings('Just general prose with no findings.'), []);
    });

    it('parses structured findings from standard Markdown headings and lists', () => {
      const findings = parseMarkdownFindings(SAMPLE_FINDINGS_MARKDOWN);
      assert.equal(findings.length, 3);

      assert.equal(findings[0].severity, 'P1');
      assert.equal(findings[0].title, 'Potential overflow in product calculation');
      assert.equal(findings[0].filePath, 'src/calc.js');
      assert.equal(findings[0].line, 12);
      assert.equal(findings[0].confidence, 0.95);
      assert.equal(findings[0].side, 'RIGHT');
      assert.match(findings[0].commentary, /Large integer multiplication/);

      assert.equal(findings[1].severity, 'P2');
      assert.equal(findings[1].filePath, 'src/calc.js');
      assert.equal(findings[1].line, 99);
      assert.equal(findings[1].confidence, 0.8);

      assert.equal(findings[2].severity, 'nit');
      assert.equal(findings[2].filePath, 'src/calc.js');
      assert.equal(findings[2].line, 11);
      assert.equal(findings[2].confidence, 0.7);
    });

    it('parses bullet-list style findings', () => {
      const markdown = `
- **[P0]** \`src/auth.js:45\` (confidence: 0.9): Critical authentication bypass when token is empty.
- **[P3]** \`src/utils.js:10\` (confidence: 0.6): Consider caching regex pattern.
`;
      const findings = parseMarkdownFindings(markdown);
      assert.equal(findings.length, 2);

      assert.equal(findings[0].severity, 'P0');
      assert.equal(findings[0].filePath, 'src/auth.js');
      assert.equal(findings[0].line, 45);
      assert.equal(findings[0].confidence, 0.9);
      assert.match(findings[0].commentary, /Critical authentication bypass/);

      assert.equal(findings[1].severity, 'P3');
      assert.equal(findings[1].filePath, 'src/utils.js');
      assert.equal(findings[1].line, 10);
      assert.equal(findings[1].confidence, 0.6);
    });

    it('extracts findings from embedded JSON blocks', () => {
      const jsonMarkdown = `
Review completed. Here are the findings:

\`\`\`json
[
  {
    "title": "SQL Injection vulnerability",
    "severity": "P0",
    "confidence": 0.98,
    "filePath": "src/db.js",
    "line": 42,
    "commentary": "Direct string interpolation in query execution."
  }
]
\`\`\`
`;
      const findings = parseMarkdownFindings(jsonMarkdown);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].severity, 'P0');
      assert.equal(findings[0].filePath, 'src/db.js');
      assert.equal(findings[0].line, 42);
      assert.equal(findings[0].confidence, 0.98);
      assert.equal(findings[0].title, 'SQL Injection vulnerability');
    });

    it('extracts findings from delimited envelope <<<PR_REVIEW_JSON>>>', () => {
      const envelopeMarkdown = `
<<<PR_REVIEW_JSON>>>
{
  "candidates": [
    {
      "title": "Race condition in cache",
      "severity": "P1",
      "confidence": 0.85,
      "location": {
        "path": "src/cache.js",
        "endLine": 77
      },
      "actual": "Multiple writes can interleave without locking."
    }
  ]
}
<<<END_PR_REVIEW_JSON>>>
`;
      const findings = parseMarkdownFindings(envelopeMarkdown);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].severity, 'P1');
      assert.equal(findings[0].filePath, 'src/cache.js');
      assert.equal(findings[0].line, 77);
      assert.equal(findings[0].confidence, 0.85);
      assert.match(findings[0].commentary, /Multiple writes can interleave/);
    });

    it('parses findings with percentage confidence and explicit side', () => {
      const markdown = `
### [P2] Legacy check on old lines
- **File**: \`src/deleted.js\`
- **Line**: 1
- **Confidence**: 85%
- **Side**: LEFT

This old check was flawed.
`;
      const findings = parseMarkdownFindings(markdown);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].severity, 'P2');
      assert.equal(findings[0].confidence, 0.85);
      assert.equal(findings[0].side, 'LEFT');
      assert.equal(findings[0].filePath, 'src/deleted.js');
      assert.equal(findings[0].line, 1);
    });

    it('handles already structured finding arrays', () => {
      const input = [
        {
          title: 'Direct object finding',
          severity: 'P2',
          confidence: 0.9,
          filePath: 'src/calc.js',
          line: 12,
          commentary: 'A pre-parsed finding.',
        },
      ];
      const findings = parseMarkdownFindings(input);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].severity, 'P2');
      assert.equal(findings[0].line, 12);
    });
  });

  // --------------------------------------------------------------------------
  // 2. classifyFindings & Diff Anchor Validation
  // --------------------------------------------------------------------------
  describe('classifyFindings', () => {
    const diffs = parseUnifiedDiff(SAMPLE_DIFF);

    it('anchors findings that fall on commentable lines in diff hunks', () => {
      const findings = [
        {
          severity: 'P1',
          filePath: 'src/calc.js',
          line: 11, // inside hunk
          commentary: 'Valid comment on line 11',
        },
        {
          severity: 'P2',
          filePath: 'src/calc.js',
          line: 12, // inside hunk
          commentary: 'Valid comment on line 12',
        },
      ];

      const result = classifyFindings(findings, diffs);
      assert.equal(result.inlineComments.length, 2);
      assert.equal(result.demotedFindings.length, 0);
      assert.equal(result.inlineComments[0].line, 11);
      assert.equal(result.inlineComments[0].anchored, true);
    });

    it('demotes findings that fall outside diff hunks to summary body', () => {
      const findings = [
        {
          severity: 'P2',
          filePath: 'src/calc.js',
          line: 99, // outside hunk
          commentary: 'Line outside hunk',
        },
      ];

      const result = classifyFindings(findings, diffs);
      assert.equal(result.inlineComments.length, 0);
      assert.equal(result.demotedFindings.length, 1);
      assert.equal(result.demotedFindings[0].anchored, false);
      assert.match(result.demotedFindings[0].demoteReason, /outside diff hunks/i);
    });

    it('demotes findings on files not in diff or on binary/deleted files', () => {
      const findings = [
        {
          severity: 'P1',
          filePath: 'src/unmodified.js',
          line: 10,
          commentary: 'File not in PR diff',
        },
        {
          severity: 'P2',
          filePath: 'src/binary.png',
          line: 1,
          commentary: 'Binary file',
        },
        {
          severity: 'P3',
          filePath: 'src/deleted.js',
          line: 2,
          side: 'RIGHT',
          commentary: 'Deleted file on RIGHT side',
        },
      ];

      const result = classifyFindings(findings, diffs);
      assert.equal(result.inlineComments.length, 0);
      assert.equal(result.demotedFindings.length, 3);
    });

    it('correctly validates side commentability for deleted and added files', () => {
      const ADDED_DIFF = `diff --git a/src/new.js b/src/new.js
new file mode 100644
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,5 @@
+const x = 1;
+`;
      const combinedDiffs = parseUnifiedDiff(SAMPLE_DIFF + '\n' + ADDED_DIFF);

      // Deleted file on LEFT side is valid (line 1 exists in pre-image)
      const validDeleted = [{
        severity: 'P2',
        filePath: 'src/deleted.js',
        line: 1,
        side: 'LEFT',
        commentary: 'Old line comment',
      }];
      const resultDeleted = classifyFindings(validDeleted, combinedDiffs);
      assert.equal(resultDeleted.inlineComments.length, 1);
      assert.equal(resultDeleted.demotedFindings.length, 0);

      // Added file on LEFT side is invalid (does not exist in pre-image)
      const invalidAdded = [{
        severity: 'P2',
        filePath: 'src/new.js',
        line: 1,
        side: 'LEFT',
        commentary: 'Pre-image line comment',
      }];
      const resultAdded = classifyFindings(invalidAdded, combinedDiffs);
      assert.equal(resultAdded.inlineComments.length, 0);
      assert.equal(resultAdded.demotedFindings.length, 1);
    });

    it('caps inline comments at MAX_INLINE_COMMENTS (50) and demotes the rest by priority', () => {
      // Generate 55 commentable findings
      const manyFindings = [];
      for (let i = 0; i < 55; i++) {
        manyFindings.push({
          title: `Finding ${i}`,
          severity: i < 5 ? 'P3' : 'P1', // First 5 are P3, rest are P1
          confidence: 0.9,
          filePath: 'src/calc.js',
          line: 11, // all commentable
          commentary: `Comment ${i}`,
        });
      }

      const result = classifyFindings(manyFindings, diffs, { maxInlineComments: MAX_INLINE_COMMENTS });
      assert.equal(result.inlineComments.length, 50);
      assert.equal(result.demotedFindings.length, 5);

      // Higher priority (P1) should be kept in inlineComments; lower priority (P3) demoted
      for (const inline of result.inlineComments) {
        assert.equal(inline.severity, 'P1');
      }
      for (const demoted of result.demotedFindings) {
        assert.equal(demoted.severity, 'P3');
        assert.match(demoted.demoteReason, /exceeded max inline comments/i);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. formatInlineComment & formatReviewSummary
  // --------------------------------------------------------------------------
  describe('Formatting Helpers', () => {
    it('formatInlineComment produces structured markdown with severity and confidence', () => {
      const finding = {
        title: 'Potential null dereference',
        severity: 'P1',
        confidence: 0.95,
        commentary: 'Variable `res` may be undefined before property access.',
      };
      const text = formatInlineComment(finding);
      assert.match(text, /\*\*\[P1\] Potential null dereference\*\*/);
      assert.match(text, /confidence: 0\.95/);
      assert.match(text, /Variable `res` may be undefined/);
    });

    it('formatReviewSummary appends demoted findings to summary body', () => {
      const summary = '## Overall Review\nLooks good with minor notes.';
      const demotedFindings = [
        {
          title: 'Unanchored issue',
          severity: 'P2',
          filePath: 'src/calc.js',
          line: 99,
          demoteReason: 'Line 99 is outside diff hunks',
          commentary: 'Consider refactoring this helper.',
        },
      ];

      const formatted = formatReviewSummary({
        summary,
        demotedFindings,
        inlineCommentsCount: 2,
        reviewEvent: 'COMMENT',
      });

      assert.match(formatted, /## Overall Review/);
      assert.match(formatted, /Additional Findings/);
      assert.match(formatted, /\[P2\]/);
      assert.match(formatted, /src\/calc\.js:99/);
      assert.match(formatted, /outside diff hunks/);
    });

    it('formatReviewSummary leaves clean summary when there are no demoted findings', () => {
      const summary = '## Overall Review\nAll clean.';
      const formatted = formatReviewSummary({
        summary,
        demotedFindings: [],
        inlineCommentsCount: 0,
        reviewEvent: 'APPROVE',
      });
      assert.match(formatted, /All clean\./);
      assert.doesNotMatch(formatted, /Additional Findings/);
    });

    it('normalizes double-escaped literal newlines (\\n) into real newlines in formatReviewSummary', () => {
      const summaryWithLiteralEscapes = '### 🟡 Changes recommended\\n\\nA translation-only edit unnecessarily triggers a full Elm compilation.';
      const formatted = formatReviewSummary({ summary: summaryWithLiteralEscapes });
      assert.equal(
        formatted,
        '### 🟡 Changes recommended\n\nA translation-only edit unnecessarily triggers a full Elm compilation.'
      );
    });

    it('normalizes double-escaped literal newlines (\\n) in formatInlineComment', () => {
      const finding = {
        title: 'Watcher issue',
        severity: 'P1',
        confidence: 0.9,
        commentary: 'First paragraph.\\n\\nSecond paragraph.',
      };
      const text = formatInlineComment(finding);
      assert.match(text, /First paragraph\.\n\nSecond paragraph\./);
    });
  });

  // --------------------------------------------------------------------------
  // 4. determineReviewEvent & Safety Gating
  // --------------------------------------------------------------------------
  describe('determineReviewEvent', () => {
    it('defaults to COMMENT', () => {
      assert.equal(determineReviewEvent({ findings: [] }), 'COMMENT');
    });

    it('never emits REQUEST_CHANGES even when requested', () => {
      const event = determineReviewEvent({
        requestedEvent: 'REQUEST_CHANGES',
        findings: [{ severity: 'P0' }],
      });
      assert.equal(event, 'COMMENT');
    });

    it('forbids APPROVE when reviewing own PR (prAuthor === currentUser)', () => {
      const event = determineReviewEvent({
        requestedEvent: 'APPROVE',
        approveMaxPriorityLevel: 'nit',
        prAuthor: 'xpepper',
        currentUser: 'xpepper',
        findings: [],
      });
      assert.equal(event, 'COMMENT');
    });

    it('keeps COMMENT when approveMaxPriorityLevel is off', () => {
      const event = determineReviewEvent({
        approveMaxPriorityLevel: 'off',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [],
      });
      assert.equal(event, 'COMMENT');
    });

    it('allows APPROVE when approveMaxPriorityLevel is nit and only nits or empty findings exist', () => {
      const eventWithNits = determineReviewEvent({
        approveMaxPriorityLevel: 'nit',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [{ severity: 'nit' }],
      });
      assert.equal(eventWithNits, 'APPROVE');

      const eventEmpty = determineReviewEvent({
        approveMaxPriorityLevel: 'nit',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [],
      });
      assert.equal(eventEmpty, 'APPROVE');
    });

    it('refuses APPROVE when findings exceed approveMaxPriorityLevel', () => {
      // When approveMaxPriorityLevel is 'nit', any P0/P1/P2/P3 blocks approval
      const eventWithP3 = determineReviewEvent({
        approveMaxPriorityLevel: 'nit',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [{ severity: 'P3' }],
      });
      assert.equal(eventWithP3, 'COMMENT');

      // When approveMaxPriorityLevel is 'P2', P0 and P1 block approval
      const eventWithP1 = determineReviewEvent({
        approveMaxPriorityLevel: 'P2',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [{ severity: 'P1' }],
      });
      assert.equal(eventWithP1, 'COMMENT');

      // When approveMaxPriorityLevel is 'P2', P2/P3/nit are permitted
      const eventWithP2 = determineReviewEvent({
        approveMaxPriorityLevel: 'P2',
        prAuthor: 'contributor',
        currentUser: 'bot',
        findings: [{ severity: 'P2' }, { severity: 'nit' }],
      });
      assert.equal(eventWithP2, 'APPROVE');
    });
  });

  // --------------------------------------------------------------------------
  // 5. checkHeadFreshness
  // --------------------------------------------------------------------------
  describe('checkHeadFreshness', () => {
    it('returns PR head metadata when expectedHeadSha matches current head', async () => {
      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'abcdef1234567890abcdef1234567890abcdef12',
            author: { login: 'contributor' },
            state: 'OPEN',
          });
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      const result = await checkHeadFreshness({
        prNumber: 42,
        expectedHeadSha: 'abcdef1234567890abcdef1234567890abcdef12',
        execGhFn: mockExecGh,
      });

      assert.equal(result.headRefOid, 'abcdef1234567890abcdef1234567890abcdef12');
      assert.equal(result.author, 'contributor');
      assert.equal(result.state, 'OPEN');
    });

    it('throws when PR head SHA has changed (stale check)', async () => {
      const mockExecGh = async () => {
        return JSON.stringify({
          headRefOid: 'new_head_sha_9999',
          author: { login: 'contributor' },
          state: 'OPEN',
        });
      };

      await assert.rejects(
        () =>
          checkHeadFreshness({
            prNumber: 42,
            expectedHeadSha: 'old_head_sha_0000',
            execGhFn: mockExecGh,
          }),
        /Head SHA mismatch for PR #42/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. publishReview End-to-End Execution
  // --------------------------------------------------------------------------
  describe('publishReview', () => {
    it('executes atomic review submission via gh api with comments and summary', async () => {
      const recordedCalls = [];

      const mockExecGh = async (args, options = {}) => {
        recordedCalls.push({ args, options });

        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'sha12345',
            author: { login: 'other-developer' },
            state: 'OPEN',
          });
        }

        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'bot-reviewer' });
        }

        if (args[0] === 'api' && args.some((a) => a.includes('/reviews'))) {
          const payload = JSON.parse(options.input || '{}');
          assert.equal(payload.commit_id, 'sha12345');
          assert.equal(payload.event, 'APPROVE');
          assert.equal(payload.comments.length, 1);
          assert.equal(payload.comments[0].path, 'src/calc.js');
          assert.equal(payload.comments[0].line, 11);
          assert.match(payload.body, /LGTM/);
          assert.match(payload.body, /Additional Findings/); // unanchored finding demoted to body

          return JSON.stringify({
            id: 888123,
            html_url: 'https://github.com/test/repo/pull/10#pullrequestreview-888123',
            state: 'APPROVED',
          });
        }

        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      const findings = [
        {
          title: 'Anchored nit',
          severity: 'nit',
          confidence: 0.8,
          filePath: 'src/calc.js',
          line: 11, // in diff hunk
          commentary: 'Line 11 nit comment.',
        },
        {
          title: 'Unanchored nit',
          severity: 'nit',
          confidence: 0.8,
          filePath: 'src/calc.js',
          line: 99, // outside diff hunk -> demoted
          commentary: 'Line 99 unanchored comment.',
        },
      ];

      const outcome = await publishReview({
        prNumber: 10,
        expectedHeadSha: 'sha12345',
        reviewBody: 'LGTM! Great work.',
        findings,
        diffText: SAMPLE_DIFF,
        config: { approveMaxPriorityLevel: 'nit' },
        execGhFn: mockExecGh,
      });

      assert.equal(outcome.success, true);
      assert.equal(outcome.reviewId, 888123);
      assert.equal(outcome.event, 'APPROVE');
      assert.equal(outcome.inlineCommentsCount, 1);
      assert.equal(outcome.demotedFindingsCount, 1);
      assert.equal(outcome.totalFindingsCount, 2);
    });

    it('rejects with error when PR number is invalid', async () => {
      await assert.rejects(
        () => publishReview({ prNumber: -1 }),
        /Invalid PR number/
      );
      await assert.rejects(
        () => publishReview({ prNumber: 'abc' }),
        /Invalid PR number/
      );
    });

    it('rejects review publication when head SHA is stale', async () => {
      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'latest_sha_9999',
            author: { login: 'other-dev' },
            state: 'OPEN',
          });
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      await assert.rejects(
        () =>
          publishReview({
            prNumber: 10,
            expectedHeadSha: 'stale_sha_0000',
            execGhFn: mockExecGh,
          }),
        /Head SHA mismatch for PR #10/
      );
    });

    it('forces event to COMMENT when reviewing own PR even if approve is eligible', async () => {
      let capturedPayload = null;
      const mockExecGh = async (args, options = {}) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'sha_same',
            author: { login: 'my-bot' },
            state: 'OPEN',
          });
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'my-bot' });
        }
        if (args[0] === 'api' && args.some((a) => a.includes('/reviews'))) {
          capturedPayload = JSON.parse(options.input || '{}');
          return JSON.stringify({ id: 101, html_url: 'https://...', state: 'COMMENTED' });
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      const outcome = await publishReview({
        prNumber: 5,
        diffText: SAMPLE_DIFF,
        findings: [{ severity: 'nit', filePath: 'src/calc.js', line: 11, commentary: 'Nit' }],
        config: { approveMaxPriorityLevel: 'nit' },
        execGhFn: mockExecGh,
      });

      assert.equal(outcome.event, 'COMMENT');
      assert.equal(capturedPayload.event, 'COMMENT');
    });

    it('fetches diff automatically when diffText is omitted', async () => {
      let diffFetched = false;
      let reviewPosted = false;

      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            headRefOid: 'sha_auto',
            author: { login: 'contributor' },
            state: 'OPEN',
          });
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'reviewer' });
        }
        if (args[0] === 'pr' && args[1] === 'diff') {
          diffFetched = true;
          return SAMPLE_DIFF;
        }
        if (args[0] === 'api' && args.some((a) => a.includes('/reviews'))) {
          reviewPosted = true;
          return JSON.stringify({ id: 202, html_url: 'https://...', state: 'COMMENTED' });
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      const outcome = await publishReview({
        prNumber: 15,
        findings: [{ severity: 'nit', filePath: 'src/calc.js', line: 11, commentary: 'Nit' }],
        execGhFn: mockExecGh,
      });

      assert.equal(diffFetched, true);
      assert.equal(reviewPosted, true);
      assert.equal(outcome.success, true);
    });

    it('supports custom repo argument', async () => {
      let targetEndpoint = null;
      const mockExecGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({ headRefOid: 'sha_custom', author: { login: 'dev' }, state: 'OPEN' });
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return JSON.stringify({ login: 'bot' });
        }
        if (args[0] === 'api' && args.some((a) => a.includes('/reviews'))) {
          targetEndpoint = args.find((a) => a.includes('/reviews'));
          return JSON.stringify({ id: 303, html_url: 'https://...', state: 'COMMENTED' });
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      };

      await publishReview({
        prNumber: 20,
        diffText: SAMPLE_DIFF,
        repo: 'custom-org/custom-repo',
        execGhFn: mockExecGh,
      });

      assert.equal(targetEndpoint, 'repos/custom-org/custom-repo/pulls/20/reviews');
    });
  });
});
