import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnosticsCollector,
  sanitizeTelemetry,
  formatDiagnosticReport,
  formatDiagnosticsJson,
  redactSensitiveString,
} from '../src/diagnostics.js';

describe('Diagnostics Collector & Redaction (Increment 22)', () => {
  describe('createDiagnosticsCollector lifecycle and metrics', () => {
    it('initializes with default structure and timestamps', () => {
      const collector = createDiagnosticsCollector();
      const diag = collector.toObject();

      assert.ok(diag);
      assert.ok(diag.version);
      assert.ok(diag.timestamp);
      assert.equal(typeof diag.phases, 'object');
      assert.equal(Array.isArray(diag.lenses), true);
      assert.equal(typeof diag.findings, 'object');
      assert.equal(typeof diag.safetyDecisions, 'object');
    });

    it('measures phase timings with startPhase and endPhase', async () => {
      const collector = createDiagnosticsCollector();
      collector.start(1000);

      collector.startPhase('diffFetch', 1010);
      collector.endPhase('diffFetch', { byteSize: 4096, isLarge: false }, 1050);

      collector.startPhase('subagents', 1060);
      collector.endPhase('subagents', { lensCount: 5 }, 1200);

      collector.end(1250);

      const diag = collector.toObject();
      assert.equal(diag.durationMs, 250);
      assert.ok(diag.phases.diffFetch);
      assert.equal(diag.phases.diffFetch.durationMs, 40);
      assert.equal(diag.phases.diffFetch.byteSize, 4096);
      assert.equal(diag.phases.diffFetch.status, 'completed');

      assert.ok(diag.phases.subagents);
      assert.equal(diag.phases.subagents.durationMs, 140);
      assert.equal(diag.phases.subagents.lensCount, 5);
      assert.equal(diag.phases.subagents.status, 'completed');
    });

    it('measures phase with measurePhase async helper and captures errors', async () => {
      const collector = createDiagnosticsCollector();

      const result = await collector.measurePhase('caching', async () => {
        return { cached: true, path: '.gem-pr-cache/sample.json' };
      });

      assert.deepEqual(result, { cached: true, path: '.gem-pr-cache/sample.json' });
      const diag = collector.toObject();
      assert.ok(diag.phases.caching);
      assert.equal(diag.phases.caching.status, 'completed');
      assert.ok(diag.phases.caching.durationMs >= 0);

      await assert.rejects(
        collector.measurePhase('failingPhase', async () => {
          throw new Error('Simulated phase failure');
        }),
        /Simulated phase failure/
      );

      const errDiag = collector.toObject();
      assert.ok(errDiag.phases.failingPhase);
      assert.equal(errDiag.phases.failingPhase.status, 'failed');
      assert.equal(errDiag.phases.failingPhase.error, 'Simulated phase failure');
    });

    it('records configuration, diff, and guidelines metadata', () => {
      const collector = createDiagnosticsCollector();

      collector.recordConfig({
        mode: 'full',
        roles: ['correctness', 'security', 'db_specialist'],
        replaceStandardRoles: false,
        primaryModel: 'claude-3.5-sonnet',
        fallbackModel: 'auto',
      });

      collector.recordDiffMetadata({
        totalBytes: 250000,
        isLarge: true,
        totalFiles: 14,
        thresholdBytes: 204800,
      });

      collector.recordGuidelinesMetadata({
        path: '.github/gem-pr-review.md',
        bytes: 4096,
        found: true,
        enabled: true,
        truncated: false,
        untrusted: false,
        source: 'base_ref',
      });

      const diag = collector.toObject();
      assert.equal(diag.config.mode, 'full');
      assert.deepEqual(diag.config.roles, ['correctness', 'security', 'db_specialist']);
      assert.equal(diag.diff.totalBytes, 250000);
      assert.equal(diag.diff.isLarge, true);
      assert.equal(diag.diff.totalFiles, 14);
      assert.equal(diag.guidelines.path, '.github/gem-pr-review.md');
      assert.equal(diag.guidelines.bytes, 4096);
      assert.equal(diag.guidelines.truncated, false);
      assert.equal(diag.guidelines.untrusted, false);
    });

    it('records per-lens execution lifecycle including status, model, and fallback attempts', () => {
      const collector = createDiagnosticsCollector();

      collector.recordLensLifecycle({
        lensId: 'correctness',
        name: 'Correctness & Concurrency',
        durationMs: 450,
        status: 'completed',
        model: 'claude-3.5-sonnet',
        fallbacksUsed: 0,
        findingsCount: 3,
      });

      collector.recordLensLifecycle({
        lensId: 'security',
        name: 'Security Specialist',
        durationMs: 820,
        status: 'retried',
        model: 'auto',
        fallbacksUsed: 1,
        fallbackAttempts: [
          { model: 'claude-3.5-sonnet', error: 'HTTP 429 quota exhausted' },
        ],
        findingsCount: 1,
      });

      collector.recordLensLifecycle({
        lensId: 'performance',
        name: 'Performance Specialist',
        durationMs: 310,
        status: 'failed',
        model: 'claude-3.5-sonnet',
        fallbacksUsed: 0,
        error: 'Network connection terminated',
      });

      const diag = collector.toObject();
      assert.equal(diag.lenses.length, 3);
      assert.equal(diag.lenses[0].lensId, 'correctness');
      assert.equal(diag.lenses[0].status, 'completed');
      assert.equal(diag.lenses[0].findingsCount, 3);

      assert.equal(diag.lenses[1].lensId, 'security');
      assert.equal(diag.lenses[1].status, 'retried');
      assert.equal(diag.lenses[1].fallbacksUsed, 1);
      assert.equal(diag.lenses[1].model, 'auto');

      assert.equal(diag.lenses[2].lensId, 'performance');
      assert.equal(diag.lenses[2].status, 'failed');
      assert.equal(diag.lenses[2].error, 'Network connection terminated');
    });

    it('records findings classification, anchoring, demotion, and confidence stats', () => {
      const collector = createDiagnosticsCollector();

      collector.recordFindingsClassification({
        total: 5,
        anchored: 4,
        demoted: 1,
        severities: { P0: 1, P1: 2, P2: 1, P3: 0, nit: 1 },
        confidence: { min: 0.75, max: 0.98, avg: 0.88 },
      });

      const diag = collector.toObject();
      assert.equal(diag.findings.total, 5);
      assert.equal(diag.findings.anchored, 4);
      assert.equal(diag.findings.demoted, 1);
      assert.equal(diag.findings.severities.P0, 1);
      assert.equal(diag.findings.severities.P1, 2);
      assert.equal(diag.findings.confidence.avg, 0.88);
    });

    it('records publication and safety gate decisions', () => {
      const collector = createDiagnosticsCollector();

      collector.recordSafetyDecisions({
        staleHeadPassed: true,
        commentsCapped: true,
        inlineCommentsCount: 50,
        maxInlineComments: 50,
        verdict: 'COMMENT',
        qualityGate: { passed: false, failOn: 'P1', blockingCount: 2 },
      });

      const diag = collector.toObject();
      assert.equal(diag.safetyDecisions.staleHeadPassed, true);
      assert.equal(diag.safetyDecisions.commentsCapped, true);
      assert.equal(diag.safetyDecisions.inlineCommentsCount, 50);
      assert.equal(diag.safetyDecisions.verdict, 'COMMENT');
      assert.equal(diag.safetyDecisions.qualityGate.passed, false);
      assert.equal(diag.safetyDecisions.qualityGate.blockingCount, 2);
    });
  });

  describe('Strict Redaction & Sanitization Guarantees', () => {
    it('redacts absolute developer machine paths (/Users/, /home/, C:\\)', () => {
      const sensitiveInput = {
        cachePath: '/Users/developer/Documents/workspace/ai/pr-review-gemini/.gem-pr-cache/12.json',
        guidelinePath: '/home/ubuntu/repo/.github/gem-pr-review.md',
        windowsPath: 'C:\\Users\\dev\\project\\file.js',
        linuxVar: '/var/folders/2z/test/tmp.diff',
        normalRel: 'src/reviewer.js',
      };

      const sanitized = sanitizeTelemetry(sensitiveInput, {
        cwd: '/Users/developer/Documents/workspace/ai/pr-review-gemini',
      });

      assert.doesNotMatch(JSON.stringify(sanitized), /\/Users\//, 'Must not contain /Users/');
      assert.doesNotMatch(JSON.stringify(sanitized), /\/home\//, 'Must not contain /home/');
      assert.doesNotMatch(JSON.stringify(sanitized), /C:\\/, 'Must not contain C:\\');
      assert.doesNotMatch(JSON.stringify(sanitized), /\/var\//, 'Must not contain /var/');

      // Relative path from CWD should be normalized to repo-relative
      assert.equal(sanitized.cachePath, '.gem-pr-cache/12.json');
      assert.equal(sanitized.normalRel, 'src/reviewer.js');
    });

    it('redacts tokens, credentials, and authorization headers', () => {
      const sensitiveTokens = {
        githubToken: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
        fineGrainedPat: 'github_pat_11ABCD1234_xyz9876543210ABCDEF',
        authHeader: 'Bearer gho_SecretOauthTokenHere12345',
        pass: 'mySecretPassword123!',
      };

      const sanitized = sanitizeTelemetry(sensitiveTokens);
      const str = JSON.stringify(sanitized);

      assert.doesNotMatch(str, /ghp_ABCDEF/);
      assert.doesNotMatch(str, /github_pat_/);
      assert.doesNotMatch(str, /gho_Secret/);
      assert.ok(str.includes('[REDACTED_TOKEN]') || str.includes('[REDACTED]'));
    });

    it('never emits prompt bodies or raw diff contents', () => {
      const collector = createDiagnosticsCollector();

      collector.recordConfig({
        mode: 'balanced',
        promptBody: 'You are a specialist reviewer. Here is the secret code diff...',
      });

      collector.recordDiffMetadata({
        totalBytes: 5000,
        diffText: 'diff --git a/src/secret.js\n+ const apiKey = "12345";',
      });

      const diag = collector.toObject();
      const str = JSON.stringify(diag);

      assert.doesNotMatch(str, /secret code diff/i);
      assert.doesNotMatch(str, /apiKey/i);
      assert.doesNotMatch(str, /diff --git/i);
      assert.equal(diag.diff.diffText, undefined);
      assert.equal(diag.config.promptBody, undefined);
    });
  });

  describe('Report Formatting: formatDiagnosticReport & formatDiagnosticsJson', () => {
    it('formats a structured markdown summary report', () => {
      const collector = createDiagnosticsCollector();
      collector.start(1000);
      collector.recordConfig({ mode: 'balanced', roles: ['correctness', 'security'] });
      collector.startPhase('diffFetch', 1000);
      collector.endPhase('diffFetch', { byteSize: 8192, isLarge: false }, 1040);
      collector.startPhase('subagents', 1040);
      collector.endPhase('subagents', { lensCount: 2 }, 1240);
      collector.recordDiffMetadata({ totalBytes: 8192, isLarge: false, totalFiles: 3 });
      collector.recordGuidelinesMetadata({
        path: '.github/gem-pr-review.md',
        bytes: 1200,
        found: true,
        enabled: true,
        truncated: false,
        untrusted: false,
      });
      collector.recordLensLifecycle({
        lensId: 'correctness',
        name: 'Correctness & Concurrency',
        durationMs: 180,
        status: 'completed',
        model: 'claude-3.5-sonnet',
        fallbacksUsed: 0,
        findingsCount: 1,
      });
      collector.recordLensLifecycle({
        lensId: 'security',
        name: 'Security Specialist',
        durationMs: 190,
        status: 'completed',
        model: 'claude-3.5-sonnet',
        fallbacksUsed: 0,
        findingsCount: 0,
      });
      collector.recordFindingsClassification({
        total: 1,
        anchored: 1,
        demoted: 0,
        severities: { P0: 0, P1: 1, P2: 0, P3: 0, nit: 0 },
        confidence: { min: 0.95, max: 0.95, avg: 0.95 },
      });
      collector.recordSafetyDecisions({
        staleHeadPassed: true,
        commentsCapped: false,
        inlineCommentsCount: 1,
        maxInlineComments: 50,
        verdict: 'COMMENT',
      });
      collector.end(1260);

      const report = formatDiagnosticReport(collector.toObject());

      assert.ok(report.includes('### 🔬 Review Execution Diagnostics'));
      assert.ok(report.includes('balanced'));
      assert.ok(report.includes('Total: 260ms'));
      assert.ok(report.includes('Diff: 40ms'));
      assert.ok(report.includes('Subagents: 200ms'));
      assert.ok(report.includes('8.0 KB'));
      assert.ok(report.includes('3 files'));
      assert.ok(report.includes('.github/gem-pr-review.md'));
      assert.ok(report.includes('Correctness & Concurrency'));
      assert.ok(report.includes('Security Specialist'));
      assert.ok(report.includes('1 detected'));
      assert.ok(report.includes('Stale-head check: passed'));
    });

    it('formats valid machine-readable JSON with formatDiagnosticsJson', () => {
      const collector = createDiagnosticsCollector();
      collector.start(1000);
      collector.recordConfig({ mode: 'quick' });
      collector.end(1100);

      const jsonStr = formatDiagnosticsJson(collector.toObject());
      assert.equal(typeof jsonStr, 'string');

      const parsed = JSON.parse(jsonStr);
      assert.equal(parsed.config.mode, 'quick');
      assert.equal(parsed.durationMs, 100);
    });

    it('handles partial / degraded execution where some lenses fail', () => {
      const collector = createDiagnosticsCollector();
      collector.recordLensLifecycle({
        lensId: 'conventions',
        name: 'Conventions Specialist',
        durationMs: 250,
        status: 'failed',
        model: 'auto',
        fallbacksUsed: 0,
        error: 'Inference rate limited',
      });

      const report = formatDiagnosticReport(collector.toObject());
      assert.ok(report.includes('Conventions Specialist'));
      assert.ok(report.includes('failed') || report.includes('❌'));
      assert.ok(report.includes('Inference rate limited'));
    });
  });
});
