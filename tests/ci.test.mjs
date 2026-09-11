import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseEventPayload,
  resolveCiEnvironment,
  evaluateCiQualityGate,
  writeGitHubStepOutputs,
  formatCiSummary,
  parseCommentCommand,
  extractCommenterIdentity,
  isAuthorizedCommenter,
  getCommenterAuthorization,
  addCommentReaction,
  postIssueComment,
  formatUnauthorizedReply,
  formatHelpReply,
  formatCompletionReply,
  isVerificationPassed,
  resolvePrContext,
} from '../src/ci.js';
import { runCiAction } from '../scripts/ci-action.mjs';

const silentIo = {
  log: () => {},
  error: () => {},
  warn: () => {},
};

describe('CI Event Payload & Environment Resolution', () => {
  describe('parseEventPayload', () => {
    it('extracts prNumber, repo, action, and commit SHAs from pull_request event payload object', () => {
      const payload = {
        action: 'synchronize',
        number: 42,
        pull_request: {
          number: 42,
          head: { sha: 'abcdef123456' },
          base: { sha: '123456abcdef' },
          base_repo: { full_name: 'xpepper/pr-review-gemini' },
        },
        repository: {
          full_name: 'xpepper/pr-review-gemini',
        },
        sender: {
          login: 'alice',
        },
      };

      const result = parseEventPayload(payload);
      assert.equal(result.isPullRequest, true);
      assert.equal(result.prNumber, 42);
      assert.equal(result.repo, 'xpepper/pr-review-gemini');
      assert.equal(result.action, 'synchronize');
      assert.equal(result.headSha, 'abcdef123456');
      assert.equal(result.baseSha, '123456abcdef');
      assert.equal(result.sender, 'alice');
    });

    it('extracts PR data from raw JSON string', () => {
      const payloadString = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: 99,
          head: { sha: 'head99' },
          base: { sha: 'base99' },
        },
        repository: {
          full_name: 'acme/app',
        },
      });

      const result = parseEventPayload(payloadString);
      assert.equal(result.isPullRequest, true);
      assert.equal(result.prNumber, 99);
      assert.equal(result.repo, 'acme/app');
      assert.equal(result.action, 'opened');
      assert.equal(result.headSha, 'head99');
    });

    it('extracts PR number from issue payload if pull_request key is present in issue', () => {
      const payload = {
        action: 'created',
        issue: {
          number: 15,
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/15' },
        },
        repository: { full_name: 'owner/repo' },
      };

      const result = parseEventPayload(payload);
      assert.equal(result.isPullRequest, true);
      assert.equal(result.prNumber, 15);
      assert.equal(result.repo, 'owner/repo');
    });

    it('extracts PR and comment command metadata from issue_comment payload on pull requests', () => {
      const payload = {
        action: 'created',
        issue: {
          number: 42,
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' },
        },
        comment: {
          id: 98765,
          body: '/gem-review --quick --role=a11y',
          author_association: 'MEMBER',
          user: { login: 'octocat' },
        },
        repository: { full_name: 'owner/repo' },
        sender: { login: 'octocat' },
      };

      const result = parseEventPayload(payload);
      assert.equal(result.isPullRequest, true);
      assert.equal(result.prNumber, 42);
      assert.equal(result.repo, 'owner/repo');
      assert.equal(result.isComment, true);
      assert.equal(result.commentId, 98765);
      assert.equal(result.commentBody, '/gem-review --quick --role=a11y');
      assert.equal(result.commentAuthorAssociation, 'MEMBER');
      assert.equal(result.commentUser, 'octocat');
      assert.equal(result.commandInfo.isCommand, true);
      assert.equal(result.commandInfo.mode, 'quick');
      assert.deepEqual(result.commandInfo.roles, ['a11y']);
    });

    it('marks isPullRequest: false if issue_comment is on a plain issue without pull_request', () => {
      const payload = {
        action: 'created',
        issue: {
          number: 7,
          // no pull_request key
        },
        comment: {
          id: 111,
          body: '/gem-review',
          author_association: 'MEMBER',
        },
        repository: { full_name: 'owner/repo' },
      };

      const result = parseEventPayload(payload);
      assert.equal(result.isPullRequest, false);
      assert.equal(result.isComment, true);
      assert.equal(result.commandInfo.isCommand, true);
    });

    it('handles non-PR event payloads gracefully', () => {
      const payload = {
        ref: 'refs/heads/main',
        repository: { full_name: 'owner/repo' },
      };

      const result = parseEventPayload(payload);
      assert.equal(result.isPullRequest, false);
      assert.equal(result.prNumber, null);
      assert.equal(result.repo, 'owner/repo');
      assert.equal(result.action, null);
    });

    it('returns empty defaults for null, undefined, or empty payload', () => {
      const expectedEmpty = {
        isPullRequest: false,
        prNumber: null,
        repo: null,
        action: null,
        headSha: null,
        baseSha: null,
        sender: null,
        isComment: false,
        commentId: null,
        commentBody: null,
        commentAuthorAssociation: null,
        commentUser: null,
        commandInfo: null,
        rawPayload: null,
      };

      assert.deepEqual(parseEventPayload(null), expectedEmpty);
      assert.deepEqual(parseEventPayload(''), expectedEmpty);
      assert.deepEqual(parseEventPayload('{invalid json'), expectedEmpty);
    });

    it('loads event payload from file when path string points to an existing file', () => {
      const tmpFile = path.join(os.tmpdir(), `event-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'synchronize',
        pull_request: { number: 77 },
        repository: { full_name: 'test/repo' },
      }));

      try {
        const result = parseEventPayload(tmpFile);
        assert.equal(result.isPullRequest, true);
        assert.equal(result.prNumber, 77);
        assert.equal(result.repo, 'test/repo');
        assert.equal(result.action, 'synchronize');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('resolvePrContext', () => {
    it('resolves PR context from payload with pull_request object', () => {
      assert.deepEqual(resolvePrContext({ pull_request: { number: 42 } }), { isPr: true, prNumber: 42 });
      assert.deepEqual(resolvePrContext({ pull_request: {}, number: 42 }), { isPr: true, prNumber: 42 });
    });

    it('resolves PR context from issue payload with pull_request link', () => {
      assert.deepEqual(resolvePrContext({ issue: { number: 99, pull_request: {} } }), { isPr: true, prNumber: 99 });
      assert.deepEqual(resolvePrContext({ issue: { pull_request: {} }, number: 99 }), { isPr: true, prNumber: 99 });
    });

    it('resolves PR context from top-level PR action events without issue object', () => {
      assert.deepEqual(resolvePrContext({ action: 'synchronize', number: 12 }), { isPr: true, prNumber: 12 });
      assert.deepEqual(resolvePrContext({ action: 'opened', number: 13 }), { isPr: true, prNumber: 13 });
      assert.deepEqual(resolvePrContext({ action: 'reopened', number: 14 }), { isPr: true, prNumber: 14 });
    });

    it('returns isPr: false for plain issues or non-PR payloads', () => {
      assert.deepEqual(resolvePrContext({ issue: { number: 5 } }), { isPr: false, prNumber: null });
      assert.deepEqual(resolvePrContext({ action: 'created', number: 5 }), { isPr: false, prNumber: null });
      assert.deepEqual(resolvePrContext(null), { isPr: false, prNumber: null });
      assert.deepEqual(resolvePrContext({}), { isPr: false, prNumber: null });
      assert.deepEqual(resolvePrContext('invalid'), { isPr: false, prNumber: null });
    });
  });

  describe('resolveCiEnvironment', () => {
    it('resolves PR number and repo from GITHUB_EVENT_PATH when not explicitly passed', () => {
      const tmpFile = path.join(os.tmpdir(), `event-ci-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'opened',
        pull_request: { number: 101 },
        repository: { full_name: 'my-org/my-repo' },
      }));

      try {
        const env = {
          GITHUB_EVENT_PATH: tmpFile,
          GITHUB_TOKEN: 'ghp_secret123',
        };

        const resolved = resolveCiEnvironment({}, env);
        assert.equal(resolved.prNumber, 101);
        assert.equal(resolved.repo, 'my-org/my-repo');
        assert.equal(resolved.githubToken, 'ghp_secret123');
        assert.equal(resolved.incremental, false); // opened event
        assert.equal(resolved.mode, 'balanced');
        assert.equal(resolved.failOn, 'none');
        assert.equal(resolved.action, 'publish');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('automatically enables incremental mode on synchronize event in auto mode', () => {
      const tmpFile = path.join(os.tmpdir(), `event-sync-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'synchronize',
        pull_request: { number: 102 },
        repository: { full_name: 'my-org/my-repo' },
      }));

      try {
        const env = { GITHUB_EVENT_PATH: tmpFile };
        const resolved = resolveCiEnvironment({ incremental: 'auto' }, env);
        assert.equal(resolved.prNumber, 102);
        assert.equal(resolved.incremental, true);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('allows explicit incremental overrides (true or false)', () => {
      const tmpFile = path.join(os.tmpdir(), `event-override-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'synchronize',
        pull_request: { number: 103 },
      }));

      try {
        const env = { GITHUB_EVENT_PATH: tmpFile };
        const falseResolved = resolveCiEnvironment({ incremental: 'false' }, env);
        assert.equal(falseResolved.incremental, false);

        const trueResolved = resolveCiEnvironment({ incremental: true }, {
          ...env,
          GITHUB_EVENT_PATH: undefined,
        });
        assert.equal(trueResolved.incremental, true);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('prefers explicit options over environment variables', () => {
      const env = {
        GITHUB_REPOSITORY: 'env-org/env-repo',
        GITHUB_TOKEN: 'env_token',
      };

      const resolved = resolveCiEnvironment({
        prNumber: 55,
        repo: 'custom-org/custom-repo',
        mode: 'deep',
        failOn: 'P0',
        githubToken: 'explicit_token',
        action: 'dry-run',
        select: 'p0,p1',
      }, env);

      assert.equal(resolved.prNumber, 55);
      assert.equal(resolved.repo, 'custom-org/custom-repo');
      assert.equal(resolved.mode, 'deep');
      assert.equal(resolved.failOn, 'P0');
      assert.equal(resolved.githubToken, 'explicit_token');
      assert.equal(resolved.action, 'dry-run');
      assert.equal(resolved.select, 'p0,p1');
    });

    it('reads INPUT_* environment variables provided by GitHub Actions runner', () => {
      const env = {
        INPUT_PR_NUMBER: '88',
        INPUT_MODE: 'full',
        INPUT_FAIL_ON: 'P1',
        INPUT_INCREMENTAL: 'true',
        INPUT_ACTION: 'dry-run',
        INPUT_SELECT: 'min:p2',
        INPUT_GITHUB_TOKEN: 'action_token',
        GITHUB_REPOSITORY: 'ci/repo',
      };

      const resolved = resolveCiEnvironment({}, env);
      assert.equal(resolved.prNumber, 88);
      assert.equal(resolved.mode, 'full');
      assert.equal(resolved.failOn, 'P1');
      assert.equal(resolved.incremental, true);
      assert.equal(resolved.action, 'dry-run');
      assert.equal(resolved.select, 'min:p2');
      assert.equal(resolved.githubToken, 'action_token');
      assert.equal(resolved.repo, 'ci/repo');
    });

    it('resolves command options and authorization when triggered by issue_comment command', () => {
      const tmpFile = path.join(os.tmpdir(), `event-comment-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'created',
        issue: {
          number: 55,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/55' },
        },
        comment: {
          id: 456,
          body: '/gem-review --quick --incremental --role=a11y --verify=test --fail-on=P1',
          author_association: 'MEMBER',
          user: { login: 'alice' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'alice' },
      }));

      try {
        const env = {
          GITHUB_EVENT_PATH: tmpFile,
          INPUT_MODE: 'balanced', // Action default
        };

        const resolved = resolveCiEnvironment({}, env);
        assert.equal(resolved.prNumber, 55);
        assert.equal(resolved.repo, 'org/repo');
        assert.equal(resolved.mode, 'quick'); // Overridden by comment
        assert.equal(resolved.incremental, true); // Overridden by comment
        assert.deepEqual(resolved.roles, ['a11y']);
        assert.equal(resolved.verify, 'test');
        assert.equal(resolved.failOn, 'P1');
        assert.equal(resolved.isComment, true);
        assert.equal(resolved.isCommentCommand, true);
        assert.equal(resolved.isAuthorized, true);
        assert.equal(resolved.commentId, 456);
        assert.equal(resolved.commentUser, 'alice');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('marks isAuthorized: false when commenter has non-collaborator association and no write perms', () => {
      const tmpFile = path.join(os.tmpdir(), `event-unauth-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        action: 'created',
        issue: {
          number: 56,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/56' },
        },
        comment: {
          id: 789,
          body: '/gem-review --quick',
          author_association: 'FIRST_TIME_CONTRIBUTOR',
          user: { login: 'stranger' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'stranger' },
      }));

      try {
        const env = { GITHUB_EVENT_PATH: tmpFile };
        const resolved = resolveCiEnvironment({}, env);
        assert.equal(resolved.isComment, true);
        assert.equal(resolved.isCommentCommand, true);
        assert.equal(resolved.isAuthorized, false);
        assert.equal(resolved.commentUser, 'stranger');
        assert.equal(resolved.commentAuthorAssociation, 'FIRST_TIME_CONTRIBUTOR');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('evaluateCiQualityGate', () => {
    const mockFindings = [
      { severity: 'P0', title: 'Critical vulnerability', filePath: 'auth.js', line: 10 },
      { severity: 'P1', title: 'Data loss risk', filePath: 'db.js', line: 45 },
      { severity: 'P2', title: 'Missing index', filePath: 'query.js', line: 12 },
      { severity: 'P3', title: 'Minor inconsistency', filePath: 'util.js', line: 8 },
      { severity: 'nit', title: 'Typo in comment', filePath: 'util.js', line: 20 },
    ];

    it('returns passed: true and verdict: PASS when failOn is none', () => {
      const result = evaluateCiQualityGate(mockFindings, { failOn: 'none' });
      assert.equal(result.passed, true);
      assert.equal(result.verdict, 'PASS');
      assert.equal(result.blockingCount, 0);
      assert.equal(result.totalFindings, 5);
      assert.deepEqual(result.blockingFindings, []);
    });

    it('returns passed: false and verdict: FAIL when P0 exists and failOn is P0', () => {
      const result = evaluateCiQualityGate(mockFindings, { failOn: 'P0' });
      assert.equal(result.passed, false);
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.blockingCount, 1);
      assert.equal(result.blockingFindings[0].severity, 'P0');
    });

    it('returns passed: false and flags P0 and P1 when failOn is P1', () => {
      const result = evaluateCiQualityGate(mockFindings, { failOn: 'P1' });
      assert.equal(result.passed, false);
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.blockingCount, 2);
      assert.deepEqual(result.blockingFindings.map(f => f.severity), ['P0', 'P1']);
    });

    it('returns passed: true when all findings are lower severity than failOn threshold', () => {
      const minorFindings = [
        { severity: 'P2', title: 'Missing index', filePath: 'query.js', line: 12 },
        { severity: 'nit', title: 'Typo', filePath: 'util.js', line: 20 },
      ];

      const result = evaluateCiQualityGate(minorFindings, { failOn: 'P1' });
      assert.equal(result.passed, true);
      assert.equal(result.verdict, 'PASS');
      assert.equal(result.blockingCount, 0);
    });

    it('handles empty findings array cleanly', () => {
      const result = evaluateCiQualityGate([], { failOn: 'P1' });
      assert.equal(result.passed, true);
      assert.equal(result.verdict, 'PASS');
      assert.equal(result.blockingCount, 0);
      assert.equal(result.totalFindings, 0);
    });
  });

  describe('writeGitHubStepOutputs', () => {
    it('writes key-value pairs and multiline outputs to GITHUB_OUTPUT file', () => {
      const tmpFile = path.join(os.tmpdir(), `gh-out-${Date.now()}.txt`);
      try {
        const outputs = {
          verdict: 'PASS',
          findings_count: 3,
          blocking_count: 0,
          summary: '## Gem PR Review Summary\n\nAll checks passed!',
        };

        writeGitHubStepOutputs(outputs, { outputFile: tmpFile });

        const content = fs.readFileSync(tmpFile, 'utf8');
        assert.match(content, /verdict=PASS/);
        assert.match(content, /findings_count=3/);
        assert.match(content, /blocking_count=0/);
        assert.match(content, /summary<<ghadelimiter_[a-zA-Z0-9_-]+\n## Gem PR Review Summary\n\nAll checks passed!\n/);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    it('does not throw when GITHUB_OUTPUT is not set or undefined', () => {
      assert.doesNotThrow(() => {
        writeGitHubStepOutputs({ verdict: 'PASS' }, { outputFile: null });
      });
    });
  });

  describe('action.yml Manifest Schema Validation', () => {
    it('verifies action.yml exists at repository root and defines a valid composite action', () => {
      const actionPath = path.resolve('action.yml');
      assert.equal(fs.existsSync(actionPath), true, 'action.yml must exist at repo root');

      const content = fs.readFileSync(actionPath, 'utf8');
      assert.match(content, /name:\s*['"]?Gem PR Review['"]?/);
      assert.match(content, /using:\s*['"]?composite['"]?/);

      // Verify all required inputs
      const requiredInputs = ['github_token', 'pr_number', 'mode', 'fail_on', 'incremental', 'action', 'select'];
      for (const input of requiredInputs) {
        assert.match(content, new RegExp(`\\b${input}:`), `action.yml must define input '${input}'`);
      }

      // Verify all required outputs
      const requiredOutputs = ['verdict', 'findings_count', 'blocking_count', 'summary'];
      for (const output of requiredOutputs) {
        assert.match(content, new RegExp(`\\b${output}:`), `action.yml must define output '${output}'`);
      }
    });
  });

  describe('CI Action Runner (scripts/ci-action.mjs)', () => {
    it('executes review in mock mode, passes quality gate, and writes step outputs', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-test-${Date.now()}.txt`);
      const tmpSummary = path.join(os.tmpdir(), `gh-summary-test-${Date.now()}.md`);

      const mockReviewFindings = [
        { severity: 'P2', title: 'Consider memoization', filePath: 'src/calc.js', line: 15, body: 'Could be memoized' },
      ];

      const result = await runCiAction({
        prNumber: 42,
        mode: 'quick',
        failOn: 'P1',
        action: 'dry-run',
        mock: true,
        mockFindings: mockReviewFindings,
      }, {
        GITHUB_OUTPUT: tmpOut,
        GITHUB_STEP_SUMMARY: tmpSummary,
      }, silentIo);

      assert.equal(result.exitCode, 0);
      assert.equal(result.qualityGate.passed, true);
      assert.equal(result.qualityGate.verdict, 'PASS');
      assert.equal(result.qualityGate.blockingCount, 0);

      // Verify GITHUB_OUTPUT was written
      const outContent = fs.readFileSync(tmpOut, 'utf8');
      assert.match(outContent, /verdict=PASS/);
      assert.match(outContent, /findings_count=1/);
      assert.match(outContent, /blocking_count=0/);

      // Verify GITHUB_STEP_SUMMARY was written
      const summaryContent = fs.readFileSync(tmpSummary, 'utf8');
      assert.match(summaryContent, /AI Code Review Passed/);

      fs.unlinkSync(tmpOut);
      fs.unlinkSync(tmpSummary);
    });

    it('fails quality gate with exitCode 1 when findings meet failOn threshold', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-fail-${Date.now()}.txt`);

      const mockBlockingFindings = [
        { severity: 'P1', title: 'Unsanitized input vulnerability', filePath: 'src/api.js', line: 50 },
      ];

      const result = await runCiAction({
        prNumber: 43,
        failOn: 'P1',
        action: 'dry-run',
        mock: true,
        mockFindings: mockBlockingFindings,
      }, {
        GITHUB_OUTPUT: tmpOut,
      }, silentIo);

      assert.equal(result.exitCode, 1);
      assert.equal(result.qualityGate.passed, false);
      assert.equal(result.qualityGate.verdict, 'FAIL');
      assert.equal(result.qualityGate.blockingCount, 1);

      const outContent = fs.readFileSync(tmpOut, 'utf8');
      assert.match(outContent, /verdict=FAIL/);
      assert.match(outContent, /blocking_count=1/);

      fs.unlinkSync(tmpOut);
    });

    it('returns exitCode 1 when PR number is missing', async () => {
      const result = await runCiAction({}, {
        // no prNumber, no GITHUB_EVENT_PATH
      }, silentIo);

      assert.equal(result.exitCode, 1);
      assert.match(result.error, /PR number/i);
    });

    it('handles version option and INPUT_VERSION env variable', async () => {
      let logged = '';
      const mockIo = {
        log: (msg) => { logged += msg; },
        error: () => {},
        warn: () => {},
      };

      const res1 = await runCiAction({ version: true }, {}, mockIo);
      assert.equal(res1.exitCode, 0);
      assert.match(logged, /gem-pr-review v\d+\.\d+\.\d+/);

      logged = '';
      const res2 = await runCiAction({}, { INPUT_VERSION: 'true' }, mockIo);
      assert.equal(res2.exitCode, 0);
      assert.match(logged, /gem-pr-review v\d+\.\d+\.\d+/);
    });

    it('does not trigger version short-circuit when ambient process.argv contains -v if options.version is not set', async () => {
      const origArgv = [...process.argv];
      process.argv.push('-v', '--version');
      try {
        const result = await runCiAction({}, {}, silentIo);
        assert.equal(result.exitCode, 1);
        assert.match(result.error, /PR number/i);
      } finally {
        process.argv = origArgv;
      }
    });

    it('skips non-command issue comments with exitCode 0 without running review', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-skip-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 10,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/10' },
        },
        comment: {
          id: 111,
          body: 'Thanks for this awesome pull request!',
          author_association: 'MEMBER',
          user: { login: 'reviewer' },
        },
        repository: { full_name: 'org/repo' },
      }));

      try {
        let reviewInvoked = false;
        const result = await runCiAction({
          mock: true,
          runnerFn: async () => { reviewInvoked = true; return '[]'; },
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'not_a_command');
        assert.equal(reviewInvoked, false);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('handles unauthorized comment commands by reacting with eyes and confused, posting denial notice, and exiting 0', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-unauth-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 11,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/11' },
        },
        comment: {
          id: 222,
          body: '/gem-review --quick',
          author_association: 'FIRST_TIME_CONTRIBUTOR',
          user: { login: 'unauthorized-user' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'unauthorized-user' },
      }));

      try {
        const ghCalls = [];
        const customExecGh = async (args) => {
          ghCalls.push(args);
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(result.unauthorized, true);

        // Check reactions: eyes acknowledgment followed by confused denial
        const reactionCalls = ghCalls.filter(call => call.some(a => String(a).includes('reactions')));
        assert.ok(reactionCalls.some(call => call.includes('content=eyes')), 'Must react with eyes');
        assert.ok(reactionCalls.some(call => call.includes('content=confused')), 'Must react with confused');

        // Check comment reply: friendly denial notice posted
        const commentCalls = ghCalls.filter(call => call.some(a => String(a).includes('comments')) && !call.some(a => String(a).includes('reactions')));
        assert.ok(commentCalls.length > 0, 'Must post denial comment reply');
        const bodyArg = commentCalls[0].find(a => a.startsWith('body='));
        assert.match(bodyArg, /@unauthorized-user/);
        assert.match(bodyArg, /FIRST_TIME_CONTRIBUTOR/);
        assert.match(bodyArg, /collaborators, members, or owners/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('handles --help comment command by reacting with eyes and +1, posting guide, and exiting 0', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-help-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 12,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/12' },
        },
        comment: {
          id: 333,
          body: '/gem-review --help',
          author_association: 'MEMBER',
          user: { login: 'member-user' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member-user' },
      }));

      try {
        const ghCalls = [];
        const customExecGh = async (args) => {
          ghCalls.push(args);
          return JSON.stringify({ id: 2 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(result.help, true);

        const reactionCalls = ghCalls.filter(call => call.some(a => String(a).includes('reactions')));
        assert.ok(reactionCalls.some(call => call.includes('content=eyes')), 'Must react with eyes');
        assert.ok(reactionCalls.some(call => call.includes('content=+1')), 'Must react with +1');

        const commentCalls = ghCalls.filter(call => call.some(a => String(a).includes('comments')) && !call.some(a => String(a).includes('reactions')));
        assert.ok(commentCalls.length > 0, 'Must post help guide reply');
        const bodyArg = commentCalls[0].find(a => a.startsWith('body='));
        assert.match(bodyArg, /Comment Commands Guide/i);
        assert.match(bodyArg, /--quick/);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('executes authorized comment command with visual lifecycle (eyes, rocket, +1) and completion reply', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-exec-${Date.now()}.json`);
      const tmpOut = path.join(os.tmpdir(), `event-exec-out-${Date.now()}.txt`);

      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 14,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/14' },
        },
        comment: {
          id: 444,
          body: '/gem-review --quick --role=security',
          author_association: 'COLLABORATOR',
          user: { login: 'collab' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'collab' },
      }));

      try {
        const ghCalls = [];
        const customExecGh = async (args) => {
          ghCalls.push(args);
          if (args[0] === 'pr' && args[1] === 'view') {
            return JSON.stringify({
              headRefOid: 'mock-head-14',
              author: { login: 'collab' },
              state: 'OPEN',
              title: 'Mock PR 14',
            });
          }
          if (args[0] === 'api' && args[1] === 'user') {
            return JSON.stringify({ login: 'github-actions[bot]' });
          }
          return JSON.stringify({ id: 555, state: 'COMMENTED' });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
          GITHUB_OUTPUT: tmpOut,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(result.ciEnv.mode, 'quick');
        assert.deepEqual(result.ciEnv.roles, ['security']);

        // Check visual reactions lifecycle: eyes -> rocket -> +1
        const reactionCalls = ghCalls.filter(call => call.some(a => String(a).includes('reactions')));
        const reactionContents = reactionCalls.map(call => call.find(a => a.startsWith('content=')).slice('content='.length));
        assert.ok(reactionContents.includes('eyes'), 'Should react with eyes');
        assert.ok(reactionContents.includes('rocket'), 'Should react with rocket');
        assert.ok(reactionContents.includes('+1'), 'Should react with +1');

        // Check completion reply
        const commentCalls = ghCalls.filter(call => call.some(a => String(a).includes('comments')) && !call.some(a => String(a).includes('reactions')));
        assert.ok(commentCalls.length > 0, 'Must post completion reply');
        const bodyArg = commentCalls[0].find(a => a.startsWith('body='));
        assert.match(bodyArg, /Gem PR Review Complete/i);
        assert.match(bodyArg, /quick/);
      } finally {
        fs.unlinkSync(tmpEvent);
        if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
      }
    });

    it('reacts with confused (😕) if review execution throws an error during comment command processing', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-err-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 15,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/15' },
        },
        comment: {
          id: 555,
          body: '/gem-review --quick',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        const ghCalls = [];
        const customExecGh = async (args) => {
          ghCalls.push(args);
          if (args[0] === 'pr' && args[1] === 'view') {
            throw new Error('GitHub API network failure');
          }
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.match(result.error, /GitHub API network failure/);

        // Verify confused reaction was added
        const reactionCalls = ghCalls.filter(call => call.some(a => String(a).includes('reactions')));
        const contents = reactionCalls.map(call => call.find(a => a.startsWith('content=')).slice('content='.length));
        assert.ok(contents.includes('eyes'), 'Should react with eyes initially');
        assert.ok(contents.includes('confused'), 'Should react with confused on error');
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('executes detached worktree verification when --verify is passed in comment command', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-verify-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 18,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/18' },
        },
        comment: {
          id: 777,
          body: '/gem-review --quick --verify=build',
          author_association: 'MEMBER',
          user: { login: 'verified-member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'verified-member' },
      }));

      try {
        let verificationExecuted = false;
        let verifiedProfile = null;
        const mockVerification = async ({ prNumber, profileName }) => {
          verificationExecuted = true;
          verifiedProfile = profileName;
          return {
            status: 'passed',
            profile: profileName,
            summary: 'Verification passed cleanly',
          };
        };

        const result = await runCiAction({
          mock: true,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(verificationExecuted, true);
        assert.equal(verifiedProfile, 'build');
        assert.equal(result.verificationResult?.status, 'passed');
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('reacts with confused and fails when prNumber is missing on comment command', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-nopr-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {},
        comment: {
          id: 888,
          body: '/gem-review --quick',
          author_association: 'MEMBER',
          user: { login: 'some-member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'some-member' },
      }));

      try {
        const ghCalls = [];
        const customExecGh = async (args) => {
          ghCalls.push(args);
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.match(result.error, /PR number/);

        // Verify confused reaction was added to comment
        const reactionCalls = ghCalls.filter(call => call.some(a => String(a).includes('reactions')));
        assert.ok(reactionCalls.length > 0);
        assert.ok(reactionCalls[0].includes('content=confused'));
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('rejects unrecognized verification profiles and marks verification as failed', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-badprof-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 19,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/19' },
        },
        comment: {
          id: 778,
          body: '/gem-review --quick --verify=malicious_exec',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.equal(verificationExecuted, false, 'Should not execute verification for disallowed profile');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /disallowed verification profile/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('fails closed and blocks detached worktree verification on cross-repository fork PRs', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-fork-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 20,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/20' },
        },
        comment: {
          id: 779,
          body: '/gem-review --quick --verify=test',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const customExecGh = async (args) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            return JSON.stringify({
              isCrossRepository: true,
              headRefOid: 'fork-sha-123',
            });
          }
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1, 'Must fail closed when verification cannot be executed');
        assert.equal(verificationExecuted, false, 'Must not execute verification on cross-repository fork PR');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /cross-repository\/fork/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('detects cross-repository fork via headRepository.nameWithOwner even if owner matches', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-same-owner-fork-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 25,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/25' },
        },
        comment: {
          id: 785,
          body: '/gem-review --quick --verify=test',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const customExecGh = async (args) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            return JSON.stringify({
              headRefOid: 'same-owner-fork-sha',
              headRepository: { nameWithOwner: 'org/forked-repo' },
              headRepositoryOwner: { login: 'org' },
            });
          }
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1, 'Must fail closed when head repo nameWithOwner differs');
        assert.equal(verificationExecuted, false);
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /cross-repository\/fork/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('fails closed and aborts verification if PR origin query encounters API error', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-origin-err-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 21,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/21' },
        },
        comment: {
          id: 780,
          body: '/gem-review --quick --verify=test',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const customExecGh = async (args) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            if (args.some(a => String(a).includes('isCrossRepository'))) {
              throw new Error('API rate limit exceeded');
            }
            return JSON.stringify({
              headRefOid: 'ci-mock-head-sha',
              author: { login: 'ci-author' },
              state: 'OPEN',
              title: 'CI PR #21',
            });
          }
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1, 'Must fail closed when PR origin query fails');
        assert.equal(verificationExecuted, false, 'Must not execute verification when origin cannot be confirmed');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /Unable to verify PR repository origin/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('fails closed when PR metadata is missing headRefOid commit SHA', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-missing-head-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 21,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/21' },
        },
        comment: {
          id: 780,
          body: '/gem-review --quick --verify',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const customExecGh = async (args) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            return JSON.stringify({
              isCrossRepository: false,
              headRefOid: '', // Empty headRefOid
            });
          }
          return JSON.stringify({ id: 1 });
        };

        const result = await runCiAction({
          mock: true,
          execGhFn: customExecGh,
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1, 'Must fail closed when PR headRefOid is missing');
        assert.equal(verificationExecuted, false, 'Must not execute verification without confirmed headSha');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /missing or empty headRefOid/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('allows custom verification profile when defined in repository config', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-custom-prof-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 22,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/22' },
        },
        comment: {
          id: 781,
          body: '/gem-review --quick --verify=custom_deploy',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        let executedProfile = null;
        let passedConfig = null;
        let passedHeadSha = null;
        const mockVerification = async ({ profileName, config, headSha }) => {
          verificationExecuted = true;
          executedProfile = profileName;
          passedConfig = config;
          passedHeadSha = headSha;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          config: {
            enableCustomCiProfiles: true,
            verificationProfiles: {
              custom_deploy: { command: 'npm run deploy:preview' },
            },
          },
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 0);
        assert.equal(verificationExecuted, true, 'Should execute custom profile defined in repo config');
        assert.equal(executedProfile, 'custom_deploy');
        assert.equal(passedHeadSha, 'ci-mock-head-sha');
        assert.deepEqual(passedConfig?.verificationProfiles?.custom_deploy, { command: 'npm run deploy:preview' });
        assert.equal(result.verificationResult?.status, 'passed');
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('rejects custom profile in CI when enableCustomCiProfiles is not enabled', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-custom-disallow-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 22,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/22' },
        },
        comment: {
          id: 781,
          body: '/gem-review --quick --verify=custom_deploy',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          config: {
            verificationProfiles: {
              custom_deploy: { command: 'npm run deploy:preview' },
            },
          },
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.equal(verificationExecuted, false, 'Should reject custom profile when enableCustomCiProfiles is omitted');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /disallowed verification profile "custom_deploy"/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('handles verification profile resolution failure and fails closed', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-resolve-fail-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 22,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/22' },
        },
        comment: {
          id: 781,
          body: '/gem-review --quick --verify=broken',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          config: {
            enableCustomCiProfiles: true,
            verificationProfiles: {
              broken: null,
            },
            allowedCiVerificationProfiles: ['broken'],
          },
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.equal(verificationExecuted, false, 'Should not execute verification on profile resolution failure');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /failed to resolve: Unknown verification profile: "broken"/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('enforces allowedCiVerificationProfiles restriction when specified in config', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-ci-restrict-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 23,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/23' },
        },
        comment: {
          id: 782,
          body: '/gem-review --quick --verify=lint',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          config: {
            allowedCiVerificationProfiles: ['test', 'build'],
          },
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.equal(verificationExecuted, false, 'Should reject profile outside allowedCiVerificationProfiles');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /disallowed verification profile "lint"/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });

    it('rejects custom profile with unsafe command patterns (shell metacharacters or unauthorized executables)', async () => {
      const tmpEvent = path.join(os.tmpdir(), `event-unsafe-cmd-${Date.now()}.json`);
      fs.writeFileSync(tmpEvent, JSON.stringify({
        action: 'created',
        issue: {
          number: 24,
          pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/24' },
        },
        comment: {
          id: 783,
          body: '/gem-review --quick --verify=malicious_cmd',
          author_association: 'MEMBER',
          user: { login: 'member' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'member' },
      }));

      try {
        let verificationExecuted = false;
        const mockVerification = async () => {
          verificationExecuted = true;
          return { status: 'passed' };
        };

        const result = await runCiAction({
          mock: true,
          config: {
            enableCustomCiProfiles: true,
            verificationProfiles: {
              malicious_cmd: { command: 'npm test && curl evil.com' },
            },
          },
          runVerificationFn: mockVerification,
        }, {
          GITHUB_EVENT_PATH: tmpEvent,
        }, silentIo);

        assert.equal(result.exitCode, 1);
        assert.equal(verificationExecuted, false, 'Should reject unsafe command pattern');
        assert.equal(result.verificationResult?.status, 'failed');
        assert.match(result.verificationResult?.error, /disallowed shell metacharacters/i);
      } finally {
        fs.unlinkSync(tmpEvent);
      }
    });
  });
});

  describe('Starter Workflow Template (.github/workflows/gem-pr-review.yml)', () => {
    it('verifies starter workflow file exists and configures PR triggers and permissions', () => {
      const workflowPath = path.resolve('.github/workflows/gem-pr-review.yml');
      assert.equal(fs.existsSync(workflowPath), true, 'gem-pr-review.yml workflow must exist');

      const content = fs.readFileSync(workflowPath, 'utf8');
      assert.match(content, /name:\s*['"]?Gem PR Review['"]?/);
      assert.match(content, /pull_request:/);
      assert.match(content, /types:\s*\[.*opened.*synchronize.*\]/);
      assert.match(content, /pull-requests:\s*write/);
      assert.match(content, /issue_comment:/);
      assert.match(content, /concurrency:/);
      assert.match(content, /cancel-in-progress:\s*true/);
      assert.match(content, /contains\(github\.event\.comment\.body,\s*['"]\/gem-review['"]\)/);
      assert.match(content, /contains\(github\.event\.comment\.body,\s*['"]\/gem-pr-review['"]\)/);
      assert.doesNotMatch(content, /gh pr checkout/, 'Must not check out untrusted PR head to avoid pwn request vulnerability');
      assert.match(content, /uses:\s*actions\/checkout@v4/);
      assert.match(content, /uses:\s*(\.\/|xpepper\/pr-review-gemini@main)/);
      assert.match(content, /fail_on:\s*P1/);
    });
  });

  describe('Release Workflow Template (.github/workflows/release.yml)', () => {
    it('verifies release workflow exists, handles tags & workflow_dispatch, and clarifies existing tag input', () => {
      const workflowPath = path.resolve('.github/workflows/release.yml');
      assert.equal(fs.existsSync(workflowPath), true, 'release.yml workflow must exist');

      const content = fs.readFileSync(workflowPath, 'utf8');
      assert.match(content, /name:\s*['"]?Release['"]?/);
      assert.match(content, /workflow_dispatch:/);
      assert.match(content, /description:\s*['"]Existing git tag to publish \(e\.g\. v0\.2\.0\)['"]/);
      assert.match(content, /push:\s*\n\s*tags:\s*\n\s*-\s*['"]v\*['"]/);
      assert.match(content, /ref:\s*\${{\s*github\.event\.inputs\.tag \|\| github\.ref\s*}}/);
    });
  });

  describe('Increment 18: Interactive PR Comment Command Dispatcher (/gem-review)', () => {
    describe('parseCommentCommand', () => {
      it('parses basic /gem-review command with defaults', () => {
        const result = parseCommentCommand('/gem-review');
        assert.equal(result.isCommand, true);
        assert.equal(result.command, '/gem-review');
        assert.equal(result.mode, null);
        assert.equal(result.incremental, null);
        assert.deepEqual(result.roles, []);
        assert.equal(result.replaceStandardRoles, false);
        assert.equal(result.verify, null);
        assert.equal(result.failOn, null);
        assert.equal(result.action, null);
        assert.equal(result.select, null);
        assert.equal(result.help, false);
      });

      it('parses /gem-pr-review alias', () => {
        const result = parseCommentCommand('/gem-pr-review');
        assert.equal(result.isCommand, true);
        assert.equal(result.command, '/gem-pr-review');
      });

      it('parses review mode flags (--quick, --balanced, --full, --deep, --mode=<mode>)', () => {
        assert.equal(parseCommentCommand('/gem-review --quick').mode, 'quick');
        assert.equal(parseCommentCommand('/gem-review --balanced').mode, 'balanced');
        assert.equal(parseCommentCommand('/gem-review --full').mode, 'full');
        assert.equal(parseCommentCommand('/gem-review --deep').mode, 'deep');
        assert.equal(parseCommentCommand('/gem-review --mode=quick').mode, 'quick');
        assert.equal(parseCommentCommand('/gem-review --mode deep').mode, 'deep');
      });

      it('parses incremental flags (--incremental, --no-incremental, --incremental=false)', () => {
        assert.equal(parseCommentCommand('/gem-review --incremental').incremental, true);
        assert.equal(parseCommentCommand('/gem-review --no-incremental').incremental, false);
        assert.equal(parseCommentCommand('/gem-review --incremental=true').incremental, true);
        assert.equal(parseCommentCommand('/gem-review --incremental=false').incremental, false);
        assert.equal(parseCommentCommand('/gem-review --incremental=auto').incremental, 'auto');
      });

      it('parses role flags (--role=<id>, --role <id>, comma-separated, repeated, --replace-standard-roles)', () => {
        const single = parseCommentCommand('/gem-review --role=a11y');
        assert.deepEqual(single.roles, ['a11y']);
        assert.equal(single.replaceStandardRoles, false);

        const multi = parseCommentCommand('/gem-review --role a11y --role perf --replace-standard-roles');
        assert.deepEqual(multi.roles, ['a11y', 'perf']);
        assert.equal(multi.replaceStandardRoles, true);

        const comma = parseCommentCommand('/gem-review --role=a11y,perf,security');
        assert.deepEqual(comma.roles, ['a11y', 'perf', 'security']);
      });

      it('parses verification flags (--verify, --verify=<profile>, --verify <profile>, --no-verify)', () => {
        assert.equal(parseCommentCommand('/gem-review --verify').verify, true);
        assert.equal(parseCommentCommand('/gem-review --verify=test').verify, 'test');
        assert.equal(parseCommentCommand('/gem-review --verify integration').verify, 'integration');
        assert.equal(parseCommentCommand('/gem-review --no-verify').verify, false);
      });

      it('parses fail-on quality gate threshold (--fail-on=<sev>, --fail-on <sev>)', () => {
        assert.equal(parseCommentCommand('/gem-review --fail-on=P1').failOn, 'P1');
        assert.equal(parseCommentCommand('/gem-review --fail-on P0').failOn, 'P0');
        assert.equal(parseCommentCommand('/gem-review --failOn=none').failOn, 'none');
      });

      it('parses action and select flags (--dry-run, --publish, --action=<action>, --select=<spec>)', () => {
        assert.equal(parseCommentCommand('/gem-review --dry-run').action, 'dry-run');
        assert.equal(parseCommentCommand('/gem-review --publish').action, 'publish');
        assert.equal(parseCommentCommand('/gem-review --action=dry-run').action, 'dry-run');

        const select1 = parseCommentCommand('/gem-review --select=p0,p1');
        assert.equal(select1.select, 'p0,p1');

        const select2 = parseCommentCommand('/gem-review --select "min:p2"');
        assert.equal(select2.select, 'min:p2');
      });

      it('parses help flags (--help, -h, help)', () => {
        assert.equal(parseCommentCommand('/gem-review --help').help, true);
        assert.equal(parseCommentCommand('/gem-review -h').help, true);
        assert.equal(parseCommentCommand('/gem-review help').help, true);
        assert.equal(parseCommentCommand('/gem-pr-review --help').help, true);
      });

      it('extracts command from multiline comments and handles leading/trailing whitespace', () => {
        const comment = `
Thanks for the updates! Could you rerun the review?

  /gem-review --quick --incremental --role=a11y

Let me know what it finds.
`;
        const result = parseCommentCommand(comment);
        assert.equal(result.isCommand, true);
        assert.equal(result.command, '/gem-review');
        assert.equal(result.mode, 'quick');
        assert.equal(result.incremental, true);
        assert.deepEqual(result.roles, ['a11y']);
      });

      it('ignores commands embedded inside markdown code blocks', () => {
        const commentWithCodeBlock = `
Here is how you use the command:
\`\`\`bash
/gem-review --deep
\`\`\`
Hope that helps!
`;
        const result = parseCommentCommand(commentWithCodeBlock);
        assert.equal(result.isCommand, false);
        assert.equal(result.command, null);
      });

      it('returns isCommand: false for comments not containing /gem-review or /gem-pr-review', () => {
        assert.equal(parseCommentCommand('Looks good to me!').isCommand, false);
        assert.equal(parseCommentCommand('Can someone run a review?').isCommand, false);
        assert.equal(parseCommentCommand('').isCommand, false);
        assert.equal(parseCommentCommand(null).isCommand, false);
        assert.equal(parseCommentCommand(undefined).isCommand, false);
      });
    });

    describe('extractCommenterIdentity', () => {
      it('extracts identity from parsed eventInfo object', () => {
        const identity = extractCommenterIdentity({
          commentUser: 'octocat',
          commentAuthorAssociation: 'COLLABORATOR',
        });
        assert.equal(identity.username, 'octocat');
        assert.equal(identity.association, 'COLLABORATOR');
      });

      it('extracts identity from raw GitHub webhook payload', () => {
        const identity = extractCommenterIdentity({
          comment: {
            user: { login: 'mona' },
            author_association: 'MEMBER',
          },
        });
        assert.equal(identity.username, 'mona');
        assert.equal(identity.association, 'MEMBER');
      });

      it('returns safe fallback values for missing or invalid inputs', () => {
        assert.deepEqual(extractCommenterIdentity(null), { username: 'unknown', association: null });
        assert.deepEqual(extractCommenterIdentity({}), { username: 'unknown', association: null });
      });
    });

    describe('isAuthorizedCommenter & getCommenterAuthorization', () => {
      it('authorizes OWNER, MEMBER, and COLLABORATOR associations', () => {
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'OWNER' } }), true);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'MEMBER' } }), true);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'COLLABORATOR' } }), true);

        const info = getCommenterAuthorization({ comment: { author_association: 'MEMBER', user: { login: 'alice' } } });
        assert.equal(info.authorized, true);
        assert.equal(info.association, 'MEMBER');
        assert.equal(info.username, 'alice');
        assert.match(info.reason, /authorized/i);
      });

      it('denies CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, NONE, and missing associations', () => {
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'CONTRIBUTOR' } }), false);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'FIRST_TIME_CONTRIBUTOR' } }), false);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'FIRST_TIMER' } }), false);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: 'NONE' } }), false);
        assert.equal(isAuthorizedCommenter({ comment: { author_association: null } }), false);
        assert.equal(isAuthorizedCommenter({}), false);
        assert.equal(isAuthorizedCommenter(null), false);

        const info = getCommenterAuthorization({ comment: { author_association: 'CONTRIBUTOR', user: { login: 'external-dev' } } });
        assert.equal(info.authorized, false);
        assert.equal(info.association, 'CONTRIBUTOR');
        assert.equal(info.username, 'external-dev');
        assert.match(info.reason, /not authorized/i);
      });

      it('authorizes commenters when passed parsed eventInfo object directly', () => {
        const eventInfo = {
          commentAuthorAssociation: 'MEMBER',
          commentUser: 'reviewer',
        };
        assert.equal(isAuthorizedCommenter(eventInfo), true);

        const unauthorizedEventInfo = {
          commentAuthorAssociation: 'CONTRIBUTOR',
          commentUser: 'external-dev',
        };
        assert.equal(isAuthorizedCommenter(unauthorizedEventInfo), false);
      });

      it('authorizes commenters in allowedUsers list regardless of association', () => {
        const payload = { comment: { author_association: 'NONE', user: { login: 'trusted-bot' } } };
        assert.equal(isAuthorizedCommenter(payload, { allowedUsers: ['trusted-bot'] }), true);
        assert.equal(isAuthorizedCommenter(payload, { allowedUsers: ['someone-else'] }), false);
      });

      it('supports custom allowedAssociations', () => {
        const payload = { comment: { author_association: 'CONTRIBUTOR', user: { login: 'bob' } } };
        assert.equal(isAuthorizedCommenter(payload, { allowedAssociations: ['CONTRIBUTOR', 'OWNER'] }), true);
      });
    });

    describe('Visual Lifecycle Management & Comment Helpers', () => {
      it('addCommentReaction maps reaction names and emojis and invokes gh api', async () => {
        const executed = [];
        const mockExecGh = async (args) => {
          executed.push(args);
          return JSON.stringify({ id: 101, content: 'eyes' });
        };

        const res = await addCommentReaction({
          repo: 'xpepper/pr-review-gemini',
          commentId: 12345,
          reaction: 'eyes',
          execGhFn: mockExecGh,
        });

        assert.equal(res.success, true);
        assert.deepEqual(executed[0], [
          'api',
          '--method',
          'POST',
          'repos/xpepper/pr-review-gemini/issues/comments/12345/reactions',
          '-f',
          'content=eyes',
        ]);
      });

      it('addCommentReaction maps emojis (👀, 🚀, 👍, 😕, 🎉) to GitHub API names', async () => {
        const executed = [];
        const mockExecGh = async (args) => {
          executed.push(args);
          return JSON.stringify({ id: 102 });
        };

        await addCommentReaction({ repo: 'owner/repo', commentId: 1, reaction: '👀', execGhFn: mockExecGh });
        assert.equal(executed[0][5], 'content=eyes');

        await addCommentReaction({ repo: 'owner/repo', commentId: 1, reaction: '🚀', execGhFn: mockExecGh });
        assert.equal(executed[1][5], 'content=rocket');

        await addCommentReaction({ repo: 'owner/repo', commentId: 1, reaction: '👍', execGhFn: mockExecGh });
        assert.equal(executed[2][5], 'content=+1');

        await addCommentReaction({ repo: 'owner/repo', commentId: 1, reaction: '😕', execGhFn: mockExecGh });
        assert.equal(executed[3][5], 'content=confused');

        await addCommentReaction({ repo: 'owner/repo', commentId: 1, reaction: '🎉', execGhFn: mockExecGh });
        assert.equal(executed[4][5], 'content=hooray');
      });

      it('addCommentReaction handles errors gracefully without throwing', async () => {
        const mockFailingGh = async () => {
          throw new Error('API Rate limit or network down');
        };

        const res = await addCommentReaction({
          repo: 'owner/repo',
          commentId: 1,
          reaction: 'eyes',
          execGhFn: mockFailingGh,
        });

        assert.equal(res.success, false);
        assert.match(res.error, /API Rate limit/);
      });

      it('postIssueComment posts comment reply via gh api', async () => {
        const executed = [];
        const mockExecGh = async (args) => {
          executed.push(args);
          return JSON.stringify({ id: 999 });
        };

        const res = await postIssueComment({
          repo: 'owner/repo',
          prNumber: 42,
          body: 'Hello world comment',
          execGhFn: mockExecGh,
        });

        assert.equal(res.success, true);
        assert.deepEqual(executed[0], [
          'api',
          '--method',
          'POST',
          'repos/owner/repo/issues/42/comments',
          '-f',
          'body=Hello world comment',
        ]);
      });

      it('formatUnauthorizedReply formats friendly denial notice with username and association', () => {
        const text = formatUnauthorizedReply({
          username: 'external-contributor',
          association: 'FIRST_TIME_CONTRIBUTOR',
          command: '/gem-review',
        });

        assert.match(text, /@external-contributor/);
        assert.match(text, /FIRST_TIME_CONTRIBUTOR/);
        assert.match(text, /collaborators, members, or owners/i);
        assert.match(text, /\/gem-review/);
      });

      it('formatHelpReply formats comprehensive markdown help guide', () => {
        const text = formatHelpReply();
        assert.match(text, /\/gem-review/);
        assert.match(text, /--quick/);
        assert.match(text, /--balanced/);
        assert.match(text, /--full/);
        assert.match(text, /--deep/);
        assert.match(text, /--incremental/);
        assert.match(text, /--role/);
        assert.match(text, /--verify/);
      });

      it('formatCompletionReply formats concise completion summary', () => {
        const text = formatCompletionReply({
          qualityGateResult: { verdict: 'PASS', passed: true, totalFindings: 3, blockingCount: 0 },
          ciEnv: { mode: 'quick', incremental: true, failOn: 'P1' },
        });

        assert.match(text, /Gem PR Review Complete/i);
        assert.match(text, /PASS/);
        assert.match(text, /quick/);
        assert.match(text, /incremental/);
        assert.match(text, /3 detected/);
      });

      it('formatCompletionReply formats failure summary when verification fails', () => {
        const text = formatCompletionReply({
          qualityGateResult: { verdict: 'PASS', passed: true, totalFindings: 0, blockingCount: 0 },
          ciEnv: { mode: 'balanced', incremental: false, failOn: 'P1' },
          verificationResult: { status: 'failed', profile: 'test', error: 'Test suite failed with exit code 1' },
        });

        assert.match(text, /FAIL/);
        assert.match(text, /Failed verification/);
        assert.match(text, /Test suite failed with exit code 1/);
      });
    });

    describe('formatCiSummary', () => {
      const mockQualityPass = { verdict: 'PASS', passed: true, totalFindings: 0, blockingCount: 0, blockingFindings: [] };
      const mockQualityFail = {
        verdict: 'FAIL',
        passed: false,
        totalFindings: 1,
        blockingCount: 1,
        blockingFindings: [{ severity: 'P1', filePath: 'src/index.js', line: 10, title: 'Bug' }],
      };
      const ciEnv = { mode: 'balanced', incremental: false, failOn: 'P1', action: 'publish' };

      it('displays passing banner when quality gate passes and no verification requested', () => {
        const summary = formatCiSummary({ qualityGateResult: mockQualityPass, ciEnv });
        assert.match(summary, /## ✅ AI Code Review Passed/);
        assert.match(summary, /- \*\*Verdict\*\*: `PASS`/);
      });

      it('displays passing banner when both quality gate and verification pass', () => {
        const summary = formatCiSummary({
          qualityGateResult: mockQualityPass,
          ciEnv,
          verificationResult: { status: 'passed', profile: 'test' },
        });
        assert.match(summary, /## ✅ AI Code Review Passed/);
        assert.match(summary, /- \*\*Detached Verification \(test\)\*\*: `PASSED`/);
      });

      it('displays verification failed banner when quality gate passes but verification fails', () => {
        const summary = formatCiSummary({
          qualityGateResult: mockQualityPass,
          ciEnv,
          verificationResult: { status: 'failed', profile: 'test' },
        });
        assert.match(summary, /## ❌ Detached Worktree Verification Failed/);
        assert.match(summary, /- \*\*Detached Verification \(test\)\*\*: `FAILED`/);
      });

      it('displays quality gate failed banner when review fails but verification passes', () => {
        const summary = formatCiSummary({
          qualityGateResult: mockQualityFail,
          ciEnv,
          verificationResult: { status: 'passed', profile: 'test' },
        });
        assert.match(summary, /## ❌ AI Code Review Failed Quality Gate/);
        assert.match(summary, /### 🚫 Blocking Issues/);
      });

      it('displays combined failure banner when both quality gate and verification fail', () => {
        const summary = formatCiSummary({
          qualityGateResult: mockQualityFail,
          ciEnv,
          verificationResult: { status: 'failed', profile: 'test' },
        });
        assert.match(summary, /## ❌ AI Code Review and Verification Failed/);
      });
    });

    describe('isVerificationPassed', () => {
      it('returns true when verificationResult is null or undefined (no verification requested)', () => {
        assert.equal(isVerificationPassed(null), true);
        assert.equal(isVerificationPassed(undefined), true);
      });

      it('returns true when verification status is passed', () => {
        assert.equal(isVerificationPassed({ status: 'passed', profile: 'test' }), true);
      });

      it('returns false when verification status is failed or skipped', () => {
        assert.equal(isVerificationPassed({ status: 'failed', profile: 'test' }), false);
        assert.equal(isVerificationPassed({ status: 'skipped', profile: 'test' }), false);
      });
    });
  });
