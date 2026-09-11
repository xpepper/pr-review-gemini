import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_BENCHMARKS,
  evaluateCalibrationFinding,
  evaluateCalibrationSuite,
} from '../src/calibration.js';

describe('Reviewer Sensitivity & Quality Calibration Benchmark (Increment 16)', () => {
  describe('CALIBRATION_BENCHMARKS', () => {
    it('defines benchmarks covering all 5 PR #26 defect dimensions', () => {
      assert.ok(Array.isArray(CALIBRATION_BENCHMARKS));
      assert.equal(CALIBRATION_BENCHMARKS.length >= 5, true);

      const ids = CALIBRATION_BENCHMARKS.map((b) => b.id);
      assert.ok(ids.includes('ambient-state-coupling'));
      assert.ok(ids.includes('redundant-subprocess-refetch'));
      assert.ok(ids.includes('dead-logic-assignment'));
      assert.ok(ids.includes('landing-surface-precondition'));
      assert.ok(ids.includes('sibling-cli-duplication'));
    });

    it('each benchmark defines required structure, diff snippet, lens, and keywords', () => {
      for (const b of CALIBRATION_BENCHMARKS) {
        assert.ok(b.id, 'Benchmark must have id');
        assert.ok(b.dimension, `Benchmark ${b.id} must have dimension`);
        assert.ok(b.lens, `Benchmark ${b.id} must have lens`);
        assert.ok(b.expectedSeverity, `Benchmark ${b.id} must have expectedSeverity`);
        assert.ok(b.file, `Benchmark ${b.id} must have file`);
        assert.ok(Number.isInteger(b.line), `Benchmark ${b.id} must have integer line`);
        assert.ok(typeof b.diff === 'string' && b.diff.length > 0, `Benchmark ${b.id} must have diff`);
        assert.ok(Array.isArray(b.keywords) && b.keywords.length > 0, `Benchmark ${b.id} must have keywords`);
      }
    });

    it('maps dimensions to appropriate specialist lenses', () => {
      const ambient = CALIBRATION_BENCHMARKS.find((b) => b.id === 'ambient-state-coupling');
      assert.equal(ambient.lens, 'contracts');

      const redundant = CALIBRATION_BENCHMARKS.find((b) => b.id === 'redundant-subprocess-refetch');
      assert.equal(redundant.lens, 'performance');

      const deadLogic = CALIBRATION_BENCHMARKS.find((b) => b.id === 'dead-logic-assignment');
      assert.equal(deadLogic.lens, 'conventions');

      const landing = CALIBRATION_BENCHMARKS.find((b) => b.id === 'landing-surface-precondition');
      assert.equal(landing.lens, 'correctness');

      const duplication = CALIBRATION_BENCHMARKS.find((b) => b.id === 'sibling-cli-duplication');
      assert.equal(duplication.lens, 'conventions');
    });
  });

  describe('evaluateCalibrationFinding', () => {
    const ambientBenchmark = {
      id: 'ambient-state-coupling',
      dimension: 'coupling',
      lens: 'contracts',
      expectedSeverity: 'P1',
      file: 'scripts/ci-action.mjs',
      line: 42,
      keywords: ['ambient', 'process.argv', 'parameter', 'explicit'],
    };

    it('returns match: true when finding matches file, line range, lens, and keywords', () => {
      const finding = {
        file: 'scripts/ci-action.mjs',
        line: 43,
        lens: 'contracts',
        severity: 'P1',
        confidence: 0.9,
        title: 'Ambient state coupling in library function',
        body: 'Function reads process.argv directly instead of taking explicit options parameter.',
      };

      const result = evaluateCalibrationFinding(finding, ambientBenchmark);
      assert.equal(result.matched, true);
      assert.equal(result.benchmarkId, 'ambient-state-coupling');
    });

    it('matches when file path is repository-relative or basename-aligned', () => {
      const finding = {
        file: 'ci-action.mjs',
        line: 42,
        lens: 'contracts',
        severity: 'P2',
        confidence: 0.85,
        title: 'Coupling to ambient process state',
        body: 'Avoid reading process.argv in reusable function.',
      };

      const result = evaluateCalibrationFinding(finding, ambientBenchmark);
      assert.equal(result.matched, true);
    });

    it('rejects finding if file does not match', () => {
      const finding = {
        file: 'src/other.js',
        line: 42,
        lens: 'contracts',
        severity: 'P1',
        title: 'Coupling to ambient state',
        body: 'process.argv used here.',
      };

      const result = evaluateCalibrationFinding(finding, ambientBenchmark);
      assert.equal(result.matched, false);
      assert.equal(result.reason, 'file_mismatch');
    });

    it('rejects finding if line is too far from target line (> 15 lines away)', () => {
      const finding = {
        file: 'scripts/ci-action.mjs',
        line: 120,
        lens: 'contracts',
        severity: 'P1',
        title: 'Coupling to ambient state',
        body: 'process.argv used here.',
      };

      const result = evaluateCalibrationFinding(finding, ambientBenchmark);
      assert.equal(result.matched, false);
      assert.equal(result.reason, 'line_out_of_range');
    });

    it('rejects finding if keywords are completely absent', () => {
      const finding = {
        file: 'scripts/ci-action.mjs',
        line: 42,
        lens: 'contracts',
        severity: 'P1',
        title: 'Formatting error',
        body: 'Missing semicolon at end of statement.',
      };

      const result = evaluateCalibrationFinding(finding, ambientBenchmark);
      assert.equal(result.matched, false);
      assert.equal(result.reason, 'no_keyword_match');
    });
  });

  describe('evaluateCalibrationSuite', () => {
    it('computes 100% recall when all benchmarks are detected', () => {
      const mockFindings = CALIBRATION_BENCHMARKS.map((b) => ({
        file: b.file,
        line: b.line,
        lens: b.lens,
        severity: b.expectedSeverity,
        confidence: 0.9,
        title: `Calibrated defect: ${b.dimension}`,
        body: `Matches ${b.keywords.join(' ')} at ${b.file}:${b.line}.`,
      }));

      const report = evaluateCalibrationSuite(mockFindings);
      assert.equal(report.totalBenchmarks, CALIBRATION_BENCHMARKS.length);
      assert.equal(report.matched.length, CALIBRATION_BENCHMARKS.length);
      assert.equal(report.missed.length, 0);
      assert.equal(report.recall, 1.0);
      assert.equal(report.precision, 1.0);
      assert.equal(report.passed, true);
    });

    it('computes partial recall and identifies missed benchmarks when findings are incomplete', () => {
      // Only detect 3 of 5
      const mockFindings = CALIBRATION_BENCHMARKS.slice(0, 3).map((b) => ({
        file: b.file,
        line: b.line,
        lens: b.lens,
        severity: b.expectedSeverity,
        confidence: 0.85,
        title: `Calibrated defect: ${b.dimension}`,
        body: `Matches ${b.keywords.join(' ')} at ${b.file}:${b.line}.`,
      }));

      const report = evaluateCalibrationSuite(mockFindings);
      assert.equal(report.totalBenchmarks, 5);
      assert.equal(report.matched.length, 3);
      assert.equal(report.missed.length, 2);
      assert.equal(report.recall, 0.6);
      assert.equal(report.passed, false);
      assert.deepEqual(
        report.missed.map((m) => m.id),
        ['landing-surface-precondition', 'sibling-cli-duplication']
      );
    });
  });
});
