import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  parseEventPayload,
  resolveCiEnvironment,
  evaluateCiQualityGate,
  evaluateLensExecution,
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
  formatResolveCompletionReply,
  runResolveCommand,
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

    it('resolves guidelines_path from INPUT_GUIDELINES_PATH or options (Increment 19)', () => {
      const res1 = resolveCiEnvironment({}, { INPUT_GUIDELINES_PATH: '.github/custom-rules.md' });
      assert.equal(res1.guidelinesPath, '.github/custom-rules.md');

      const res2 = resolveCiEnvironment({ guidelinesPath: 'docs/guidelines.md' }, {});
      assert.equal(res2.guidelinesPath, 'docs/guidelines.md');

      const res3 = resolveCiEnvironment({ guidelines_path: 'docs/from_snake_case.md' }, {});
      assert.equal(res3.guidelinesPath, 'docs/from_snake_case.md');

      const res4 = resolveCiEnvironment({ review_guidelines_path: 'docs/from_review_path.md' }, {});
      assert.equal(res4.guidelinesPath, 'docs/from_review_path.md');
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

  describe('evaluateLensExecution', () => {
    const plan = [{ lensId: 'correctness' }, { lensId: 'security' }];

    it('reports ok when no planned lens errored', () => {
      const result = evaluateLensExecution({ subagentPlan: plan, errors: [] });

      assert.equal(result.status, 'ok');
      assert.equal(result.failedCount, 0);
      assert.equal(result.totalCount, 2);
      assert.deepEqual(result.failedLenses, []);
    });

    it('reports partial when only some planned lenses errored', () => {
      const result = evaluateLensExecution({
        subagentPlan: plan,
        errors: [{ lensId: 'security', error: new Error('quota exceeded') }],
      });

      assert.equal(result.status, 'partial');
      assert.equal(result.failedCount, 1);
      assert.deepEqual(result.failedLenses, ['security']);
    });

    it('reports failed when every planned lens errored', () => {
      const result = evaluateLensExecution({
        subagentPlan: plan,
        errors: [
          { lensId: 'correctness', error: new Error('spawn copilot ENOENT') },
          { lensId: 'security', error: new Error('spawn copilot ENOENT') },
        ],
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.failedCount, 2);
      assert.deepEqual(result.failedLenses, ['correctness', 'security']);
    });

    it('reports ok when the review planned no lenses', () => {
      const result = evaluateLensExecution({});

      assert.equal(result.status, 'ok');
      assert.equal(result.totalCount, 0);
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
      const requiredInputs = ['github_token', 'copilot_token', 'pr_number', 'mode', 'fail_on', 'incremental', 'action', 'select', 'guidelines_path'];
      for (const input of requiredInputs) {
        assert.match(content, new RegExp(`\\b${input}:`), `action.yml must define input '${input}'`);
      }

      // Verify all required outputs
      const requiredOutputs = ['verdict', 'findings_count', 'blocking_count', 'summary'];
      for (const output of requiredOutputs) {
        assert.match(content, new RegExp(`\\b${output}:`), `action.yml must define output '${output}'`);
      }
    });

    it('owns pinned Copilot CLI bootstrap without exposing its credential to setup steps', () => {
      const content = fs.readFileSync(path.resolve('action.yml'), 'utf8');
      const authStep = content.indexOf('- name: Require Copilot authentication');
      const actionPathStep = content.indexOf('- name: Resolve Action path for dependency cache');
      const nodeStep = content.indexOf('- name: Set up Node.js for Copilot CLI');
      const staleCleanupStep = content.indexOf('- name: Clean stale GitHub Copilot CLI installs');
      const installStep = content.indexOf('- name: Install GitHub Copilot CLI');
      const reviewStep = content.indexOf('- name: Run Gem PR Review');
      const cleanupStep = content.indexOf('- name: Clean up GitHub Copilot CLI');

      assert.match(content, /copilot_token:\s*\n\s*description:[^\n]+\n\s*required:\s*true/);
      assert.ok(authStep >= 0 && authStep < actionPathStep && actionPathStep < nodeStep, 'authentication and path normalization must precede setup');
      assert.ok(nodeStep < staleCleanupStep && staleCleanupStep < installStep && installStep < reviewStep && reviewStep < cleanupStep, 'bootstrap and cleanup must surround review execution');
      assert.match(content.slice(authStep, nodeStep), /COPILOT_GITHUB_TOKEN:\s*\${{\s*inputs\.copilot_token\s*}}/);
      assert.doesNotMatch(content, /allow_legacy_copilot_token|env\.COPILOT_GITHUB_TOKEN/);
      assert.match(content.slice(actionPathStep, nodeStep), /id:\s*action_path/);
      assert.match(content.slice(actionPathStep, nodeStep), /set -euo pipefail/);
      assert.match(content.slice(actionPathStep, nodeStep), /source_path="\$\{\{\s*github\.action_path\s*\}\}"/);
      assert.match(content.slice(actionPathStep, nodeStep), /\[ ! -d "\$source_path" \]/);
      assert.match(content.slice(actionPathStep, nodeStep), /pwd -P/);
      assert.match(content.slice(nodeStep, installStep), /uses:\s*actions\/setup-node@v6/);
      assert.match(content.slice(nodeStep, installStep), /node-version:\s*['"]22['"]/);
      assert.match(content.slice(nodeStep, installStep), /cache:\s*npm/);
      assert.match(content.slice(nodeStep, installStep), /cache-dependency-path:\s*\$\{\{\s*steps\.action_path\.outputs\.root\s*\}\}\/\.github\/copilot-cli\/package-lock\.json/);
      assert.match(content.slice(nodeStep, installStep), /COPILOT_GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(nodeStep, installStep), /GH_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(nodeStep, installStep), /GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(staleCleanupStep, installStep), /set -euo pipefail/);
      assert.match(content.slice(staleCleanupStep, installStep), /bash "\$\{\{\s*steps\.action_path\.outputs\.root\s*\}\}\/scripts\/cleanup-copilot-install\.sh" prune-stale/);
      assert.match(content.slice(staleCleanupStep, installStep), /COPILOT_GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(staleCleanupStep, installStep), /GH_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(staleCleanupStep, installStep), /GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(installStep, reviewStep), /npm ci --prefix "\$install_root"/);
      assert.match(content.slice(installStep, reviewStep), /--ignore-scripts/);
      assert.doesNotMatch(content.slice(installStep, reviewStep), /npm install --global/);
      assert.match(content.slice(installStep, reviewStep), /id:\s*install_copilot/);
      assert.match(content.slice(installStep, reviewStep), /bash "\$\{\{\s*steps\.action_path\.outputs\.root\s*\}\}\/scripts\/cleanup-copilot-install\.sh" initialize-install "\$install_root" "\$created_at";/);
      assert.match(content.slice(installStep, reviewStep), /echo "install_root=\$install_root" >> "\$GITHUB_OUTPUT"/);
      assert.match(content.slice(installStep, reviewStep), /COPILOT_GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(installStep, reviewStep), /GH_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(installStep, reviewStep), /GITHUB_TOKEN:\s*['"]{2}/);
      assert.match(content.slice(reviewStep), /COPILOT_GITHUB_TOKEN:\s*\${{\s*inputs\.copilot_token\s*}}/);
      assert.match(content.slice(reviewStep), /COPILOT_INSTALL_ROOT:\s*\${{\s*steps\.install_copilot\.outputs\.install_root\s*}}/);
      assert.match(content.slice(reviewStep), /bash "\$\{\{\s*steps\.action_path\.outputs\.root\s*\}\}\/scripts\/cleanup-copilot-install\.sh" activate-lease "\$COPILOT_INSTALL_ROOT"\n/);
      assert.doesNotMatch(content, /BASHPID/, 'lease owners must come from the invoking shell, not a caller-supplied PID');
      assert.match(content.slice(cleanupStep), /if:\s*\$\{\{\s*always\(\).*steps\.install_copilot\.outcome.*skipped/);
      assert.match(content.slice(cleanupStep), /COPILOT_INSTALL_ROOT:\s*\$\{\{\s*steps\.install_copilot\.outputs\.install_root\s*\}\}/);
      assert.match(content.slice(cleanupStep), /INSTALL_OUTCOME:\s*\$\{\{\s*steps\.install_copilot\.outcome\s*\}\}/);
      assert.match(content.slice(cleanupStep), /bash "\$\{\{\s*steps\.action_path\.outputs\.root\s*\}\}\/scripts\/cleanup-copilot-install\.sh" cleanup-current "\$COPILOT_INSTALL_ROOT"$/m);

      const lockfilePath = path.resolve('.github/copilot-cli/package-lock.json');
      assert.equal(fs.existsSync(lockfilePath), true, 'Copilot CLI lockfile must be committed');
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
      assert.equal(lockfile.lockfileVersion, 3);
      assert.equal(lockfile.packages['node_modules/@github/copilot'].version, '1.0.83');
      for (const [packagePath, packageMetadata] of Object.entries(lockfile.packages)) {
        if (packagePath === '') continue;
        assert.match(packageMetadata.resolved, /^https:\/\/registry\.npmjs\.org\//);
        assert.match(packageMetadata.integrity, /^sha512-/);
      }
    });

    it('removes only stale owned Copilot CLI installations and rejects unsafe cleanup paths', () => {
      const cleanupScript = path.resolve('scripts/cleanup-copilot-install.sh');
      assert.equal(fs.existsSync(cleanupScript), true, 'Copilot CLI cleanup script must exist');

      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-cleanup-'));
      const runnerTemp = path.join(fixtureRoot, 'runner-temp');
      const outside = path.join(fixtureRoot, 'outside');
      const retentionSeconds = 7 * 24 * 60 * 60;
      const now = Math.floor(Date.now() / 1000);
      const processStartTime = spawnSync(
        'ps',
        ['-o', 'lstart=', '-p', String(process.pid)],
        { encoding: 'utf8' },
      ).stdout.trim();
      const makeOwnedInstall = (name, createdAt, leasePid = '99999999') => {
        const installRoot = path.join(runnerTemp, name);
        const leaseStartedAt = leasePid === process.pid ? processStartTime : 'not-running';
        fs.mkdirSync(installRoot, { recursive: true });
        fs.chmodSync(installRoot, 0o700);
        fs.writeFileSync(
          path.join(installRoot, '.gem-pr-review-copilot-owned'),
          `version=2\ninstall_id=${name}\ncreated_at=${createdAt}\n`,
        );
        fs.writeFileSync(
          path.join(installRoot, '.gem-pr-review-copilot-lease'),
          `pid=${leasePid}\nstarted_at=${leaseStartedAt}\n`,
        );
        return installRoot;
      };

      try {
        fs.mkdirSync(runnerTemp, { recursive: true });
        fs.chmodSync(runnerTemp, 0o700);
        fs.mkdirSync(outside);
        const activeInstall = makeOwnedInstall('gem-pr-review-copilot.active', now, process.pid);
        const oldActiveInstall = makeOwnedInstall('gem-pr-review-copilot.active-old', now - retentionSeconds - 1, process.pid);
        const staleInstall = makeOwnedInstall('gem-pr-review-copilot.stale', now - retentionSeconds - 1);
        const missingMarker = path.join(runnerTemp, 'gem-pr-review-copilot.unowned');
        fs.mkdirSync(missingMarker);
        fs.chmodSync(missingMarker, 0o700);
        const malformedMarker = path.join(runnerTemp, 'gem-pr-review-copilot.malformed');
        fs.mkdirSync(malformedMarker);
        fs.chmodSync(malformedMarker, 0o700);
        fs.writeFileSync(path.join(malformedMarker, '.gem-pr-review-copilot-owned'), 'version=2\ncreated_at=invalid\n');
        const oversizedTimestamp = path.join(runnerTemp, 'gem-pr-review-copilot.oversized');
        fs.mkdirSync(oversizedTimestamp);
        fs.chmodSync(oversizedTimestamp, 0o700);
        fs.writeFileSync(
          path.join(oversizedTimestamp, '.gem-pr-review-copilot-owned'),
          'version=2\ninstall_id=gem-pr-review-copilot.oversized\ncreated_at=999999999999\n',
        );
        const malformedLease = makeOwnedInstall('gem-pr-review-copilot.bad-lease', now - retentionSeconds - 1);
        fs.writeFileSync(path.join(malformedLease, '.gem-pr-review-copilot-lease'), 'pid=invalid\n');
        const interruptedInstall = makeOwnedInstall('gem-pr-review-copilot.interrupted', now - retentionSeconds - 1);
        fs.rmSync(path.join(interruptedInstall, '.gem-pr-review-copilot-lease'));
        const transplantedMarker = makeOwnedInstall('gem-pr-review-copilot.transplanted', now - retentionSeconds - 1);
        fs.writeFileSync(
          path.join(transplantedMarker, '.gem-pr-review-copilot-owned'),
          'version=2\ninstall_id=gem-pr-review-copilot.someone-else\ncreated_at=1\n',
        );
        const insecureInstall = makeOwnedInstall('gem-pr-review-copilot.insecure', now - retentionSeconds - 1);
        fs.chmodSync(insecureInstall, 0o755);
        const symlinkInstall = path.join(runnerTemp, 'gem-pr-review-copilot.symlink');
        fs.symlinkSync(outside, symlinkInstall);

        const pruneResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(pruneResult.status, 0, pruneResult.stderr);
        assert.equal(fs.existsSync(activeInstall), true, 'must preserve a concurrent active installation');
        assert.equal(fs.existsSync(oldActiveInstall), true, 'must preserve an active installation regardless of its age');
        assert.equal(fs.existsSync(staleInstall), false, 'must remove stale owned installations');
        assert.equal(fs.existsSync(missingMarker), true, 'must preserve directories without the ownership marker');
        assert.equal(fs.existsSync(malformedMarker), true, 'must preserve malformed ownership metadata');
        assert.equal(fs.existsSync(oversizedTimestamp), true, 'must preserve oversized timestamp metadata');
        assert.equal(fs.existsSync(malformedLease), true, 'must preserve malformed lease metadata');
        assert.equal(fs.existsSync(interruptedInstall), false, 'must reclaim an interrupted initialization with a valid ownership record but no lease');
        assert.equal(fs.existsSync(transplantedMarker), true, 'must preserve an installation with ownership metadata copied from another directory');
        assert.equal(fs.existsSync(insecureInstall), true, 'must preserve non-private installation directories');
        assert.match(pruneResult.stderr, /without a valid ownership marker/, 'must classify oversized timestamps as invalid metadata');
        assert.match(pruneResult.stderr, /invalid path/, 'must report skipped non-private installation directories');
        assert.doesNotMatch(pruneResult.stderr, /future ownership metadata/, 'must reject oversized timestamps before age evaluation');
        assert.equal(fs.lstatSync(symlinkInstall).isSymbolicLink(), true, 'must not follow symlinked installation paths');
        assert.equal(fs.existsSync(outside), true, 'must not remove a symlink target');

        const lockedStaleInstall = makeOwnedInstall('gem-pr-review-copilot.locked', now - retentionSeconds - 1);
        const installLock = path.join(runnerTemp, '.gem-pr-review-copilot-lock.gem-pr-review-copilot.locked');
        fs.mkdirSync(installLock, { mode: 0o700 });
        const lockedPruneResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(lockedPruneResult.status, 0, lockedPruneResult.stderr);
        assert.equal(fs.existsSync(lockedStaleInstall), true, 'must preserve an installation while another invocation owns its mutation lock');
        assert.match(lockedPruneResult.stderr, /being changed by another invocation/);

        const staleLockInstall = makeOwnedInstall('gem-pr-review-copilot.stale-lock', now - retentionSeconds - 1);
        const staleLock = path.join(runnerTemp, '.gem-pr-review-copilot-lock.gem-pr-review-copilot.stale-lock');
        fs.mkdirSync(staleLock, { mode: 0o700 });
        fs.writeFileSync(path.join(staleLock, 'pid'), 'pid=99999999\nstarted_at=not-running\n');
        const staleLockPruneResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(staleLockPruneResult.status, 0, staleLockPruneResult.stderr);
        assert.equal(fs.existsSync(staleLockInstall), false, 'must reclaim a stale mutation lock before pruning its stale installation');
        assert.equal(fs.existsSync(staleLock), false, 'must remove reclaimed lock metadata');

        const abandonedQuarantine = fs.mkdtempSync(path.join(runnerTemp, '.gem-pr-review-copilot-quarantine.'));
        fs.chmodSync(abandonedQuarantine, 0o700);
        fs.utimesSync(abandonedQuarantine, now - retentionSeconds - 1, now - retentionSeconds - 1);
        const quarantinePruneResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(quarantinePruneResult.status, 0, quarantinePruneResult.stderr);
        assert.equal(fs.existsSync(abandonedQuarantine), false, 'must remove stale abandoned cleanup quarantines');

        const reusedPidInstall = makeOwnedInstall('gem-pr-review-copilot.reused-pid', now - retentionSeconds - 1, process.pid);
        fs.writeFileSync(
          path.join(reusedPidInstall, '.gem-pr-review-copilot-lease'),
          `pid=${process.pid}\nstarted_at=not-the-current-process\n`,
        );
        const reusedPidPruneResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(reusedPidPruneResult.status, 0, reusedPidPruneResult.stderr);
        assert.equal(fs.existsSync(reusedPidInstall), false, 'must not treat a reused PID as an active lease');

        const validCurrentInstall = makeOwnedInstall('gem-pr-review-copilot.current', now);
        const environmentRootResult = spawnSync('bash', [cleanupScript, 'cleanup-current'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp, COPILOT_INSTALL_ROOT: validCurrentInstall },
        });
        assert.equal(environmentRootResult.status, 1, 'must require an explicit install root argument');
        assert.equal(fs.existsSync(validCurrentInstall), true, 'must not clean an install named only by the environment');
        const emptyRootResult = spawnSync('bash', [cleanupScript, 'cleanup-current', ''], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(emptyRootResult.status, 1, 'must fail closed for an empty install root');
        const cleanupResult = spawnSync('bash', [cleanupScript, 'cleanup-current', validCurrentInstall], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(cleanupResult.status, 0, cleanupResult.stderr);
        assert.equal(fs.existsSync(validCurrentInstall), false, 'must clean the current owned installation');

        const activeCurrentInstall = makeOwnedInstall('gem-pr-review-copilot.current-active', now, process.pid);
        const activeCleanupResult = spawnSync('bash', [cleanupScript, 'cleanup-current', activeCurrentInstall], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: runnerTemp },
        });
        assert.equal(activeCleanupResult.status, 1, 'must fail closed for an active current installation');
        assert.equal(fs.existsSync(activeCurrentInstall), true, 'must preserve an active current installation');

        const traversalRoot = path.join(runnerTemp, 'gem-pr-review-copilot.traversal');
        fs.mkdirSync(traversalRoot);
        const traversalResult = spawnSync(
          'bash',
          [cleanupScript, 'cleanup-current', path.join(traversalRoot, '..', '..', 'outside')],
          { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: runnerTemp } },
        );
        assert.equal(traversalResult.status, 1, 'must fail closed for a traversal cleanup path');
        assert.equal(fs.existsSync(outside), true, 'must preserve traversal targets outside RUNNER_TEMP');

        const sharedRunnerTemp = path.join(fixtureRoot, 'shared-runner-temp');
        fs.mkdirSync(sharedRunnerTemp);
        fs.chmodSync(sharedRunnerTemp, 0o777);
        const sharedRootResult = spawnSync('bash', [cleanupScript, 'prune-stale'], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: sharedRunnerTemp },
        });
        assert.equal(sharedRootResult.status, 1, 'must fail closed for a shared RUNNER_TEMP root');
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });

    it('binds Copilot CLI install leases to the invoking shell instead of a caller-supplied PID', () => {
      const cleanupScript = path.resolve('scripts/cleanup-copilot-install.sh');
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-lease-'));
      const runnerTemp = path.join(fixtureRoot, 'runner-temp');
      const installRoot = path.join(runnerTemp, 'gem-pr-review-copilot.lease');
      const leaseMarker = path.join(installRoot, '.gem-pr-review-copilot-lease');
      // The wrapper outlives the script, like an Actions step shell, and reports its own PID.
      const runFromShell = (...args) => spawnSync(
        'bash',
        ['-c', 'bash "$0" "$@"; status=$?; echo "shell_pid=$$"; exit "$status"', cleanupScript, ...args],
        { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: runnerTemp } },
      );
      const shellPid = (result) => result.stdout.match(/^shell_pid=(\d+)$/m)?.[1];
      const leasePid = () => fs.readFileSync(leaseMarker, 'utf8').match(/^pid=(\d+)$/m)?.[1];

      try {
        fs.mkdirSync(installRoot, { recursive: true });
        fs.chmodSync(runnerTemp, 0o700);
        fs.chmodSync(installRoot, 0o700);

        const initializeResult = runFromShell('initialize-install', installRoot, String(Math.floor(Date.now() / 1000)));
        assert.equal(initializeResult.status, 0, initializeResult.stderr);
        assert.equal(leasePid(), shellPid(initializeResult), 'initialization must lease the install to the invoking shell');

        const activateResult = runFromShell('activate-lease', installRoot);
        assert.equal(activateResult.status, 0, activateResult.stderr);
        assert.equal(leasePid(), shellPid(activateResult), 'lease activation must move the lease to the invoking shell');

        const leaseBeforeSpoof = fs.readFileSync(leaseMarker, 'utf8');
        const spoofedResult = runFromShell('activate-lease', installRoot, '1');
        assert.equal(spoofedResult.status, 1, 'must reject a caller-supplied lease PID');
        assert.match(spoofedResult.stderr, /Unexpected Copilot CLI cleanup arguments/);
        assert.equal(fs.readFileSync(leaseMarker, 'utf8'), leaseBeforeSpoof, 'a rejected lease request must not change the lease');
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });

    it('cleans up the published Copilot CLI install root and fails closed when a successful install published none', () => {
      const content = fs.readFileSync(path.resolve('action.yml'), 'utf8');
      const cleanupStep = content.indexOf('- name: Clean up GitHub Copilot CLI');
      // The cleanup step is the last Action step, so its run block extends to the end of the file.
      const cleanupRun = content.slice(cleanupStep).split('run: |\n')[1]
        .split('\n')
        .map((line) => line.replace(/^ {8}/, ''))
        .join('\n')
        .replaceAll('${{ steps.action_path.outputs.root }}', path.resolve('.'));
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-cleanup-step-'));
      const runnerTemp = path.join(fixtureRoot, 'runner-temp');
      const installRoot = path.join(runnerTemp, 'gem-pr-review-copilot.step');
      const runCleanupStep = (publishedRoot, installOutcome) => spawnSync('bash', ['-c', cleanupRun], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: runnerTemp, COPILOT_INSTALL_ROOT: publishedRoot, INSTALL_OUTCOME: installOutcome },
      });

      try {
        fs.mkdirSync(installRoot, { recursive: true });
        fs.chmodSync(runnerTemp, 0o700);
        fs.chmodSync(installRoot, 0o700);
        fs.writeFileSync(
          path.join(installRoot, '.gem-pr-review-copilot-owned'),
          `version=2\ninstall_id=gem-pr-review-copilot.step\ncreated_at=${Math.floor(Date.now() / 1000)}\n`,
        );
        fs.writeFileSync(path.join(installRoot, '.gem-pr-review-copilot-lease'), 'pid=99999999\nstarted_at=not-running\n');

        const failedInstallResult = runCleanupStep('', 'failure');
        assert.equal(failedInstallResult.status, 0, failedInstallResult.stdout + failedInstallResult.stderr);

        const missingRootResult = runCleanupStep('', 'success');
        assert.equal(missingRootResult.status, 1, 'must fail closed when a successful install published no root');
        assert.match(missingRootResult.stdout, /::error title=Gem PR Review::Copilot CLI install root is unavailable\./);
        assert.equal(fs.existsSync(installRoot), true);

        const cleanupResult = runCleanupStep(installRoot, 'success');
        assert.equal(cleanupResult.status, 0, cleanupResult.stdout + cleanupResult.stderr);
        assert.equal(fs.existsSync(installRoot), false, 'must clean the published install root');
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });

    it('does not follow a lease marker swapped for a symlink while the lease is refreshed', () => {
      const cleanupScript = path.resolve('scripts/cleanup-copilot-install.sh');
      const realPs = spawnSync('bash', ['-c', 'command -v ps'], { encoding: 'utf8' }).stdout.trim();
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-lease-swap-'));
      const runnerTemp = path.join(fixtureRoot, 'runner-temp');
      const shimBin = path.join(fixtureRoot, 'bin');
      const psCalls = path.join(fixtureRoot, 'ps-calls');
      const runFromShell = (env, ...args) => spawnSync(
        'bash',
        ['-c', 'bash "$0" "$@"; status=$?; echo "shell_pid=$$"; exit "$status"', cleanupScript, ...args],
        { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: runnerTemp, ...env } },
      );

      try {
        fs.mkdirSync(runnerTemp);
        fs.chmodSync(runnerTemp, 0o700);
        // activate-lease looks up the lock owner and then the lease owner with ps; the second
        // lookup happens after the lease marker was validated and before it is written.
        fs.mkdirSync(shimBin);
        fs.writeFileSync(
          path.join(shimBin, 'ps'),
          [
            '#!/usr/bin/env bash',
            `count=$(( $(cat '${psCalls}' 2>/dev/null || echo 0) + 1 ))`,
            `echo "$count" > '${psCalls}'`,
            'if [ "$count" -eq 2 ]; then rm -f "$SWAP_MARKER"; ln -s "$SWAP_TARGET" "$SWAP_MARKER"; fi',
            `exec '${realPs}' "$@"`,
            '',
          ].join('\n'),
          { mode: 0o755 },
        );

        for (const targetKind of ['file', 'directory']) {
          const installRoot = path.join(runnerTemp, `gem-pr-review-copilot.swap-${targetKind}`);
          const leaseMarker = path.join(installRoot, '.gem-pr-review-copilot-lease');
          const swapTarget = path.join(fixtureRoot, `swap-target-${targetKind}`);
          fs.mkdirSync(installRoot);
          fs.chmodSync(installRoot, 0o700);
          if (targetKind === 'file') {
            fs.writeFileSync(swapTarget, 'victim\n');
          } else {
            fs.mkdirSync(swapTarget);
          }
          const initializeResult = runFromShell({}, 'initialize-install', installRoot, String(Math.floor(Date.now() / 1000)));
          assert.equal(initializeResult.status, 0, initializeResult.stderr);

          fs.rmSync(psCalls, { force: true });
          const activateResult = runFromShell(
            { PATH: `${shimBin}${path.delimiter}${process.env.PATH}`, SWAP_MARKER: leaseMarker, SWAP_TARGET: swapTarget },
            'activate-lease',
            installRoot,
          );
          assert.equal(fs.readFileSync(psCalls, 'utf8').trim(), '2', `the ${targetKind} symlink swap must happen inside the lease refresh`);
          if (targetKind === 'file') {
            assert.equal(fs.readFileSync(swapTarget, 'utf8'), 'victim\n', 'must not write lease metadata through a symlinked file');
          } else {
            assert.deepEqual(fs.readdirSync(swapTarget), [], 'must not place lease metadata inside a symlinked directory');
          }
          assert.equal(activateResult.status, 0, activateResult.stderr);
          assert.equal(fs.lstatSync(leaseMarker).isSymbolicLink(), false, `must replace the ${targetKind} symlink with a regular lease marker`);
          assert.match(fs.readFileSync(leaseMarker, 'utf8'), new RegExp(`^pid=${activateResult.stdout.match(/^shell_pid=(\d+)$/m)?.[1]}$`, 'm'));
          assert.deepEqual(
            fs.readdirSync(installRoot).sort(),
            ['.gem-pr-review-copilot-lease', '.gem-pr-review-copilot-owned'],
            'must not leave staged marker files behind',
          );
        }
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  describe('CI Action Runner (scripts/ci-action.mjs)', () => {
    const documentationDiff = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-Old
+New
`;

    it('runs and reports the selected documentation consistency test', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-docs-${Date.now()}.txt`);
      let selectedTest = null;
      let metadataQueries = 0;

      const result = await runCiAction({
        prNumber: 41,
        action: 'dry-run',
        mock: true,
        diffText: documentationDiff,
        execGhFn: async (args) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            metadataQueries += 1;
            return JSON.stringify({
              isCrossRepository: false,
              headRefOid: 'head-sha',
              baseRefOid: 'base-sha',
              baseRefName: 'main',
              author: { login: 'octocat' },
              title: 'Documentation update',
            });
          }
          throw new Error(`Unexpected gh invocation: ${args.join(' ')}`);
        },
        executeDocumentationConsistency: async ({ testFile }) => {
          selectedTest = testFile;
          return { status: 'passed' };
        },
      }, {
        GITHUB_OUTPUT: tmpOut,
      }, silentIo);

      assert.equal(result.exitCode, 0);
      assert.equal(result.documentationConsistency.status, 'passed');
      assert.equal(selectedTest, 'tests/skills.test.mjs');
      assert.equal(metadataQueries, 1);
      assert.match(result.reviewResult.summary, /Documentation Consistency Check.*PASSED/i);
      assert.match(fs.readFileSync(tmpOut, 'utf8'), /documentation_consistency_status=passed/);

      fs.unlinkSync(tmpOut);
    });

    it('falls back to reviewer metadata retrieval when the trust query is incomplete', async () => {
      let metadataQueries = 0;
      const result = await runCiAction({
        prNumber: 42,
        action: 'dry-run',
        mock: true,
        diffText: documentationDiff,
        execGhFn: async (args) => {
          if (args[0] !== 'pr' || args[1] !== 'view') {
            throw new Error(`Unexpected gh invocation: ${args.join(' ')}`);
          }
          metadataQueries += 1;
          if (args.at(-1).includes('isCrossRepository')) {
            return JSON.stringify({ isCrossRepository: false });
          }
          return JSON.stringify({
            headRefOid: 'fallback-head-sha',
            baseRefOid: 'fallback-base-sha',
            baseRefName: 'main',
            author: { login: 'octocat' },
            title: 'Documentation update',
          });
        },
        executeDocumentationConsistency: async () => ({ status: 'passed' }),
      }, {}, silentIo);

      assert.equal(result.exitCode, 0);
      assert.equal(metadataQueries, 2);
      assert.equal(result.documentationConsistency.status, 'passed');
    });

    it('fails CI when the selected documentation consistency test fails', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-docs-fail-${Date.now()}.txt`);

      const result = await runCiAction({
        prNumber: 42,
        action: 'dry-run',
        mock: true,
        diffText: documentationDiff,
        executeDocumentationConsistency: async () => ({ status: 'failed' }),
      }, {
        GITHUB_OUTPUT: tmpOut,
      }, silentIo);

      assert.equal(result.exitCode, 1);
      assert.equal(result.documentationConsistency.status, 'failed');
      assert.match(result.reviewResult.summary, /Documentation Consistency Check.*FAILED/i);
      assert.match(fs.readFileSync(tmpOut, 'utf8'), /verdict=FAIL/);

      fs.unlinkSync(tmpOut);
    });

    it('skips the documentation consistency test for an untrusted fork', async () => {
      let executed = false;
      const result = await runCiAction({
        prNumber: 43,
        action: 'dry-run',
        mock: true,
        diffText: documentationDiff,
        execGhFn: async () => JSON.stringify({ isCrossRepository: true }),
        executeDocumentationConsistency: async () => {
          executed = true;
          return { status: 'passed' };
        },
      }, {}, silentIo);

      assert.equal(result.exitCode, 0);
      assert.equal(result.documentationConsistency.status, 'skipped');
      assert.equal(result.documentationConsistency.reason, 'untrusted_fork');
      assert.equal(executed, false);
      assert.match(result.reviewResult.summary, /SKIPPED.*untrusted fork/i);
    });

    it('skips execution when the selected documentation test changes in the PR', async () => {
      let executed = false;
      const result = await runCiAction({
        prNumber: 44,
        action: 'dry-run',
        mock: true,
        diffText: documentationDiff + `diff --git a/tests/skills.test.mjs b/tests/skills.test.mjs
index 1111111..2222222 100644
--- a/tests/skills.test.mjs
+++ b/tests/skills.test.mjs
@@ -1 +1 @@
-Old
+New
`,
        executeDocumentationConsistency: async () => {
          executed = true;
          return { status: 'passed' };
        },
      }, {}, silentIo);

      assert.equal(result.exitCode, 0);
      assert.equal(result.documentationConsistency.status, 'skipped');
      assert.equal(result.documentationConsistency.reason, 'selected_test_changed');
      assert.equal(executed, false);
    });

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

    it('writes verification_status to GITHUB_OUTPUT distinguishing verification failure from quality gate failure', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-verify-${Date.now()}.txt`);

      const result = await runCiAction({
        prNumber: 44,
        failOn: 'P1',
        action: 'dry-run',
        mock: true,
        mockFindings: [],
        verify: 'test',
        runVerificationFn: async () => ({
          status: 'failed',
          profile: 'test',
          error: 'Tests failed with exit code 1',
        }),
      }, {
        GITHUB_OUTPUT: tmpOut,
      }, silentIo);

      assert.equal(result.exitCode, 1);
      assert.equal(result.qualityGate.passed, true);
      assert.equal(result.qualityGate.blockingCount, 0);
      assert.equal(result.verificationResult?.status, 'failed');

      const outContent = fs.readFileSync(tmpOut, 'utf8');
      assert.match(outContent, /verdict=FAIL/);
      assert.match(outContent, /blocking_count=0/);
      assert.match(outContent, /verification_status=failed/);

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

  describe('lens execution degradation', () => {
    const codeDiff = `diff --git a/src/sample.js b/src/sample.js
index 1111111..2222222 100644
--- a/src/sample.js
+++ b/src/sample.js
@@ -1 +1 @@
-const a = 1;
+const a = 2;
`;
    const emptyReview = '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>';

    const capturingIo = () => {
      const lines = [];
      const push = (msg) => lines.push(String(msg));
      return { lines, io: { log: push, error: push, warn: push } };
    };

    it('fails CI in dry-run when every review lens fails to execute', async () => {
      const tmpOut = path.join(os.tmpdir(), `gh-out-lens-fail-${Date.now()}.txt`);
      const { lines, io } = capturingIo();

      try {
        const result = await runCiAction({
          prNumber: 43,
          action: 'dry-run',
          mock: true,
          diffText: codeDiff,
          runnerFn: async () => {
            throw new Error('Copilot CLI execution failed: spawn copilot ENOENT');
          },
        }, { GITHUB_OUTPUT: tmpOut }, io);

        assert.equal(result.exitCode, 1);
        assert.equal(result.lensExecution.status, 'failed');
        assert.match(fs.readFileSync(tmpOut, 'utf8'), /verdict=FAIL/);
        assert.ok(
          lines.some((l) => /^::error title=Gem PR Review::All \d+ review lens\(es\) failed to execute/.test(l)),
          'emits an error annotation for total lens failure'
        );
      } finally {
        fs.rmSync(tmpOut, { force: true });
      }
    });

    it('warns without failing CI when only some review lenses fail to execute', async () => {
      const { lines, io } = capturingIo();

      const result = await runCiAction({
        prNumber: 44,
        action: 'dry-run',
        mock: true,
        diffText: codeDiff,
        runnerFn: async ({ lens }) => {
          if (lens?.id === 'security') {
            throw new Error('quota exceeded');
          }
          return emptyReview;
        },
      }, {}, io);

      assert.equal(result.exitCode, 0);
      assert.equal(result.lensExecution.status, 'partial');
      assert.deepEqual(result.lensExecution.failedLenses, ['security']);
      assert.ok(
        lines.some((l) => /^::warning title=Gem PR Review::1 of \d+ review lens\(es\) failed to execute: security/.test(l)),
        'emits a warning annotation for partial lens failure'
      );
    });

    it('emits an error annotation when publishing aborts because every lens failed', async () => {
      const { lines, io } = capturingIo();

      const result = await runCiAction({
        prNumber: 45,
        action: 'publish',
        mock: true,
        diffText: codeDiff,
        runnerFn: async ({ lens }) => {
          if (lens?.id === 'security') {
            throw new Error('raw provider failure containing untrusted prompt content');
          }
          const error = new Error('Copilot CLI execution failed: spawn copilot ENOENT');
          error.sanitizedMessage = error.message;
          throw error;
        },
      }, {}, io);

      assert.equal(result.exitCode, 1);
      assert.ok(
        lines.some((l) =>
          /❌ CI Review execution failed: Cannot publish review: All \d+ specialist review subagent\(s\) failed.*spawn copilot ENOENT/s.test(l)
        ),
        'logs the sanitized lens failure cause when publishing aborts'
      );
      assert.ok(
        lines.some((l) =>
          /^::error title=Gem PR Review::CI Review execution failed: Cannot publish review: All \d+ specialist review subagent\(s\) failed.*spawn copilot ENOENT/.test(l)
        ),
        'includes the sanitized lens failure cause in the error annotation'
      );
      assert.doesNotMatch(lines.join('\n'), /raw provider failure containing untrusted prompt content/);
    });

    it('does not write a passing step summary when every lens fails to execute', async () => {
      const tmpSummary = path.join(os.tmpdir(), `gh-summary-lens-fail-${Date.now()}.md`);

      try {
        const result = await runCiAction({
          prNumber: 46,
          action: 'dry-run',
          mock: true,
          diffText: codeDiff,
          runnerFn: async () => {
            throw new Error('Copilot CLI execution failed: spawn copilot ENOENT');
          },
        }, { GITHUB_STEP_SUMMARY: tmpSummary }, silentIo);

        assert.equal(result.exitCode, 1);
        const stepSummary = fs.readFileSync(tmpSummary, 'utf8');
        assert.match(stepSummary, /^## ❌ AI Code Review Lenses Failed to Execute$/m);
        assert.match(stepSummary, /\*\*Verdict\*\*: `FAIL`/);
        assert.match(stepSummary, /\*\*Lens Execution\*\*: `FAILED` \(\d+ of \d+ lenses failed\)/);
        assert.doesNotMatch(stepSummary, /AI Code Review Passed/);
      } finally {
        fs.rmSync(tmpSummary, { force: true });
      }
    });

    it('reports a failed completion reply when every lens fails to execute', () => {
      const reply = formatCompletionReply({
        qualityGateResult: { passed: true, verdict: 'PASS', totalFindings: 0, blockingCount: 0 },
        ciEnv: { mode: 'balanced', failOn: 'P1' },
        lensExecution: { status: 'failed', totalCount: 5, failedCount: 5, failedLenses: [] },
      });

      assert.match(reply, /❌ \*\*Gem PR Review Complete\*\*/);
      assert.match(reply, /\*\*Verdict\*\*: `FAIL` \(Review lenses failed to execute\)/);
    });

    it('keeps a passing completion reply when only some lenses fail', () => {
      const reply = formatCompletionReply({
        qualityGateResult: { passed: true, verdict: 'PASS', totalFindings: 0, blockingCount: 0 },
        ciEnv: { mode: 'balanced', failOn: 'P1' },
        lensExecution: { status: 'partial', totalCount: 5, failedCount: 1, failedLenses: ['security'] },
      });

      assert.match(reply, /✅ \*\*Gem PR Review Complete\*\*/);
      assert.match(reply, /\*\*Verdict\*\*: `PASS` \(Passed\)/);
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
      assert.match(content, /concurrency:\s*\n\s*group:\s*\${{\s*github\.workflow\s*}}-\${{\s*github\.event_name\s*}}-/);
      assert.match(content, /cancel-in-progress:\s*true/);
      assert.match(content, /contains\(github\.event\.comment\.body,\s*['"]\/gem-review['"]\)/);
      assert.match(content, /contains\(github\.event\.comment\.body,\s*['"]\/gem-pr-review['"]\)/);
      assert.doesNotMatch(content, /gh pr checkout/, 'Must not check out untrusted PR head to avoid pwn request vulnerability');
      assert.match(content, /uses:\s*actions\/github-script@v8/);
      assert.match(content, /context\.payload\.pull_request\.base\.sha/);
      assert.match(content, /github\.rest\.pulls\.get/);
      assert.match(content, /return pull\.base\.sha/);
      assert.match(content, /uses:\s*actions\/checkout@v7/);
      assert.match(content, /ref:\s*\${{\s*steps\.base\.outputs\.result\s*}}/);
      assert.match(content, /id:\s*action-contract-detector-source/);
      assert.match(content, /detector_sha256=6b6616a29cd927fc7f2ada24db82bec0a42edd938842a0bc31c7f6251a814f71/);
      assert.match(content, /scripts\/detect-action-contract\.rb/);
      assert.match(content, /source=base/);
      assert.match(content, /source=artifact/);
      assert.match(content, /name:\s*Checkout immutable Action contract detector/);
      const detectorCheckout = content.indexOf('- name: Checkout immutable Action contract detector');
      const contractDetection = content.indexOf('- name: Detect trusted-base Action contract');
      assert.ok(detectorCheckout >= 0 && contractDetection > detectorCheckout);
      assert.match(content.slice(detectorCheckout, contractDetection), /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
      assert.match(content, /if:\s*steps\.action-contract-detector-source\.outputs\.source == 'artifact'/);
      assert.match(content, /repository:\s*xpepper\/pr-review-gemini/);
      assert.match(content, /ref:\s*d8b3ae8f104e4e7a95ca129072c04148f3f5ddb2/);
      assert.match(content, /path:\s*\.gem-pr-review-action-contract-detector/);
      assert.match(content, /persist-credentials:\s*false/);
      assert.match(content, /sparse-checkout:[ \t]*\|[ \t]*\n[ \t]*scripts\/detect-action-contract\.rb/);
      assert.match(content, /sparse-checkout-cone-mode:\s*false/);
      assert.match(content, /id:\s*action-contract/);
      assert.match(content, /if \[ ! -f action\.yml \]/);
      assert.match(content, /case "\$\{\{\s*steps\.action-contract-detector-source\.outputs\.source\s*\}\}"/);
      assert.match(content, /shasum -a 256 "\$detector_path"/);
      assert.match(content, /ruby "\$detector_path" action\.yml/);
      assert.doesNotMatch(content, /raw\.githubusercontent\.com/);
      assert.doesNotMatch(content, /\bcurl\b/);
      assert.doesNotMatch(content, /grep -Fq/);
      assert.doesNotMatch(content, /ruby <<'RUBY'/);
      assert.doesNotMatch(content, /git show HEAD:scripts\/detect-action-contract\.rb/);
      assert.doesNotMatch(content, /git cat-file -e HEAD:scripts\/detect-action-contract\.rb/);
      assert.match(content, /legacy_bootstrap=true/);
      assert.match(content, /legacy_bootstrap=false/);
      assert.doesNotMatch(content, /gem-pr-review-action-bootstrap-v1/);
      assert.equal(fs.existsSync(path.resolve('.github/gem-pr-review-action-bootstrap-v1')), false);
      assert.match(content, /uses:\s*actions\/setup-node@v6/);
      assert.match(content, /npm install --global @github\/copilot@1\.0\.83/);
      assert.match(content, /if:\s*steps\.action-contract\.outputs\.legacy_bootstrap == 'true'/);
      const legacyRun = content.indexOf('- name: Run legacy base Gem PR Review');
      const modernRun = content.indexOf('- name: Run Gem PR Review', legacyRun + 1);
      assert.ok(legacyRun >= 0 && modernRun > legacyRun);
      assert.match(content.slice(legacyRun, modernRun), /if:\s*steps\.action-contract\.outputs\.legacy_bootstrap == 'true'/);
      assert.match(content.slice(legacyRun, modernRun), /COPILOT_GITHUB_TOKEN:\s*\${{\s*secrets\.COPILOT_TOKEN\s*}}/);
      assert.doesNotMatch(content.slice(legacyRun, modernRun), /copilot_token:/);
      assert.match(content.slice(modernRun), /if:\s*steps\.action-contract\.outputs\.legacy_bootstrap == 'false'/);
      assert.match(content.slice(modernRun), /copilot_token:\s*\${{\s*secrets\.COPILOT_TOKEN\s*}}/);
      assert.doesNotMatch(content.slice(modernRun), /COPILOT_GITHUB_TOKEN:/);
      assert.equal((content.match(/uses:\s*\.\//g) || []).length, 2);
      assert.match(content, /fail_on:\s*P1/);
    });

    it('tests the trusted action contract detector against modern, legacy, and unsupported manifests', () => {
      const detectorPath = path.resolve('scripts/detect-action-contract.rb');
      assert.equal(fs.existsSync(detectorPath), true, 'contract detector script must exist');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-contract-'));
      const runDetector = (manifest) => {
        const manifestPath = path.join(tempDir, 'action.yml');
        fs.writeFileSync(manifestPath, manifest);
        return spawnSync('ruby', [detectorPath, manifestPath], { encoding: 'utf8' });
      };

      const modernResult = runDetector(`inputs:
  copilot_token:
    required: true
runs:
  using: composite
  steps:
    - name: Require Copilot authentication
      env:
        COPILOT_GITHUB_TOKEN: '\${{ inputs.copilot_token }}'
      run: |
        if [ -z "$COPILOT_GITHUB_TOKEN" ]; then
          exit 1
        fi
    - name: Set up Node.js for Copilot CLI
      uses: actions/setup-node@v6
      env:
        COPILOT_GITHUB_TOKEN: ''
        GH_TOKEN: ''
        GITHUB_TOKEN: ''
      with:
        node-version: '22'
    - name: Install GitHub Copilot CLI
      env:
        COPILOT_GITHUB_TOKEN: ''
        GH_TOKEN: ''
        GITHUB_TOKEN: ''
      run: npm ci --prefix "$install_root" --ignore-scripts
    - name: Run Gem PR Review
      env:
        COPILOT_GITHUB_TOKEN: '\${{ inputs.copilot_token }}'
`);
      assert.equal(modernResult.status, 0, modernResult.stderr);
      assert.equal(modernResult.stdout.trim(), 'modern');

      const legacyResult = runDetector(`inputs:
  github_token:
    required: false
runs:
  using: composite
  steps:
    - id: review
      name: Run Gem PR Review
      shell: bash
      env:
        GITHUB_TOKEN: '\${{ inputs.github_token }}'
        GH_TOKEN: '\${{ inputs.github_token }}'
      run: node scripts/ci-action.mjs
`);
      assert.equal(legacyResult.status, 0, legacyResult.stderr);
      assert.equal(legacyResult.stdout.trim(), 'legacy');

      const unsupportedResult = runDetector(`runs:
  using: composite
  steps:
    - name: Unsupported action
      run: echo unsupported
`);
      assert.equal(unsupportedResult.status, 1);
      assert.match(unsupportedResult.stderr, /unsupported contract/);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Release Workflow Template (.github/workflows/release.yml)', () => {
    it('verifies release workflow validates tags and only publishes on explicit dispatch', () => {
      const workflowPath = path.resolve('.github/workflows/release.yml');
      assert.equal(fs.existsSync(workflowPath), true, 'release.yml workflow must exist');

      const content = fs.readFileSync(workflowPath, 'utf8');
      assert.match(content, /name:\s*['"]?Release['"]?/);
      assert.match(content, /workflow_dispatch:/);
      assert.match(content, /description:\s*['"]Existing git tag to publish \(e\.g\. v0\.2\.0\)['"]/);
      assert.match(content, /push:\s*\n\s*tags:\s*\n\s*-\s*['"]v\*['"]/);
      assert.match(content, /ref:\s*\${{\s*github\.event\.inputs\.tag \|\| github\.ref\s*}}/);
      assert.match(content, /needs:\s*verify/);
      assert.match(content, /if:\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]/);
      assert.match(content, /name:\s*['"]Publish GitHub Release['"]/);
      const existingReleaseCheck = content.indexOf('gh release view "$TAG_NAME"');
      const releaseCreation = content.indexOf('gh release create "$TAG_NAME"');
      assert.ok(existingReleaseCheck >= 0, 'publish job must reject an existing release');
      assert.ok(existingReleaseCheck < releaseCreation, 'existing release check must run before release creation');
      assert.match(content, /release_lookup=\$\(gh release view "\$TAG_NAME" 2>&1\)/);
      assert.match(content, /\[\s*"\$release_lookup"\s*!=\s*"release not found"\s*\]/);
      assert.match(content, /Unable to verify whether a release exists/);
    });

    it('fails closed unless the release lookup confirms the tag is missing', () => {
      const content = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
      const stepStart = content.indexOf('      - name: Check for Existing Release');
      const stepEnd = content.indexOf('      - name: Generate Release Notes', stepStart);
      const runStart = content.indexOf('        run: |\n', stepStart) + '        run: |\n'.length;
      const script = content
        .slice(runStart, stepEnd)
        .split('\n')
        .map((line) => line.replace(/^          /, ''))
        .join('\n');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-guard-'));
      const ghStub = path.join(tmpDir, 'gh');

      fs.writeFileSync(ghStub, '#!/bin/sh\nprintf "%s" "$GH_OUTPUT" >&2\nexit "$GH_EXIT"\n');
      fs.chmodSync(ghStub, 0o755);

      const runGuard = (exitCode, output) => spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GH_EXIT: String(exitCode),
            GH_OUTPUT: output,
            PATH: `${tmpDir}:${process.env.PATH}`,
            TAG_NAME: 'v1.2.3',
          },
        },
      );

      try {
        const existing = runGuard(0, '');
        assert.equal(existing.status, 1);
        assert.match(existing.stdout, /release for tag 'v1\.2\.3' already exists/);

        const missing = runGuard(1, 'release not found');
        assert.equal(missing.status, 0);

        const apiFailure = runGuard(1, 'gh: API rate limit exceeded (HTTP 403)');
        assert.equal(apiFailure.status, 1);
        assert.match(apiFailure.stdout, /Unable to verify whether a release exists/);
        assert.match(apiFailure.stderr, /API rate limit exceeded/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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

      it('parses resolve subcommand and flag (/gem-review resolve, --resolve) (Increment 20)', () => {
        const res1 = parseCommentCommand('/gem-review resolve');
        assert.equal(res1.action, 'resolve');
        assert.equal(res1.resolve, true);

        const res2 = parseCommentCommand('/gem-review --resolve');
        assert.equal(res2.action, 'resolve');
        assert.equal(res2.resolve, true);

        const res3 = parseCommentCommand('/gem-pr-review resolve');
        assert.equal(res3.action, 'resolve');
        assert.equal(res3.resolve, true);
      });

      it('does not treat bare word resolve in conversational comments as action resolve', () => {
        const res = parseCommentCommand('/gem-review please resolve this');
        assert.notEqual(res.action, 'resolve');
        assert.notEqual(res.resolve, true);
        assert.ok(res.unrecognizedArgs.includes('please'));
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

      it('displays documentation consistency failure independently of review findings', () => {
        const summary = formatCiSummary({
          qualityGateResult: mockQualityPass,
          ciEnv,
          documentationConsistency: { status: 'failed' },
        });
        assert.match(summary, /## ❌ Documentation Consistency Check Failed/);
        assert.match(summary, /- \*\*Verdict\*\*: `FAIL`/);
        assert.match(summary, /- \*\*Documentation Consistency Check\*\*: `FAILED`/);
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

    describe('Thread Resolution Command (/gem-review resolve) (Increment 20)', () => {
      describe('formatResolveCompletionReply', () => {
        it('formats completion reply when threads were resolved', () => {
          const reply = formatResolveCompletionReply({
            totalThreads: 2,
            counts: { total: 2, resolved: 1, stillOpen: 1, authorReplied: 0 },
            resolvedThreads: [
              {
                threadId: 'PRRT_kw1',
                path: 'src/auth.js',
                line: 42,
                finding: { title: 'Missing null check' },
              },
            ],
          });

          assert.ok(reply.includes('Thread Resolution Complete'));
          assert.ok(reply.includes('- **Resolved & Closed**: 1'));
          assert.ok(reply.includes('- **Still Open**: 1'));
          assert.ok(reply.includes('`src/auth.js:42`: Missing null check'));
        });

        it('formats completion reply when no threads were resolved', () => {
          const reply = formatResolveCompletionReply({
            totalThreads: 1,
            counts: { total: 1, resolved: 0, stillOpen: 1, authorReplied: 0 },
            resolvedThreads: [],
          });

          assert.ok(reply.includes('Thread Resolution Complete'));
          assert.ok(reply.includes('- **Resolved & Closed**: 0'));
          assert.ok(reply.includes('No threads were verified as fixed'));
        });

        it('includes obsolete threads in resolved count', () => {
          const reply = formatResolveCompletionReply({
            totalThreads: 2,
            counts: { total: 2, resolved: 1, obsolete: 1, stillOpen: 0, authorReplied: 0 },
            resolvedThreads: [
              { threadId: 't1', path: 'a.js', line: 1 },
              { threadId: 't2', path: 'b.js', line: 2 },
            ],
          });

          assert.ok(reply.includes('Thread Resolution Complete'));
          assert.ok(reply.includes('- **Resolved & Closed**: 2'));
        });
      });

      describe('runResolveCommand', () => {
        it('fetches diff, threads, evaluates, and resolves verified threads', async () => {
          const mockGh = async (args) => {
            const cmd = args.join(' ');
            if (cmd.includes('pr diff')) {
              return `diff --git a/src/auth.js b/src/auth.js
index 1111111..2222222 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -40,5 +40,6 @@ function authenticate(user) {
-  const id = user.id;
+  const id = user?.id ?? null;
   return id;
 }`;
            }
            if (cmd.includes('graphql')) {
              if (cmd.includes('resolveReviewThread')) {
                return JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'PRRT_kw1', isResolved: true } } } });
              }
              if (cmd.includes('addPullRequestReviewThreadReply')) {
                return JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c1' } } } });
              }
              return JSON.stringify({
                data: {
                  repository: {
                    pullRequest: {
                      reviewThreads: {
                        nodes: [
                          {
                            id: 'PRRT_kw1',
                            isResolved: false,
                            isOutdated: false,
                            path: 'src/auth.js',
                            line: 42,
                            comments: { nodes: [{ id: 'c0', body: 'Missing null check' }] },
                          },
                        ],
                      },
                    },
                  },
                },
              });
            }
            return '[]';
          };

          const outcome = await runResolveCommand({
            prNumber: 42,
            repo: 'xpepper/pr-review-gemini',
            execGhFn: mockGh,
          });

          assert.equal(outcome.prNumber, 42);
          assert.equal(outcome.totalThreads, 1);
          assert.equal(outcome.resolvedThreads.length, 1);
          assert.equal(outcome.resolvedThreads[0].threadId, 'PRRT_kw1');
          assert.equal(outcome.counts.resolved, 1);
        });
      });

      describe('runCiAction with /gem-review resolve', () => {
        it('executes resolve workflow, adds reactions, and posts completion reply', async () => {
          const reactions = [];
          const comments = [];

          const mockGh = async (args) => {
            const cmd = args.join(' ');
            if (cmd.includes('reactions')) {
              reactions.push(cmd);
              return JSON.stringify({ id: 999 });
            }
            if (cmd.includes('issues/55/comments')) {
              comments.push(cmd);
              return JSON.stringify({ id: 888 });
            }
            if (cmd.includes('pr diff')) {
              return `diff --git a/src/auth.js b/src/auth.js
index 1111111..2222222 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -40,5 +40,6 @@ function authenticate(user) {
-  const id = user.id;
+  const id = user?.id ?? null;
   return id;
 }`;
            }
            if (cmd.includes('graphql')) {
              if (cmd.includes('resolveReviewThread')) {
                return JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'PRRT_kw1', isResolved: true } } } });
              }
              if (cmd.includes('addPullRequestReviewThreadReply')) {
                return JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c1' } } } });
              }
              return JSON.stringify({
                data: {
                  repository: {
                    pullRequest: {
                      reviewThreads: {
                        nodes: [
                          {
                            id: 'PRRT_kw1',
                            isResolved: false,
                            isOutdated: false,
                            path: 'src/auth.js',
                            line: 42,
                            comments: { nodes: [{ id: 'c0', body: 'Missing null check' }] },
                          },
                        ],
                      },
                    },
                  },
                },
              });
            }
            return '[]';
          };

          const options = {
            eventPayload: {
              action: 'created',
              issue: { number: 55, pull_request: {} },
              comment: {
                id: 12345,
                body: '/gem-review resolve',
                author_association: 'MEMBER',
                user: { login: 'trusted-dev' },
              },
              repository: { full_name: 'xpepper/pr-review-gemini' },
            },
            execGhFn: mockGh,
            mock: true,
          };

          const env = {
            GITHUB_EVENT_NAME: 'issue_comment',
          };

          const result = await runCiAction(options, env, silentIo);
          assert.equal(result.exitCode, 0);
          assert.equal(result.resolve, true);
          assert.ok(reactions.some((r) => r.includes('eyes')));
          assert.ok(reactions.some((r) => r.includes('rocket')));
          assert.ok(reactions.some((r) => r.includes('+1')));
          assert.ok(comments.some((c) => c.includes('Thread Resolution Complete') || c.includes('Resolved & Closed')));
        });

        it('reacts with confused and posts error notice if resolve command fails', async () => {
          const reactions = [];
          const comments = [];

          const mockGh = async (args) => {
            const cmd = args.join(' ');
            if (cmd.includes('reactions')) {
              reactions.push(cmd);
              return JSON.stringify({ id: 999 });
            }
            if (cmd.includes('issues/55/comments')) {
              comments.push(cmd);
              return JSON.stringify({ id: 888 });
            }
            if (cmd.includes('pr diff')) {
              throw new Error('Network timeout fetching PR diff');
            }
            return '[]';
          };

          const options = {
            eventPayload: {
              action: 'created',
              issue: { number: 55, pull_request: {} },
              comment: {
                id: 12345,
                body: '/gem-review resolve',
                author_association: 'MEMBER',
                user: { login: 'trusted-dev' },
              },
              repository: { full_name: 'xpepper/pr-review-gemini' },
            },
            execGhFn: mockGh,
            mock: true,
          };

          const env = {
            GITHUB_EVENT_NAME: 'issue_comment',
          };

          const result = await runCiAction(options, env, silentIo);
          assert.equal(result.exitCode, 1);
          assert.equal(result.resolve, false);
          assert.ok(reactions.some((r) => r.includes('confused')));
          assert.ok(comments.some((c) => c.includes('Thread Resolution Error') || c.includes('Network timeout')));
        });
      });
    });
  });

  describe('Increment 22: Safe Verbose Review Diagnostics in CI', () => {
    it('parseCommentCommand detects --verbose and -V flags', () => {
      const longRes = parseCommentCommand('/gem-review --quick --verbose');
      assert.equal(longRes.isCommand, true);
      assert.equal(longRes.mode, 'quick');
      assert.equal(longRes.verbose, true);

      const shortRes = parseCommentCommand('/gem-review -V');
      assert.equal(shortRes.isCommand, true);
      assert.equal(shortRes.verbose, true);

      const defaultRes = parseCommentCommand('/gem-review --balanced');
      assert.equal(defaultRes.isCommand, true);
      assert.equal(defaultRes.verbose, false);
    });

    it('resolveCiEnvironment extracts verbose flag from comment command and env.INPUT_VERBOSE', () => {
      const fromCmd = resolveCiEnvironment(
        {
          eventPayload: {
            action: 'created',
            issue: { number: 42, pull_request: {} },
            comment: { id: 1, body: '/gem-review --verbose', author_association: 'MEMBER' },
          },
        },
        {}
      );
      assert.equal(fromCmd.verbose, true);

      const fromEnv = resolveCiEnvironment({}, { INPUT_VERBOSE: 'true' });
      assert.equal(fromEnv.verbose, true);

      const defaultEnv = resolveCiEnvironment({}, {});
      assert.equal(defaultEnv.verbose, false);
    });

    it('formatHelpReply documents --verbose and -V flags', () => {
      const help = formatHelpReply();
      assert.match(help, /--verbose/);
      assert.match(help, /-V/);
    });

    it('formatCompletionReply appends structured diagnostics report when verbose is enabled', () => {
      const sampleDiagnostics = {
        phases: {
          diffFetch: { durationMs: 12, status: 'completed' },
          subagents: { durationMs: 340, status: 'completed' },
        },
        findings: {
          total: 1,
          anchored: 1,
          demoted: 0,
          severities: { P0: 0, P1: 0, P2: 1, P3: 0, nit: 0 },
        },
        safety: {
          staleHeadPassed: true,
          commentsCapped: false,
          verdict: 'APPROVE',
        },
      };

      const replyWithVerbose = formatCompletionReply({
        qualityGateResult: { passed: true, verdict: 'PASS', totalFindings: 1, blockingCount: 0 },
        ciEnv: { mode: 'balanced', verbose: true },
        diagnostics: sampleDiagnostics,
      });

      assert.match(replyWithVerbose, /Verbose Diagnostics/i);
      assert.match(replyWithVerbose, /Diff: 12ms/);

      const replyWithoutVerbose = formatCompletionReply({
        qualityGateResult: { passed: true, verdict: 'PASS', totalFindings: 1, blockingCount: 0 },
        ciEnv: { mode: 'balanced', verbose: false },
        diagnostics: sampleDiagnostics,
      });

      assert.doesNotMatch(replyWithoutVerbose, /Verbose Diagnostics/i);
    });
  });
