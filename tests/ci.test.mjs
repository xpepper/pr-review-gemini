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
      assert.deepEqual(parseEventPayload(null), {
        isPullRequest: false,
        prNumber: null,
        repo: null,
        action: null,
        headSha: null,
        baseSha: null,
        sender: null,
      });

      assert.deepEqual(parseEventPayload(''), {
        isPullRequest: false,
        prNumber: null,
        repo: null,
        action: null,
        headSha: null,
        baseSha: null,
        sender: null,
      });

      assert.deepEqual(parseEventPayload('{invalid json'), {
        isPullRequest: false,
        prNumber: null,
        repo: null,
        action: null,
        headSha: null,
        baseSha: null,
        sender: null,
      });
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
      assert.match(content, /uses:\s*actions\/checkout@v4/);
      assert.match(content, /uses:\s*xpepper\/pr-review-gemini@main/);
      assert.match(content, /fail_on:\s*P1/);
    });
  });
