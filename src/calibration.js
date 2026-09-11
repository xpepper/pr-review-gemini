/**
 * src/calibration.js — Reviewer Sensitivity & Quality Calibration Benchmarks
 *
 * Provides benchmark defect patterns derived from real code review dogfooding
 * (PR #26 review findings) and scoring functions to benchmark lens recall,
 * precision, and sensitivity across universal software engineering dimensions.
 */
import path from 'node:path';

/**
 * Standard benchmark cases representing universal design and defect dimensions
 * identified during Increment 15 dogfood review passes.
 */
export const CALIBRATION_BENCHMARKS = Object.freeze([
  {
    id: 'ambient-state-coupling',
    dimension: 'coupling',
    lens: 'contracts',
    expectedSeverity: 'P1',
    file: 'scripts/ci-action.mjs',
    line: 42,
    title: 'Library function reading ambient process.argv instead of explicit options',
    diff: `diff --git a/scripts/ci-action.mjs b/scripts/ci-action.mjs
@@ -40,4 +40,6 @@ export async function runCiAction(options = {}) {
+  if (process.argv.includes('--version') || process.argv.includes('-v')) {
+    printVersionBanner();
+    return;
+  }`,
    keywords: ['ambient', 'process.argv', 'parameter', 'explicit', 'coupling', 'global'],
  },
  {
    id: 'redundant-subprocess-refetch',
    dimension: 'redundancy',
    lens: 'performance',
    expectedSeverity: 'P2',
    file: 'scripts/bump-version.mjs',
    line: 185,
    title: 'Redundant git commits subprocess refetch when data is already computed',
    diff: `diff --git a/scripts/bump-version.mjs b/scripts/bump-version.mjs
@@ -180,4 +180,6 @@ export async function main() {
   const commits = await getGitCommitsSinceTag(latestTag);
+  const nextVersion = calculateNextVersion(currentVersion, { commits });
+  const changelog = generateChangelog({ commits: await getGitCommitsSinceTag(latestTag) });`,
    keywords: ['redundant', 'refetch', 'duplicate', 'subprocess', 'git log', 'getGitCommitsSinceTag'],
  },
  {
    id: 'dead-logic-assignment',
    dimension: 'dead_logic',
    lens: 'conventions',
    expectedSeverity: 'P3',
    file: 'src/semver.js',
    line: 210,
    title: 'Unused initial variable assignment immediately overwritten in all branches',
    diff: `diff --git a/src/semver.js b/src/semver.js
@@ -208,5 +208,7 @@ export function resolveBumpType(target, options) {
-  let bumpType = null;
+  let bumpType = 'patch';
   if (target === 'major') {
     bumpType = 'major';
   } else if (target === 'minor') {
     bumpType = 'minor';
   } else {
     bumpType = 'patch';
   }`,
    keywords: ['dead', 'phantom', 'unused', 'overwritten', 'initialization', 'assignment', 'initial'],
  },
  {
    id: 'landing-surface-precondition',
    dimension: 'precondition',
    lens: 'correctness',
    expectedSeverity: 'P1',
    file: '.github/workflows/release.yml',
    line: 35,
    title: 'Workflow dispatch assuming external git ref exists before checkout',
    diff: `diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
@@ -32,3 +32,5 @@ jobs:
       - name: Checkout repository
         uses: actions/checkout@v4
+        with:
+          ref: \${{ inputs.tag }}`,
    keywords: ['precondition', 'ref', 'checkout', 'landing surface', 'assumes', 'exists', 'workflow_dispatch'],
  },
  {
    id: 'sibling-cli-duplication',
    dimension: 'duplication',
    lens: 'conventions',
    expectedSeverity: 'P3',
    file: 'scripts/dogfood-review.mjs',
    line: 195,
    title: 'Copy-pasting identical version banner formatting across multiple CLI entrypoints',
    diff: `diff --git a/scripts/dogfood-review.mjs b/scripts/dogfood-review.mjs
@@ -193,3 +193,5 @@ export async function main() {
   if (showVersion) {
+    console.log(\`\${PLUGIN_NAME} v\${PLUGIN_VERSION}\`);
+    process.exit(0);
   }`,
    keywords: ['duplication', 'sibling', 'boilerplate', 'single source of truth', 'dry', 'centralize'],
  },
]);

/**
 * Checks whether finding file matches benchmark file.
 */
function isMatchingFile(findingFile, benchmarkFile) {
  if (!findingFile || !benchmarkFile) return false;
  const cleanFinding = findingFile.replace(/^a\/|^b\//, '').replace(/\\/g, '/');
  const cleanBenchmark = benchmarkFile.replace(/\\/g, '/');

  return (
    cleanFinding === cleanBenchmark ||
    cleanFinding.endsWith(`/${cleanBenchmark}`) ||
    cleanBenchmark.endsWith(`/${cleanFinding}`) ||
    path.basename(cleanFinding) === path.basename(cleanBenchmark)
  );
}

/**
 * Evaluates whether a reported finding matches a specific benchmark defect case.
 *
 * @param {Object} finding - Reported code review finding
 * @param {Object} benchmark - Benchmark defect definition
 * @param {Object} [options]
 * @param {number} [options.maxLineDistance=15] - Maximum acceptable line distance
 * @param {boolean} [options.matchLens=true] - Whether to validate lens compatibility when finding.lens is present
 * @param {boolean|string} [options.matchSeverity=true] - Whether to validate severity compatibility ('exact' or delta <= maxSeverityDelta)
 * @param {number} [options.maxSeverityDelta=1] - Maximum acceptable severity difference (e.g. P1 vs P2)
 * @returns {{ matched: boolean, benchmarkId: string, reason?: string }}
 */
export function evaluateCalibrationFinding(finding, benchmark, options = {}) {
  const maxLineDist = options.maxLineDistance ?? 15;

  if (!finding || typeof finding !== 'object') {
    return { matched: false, benchmarkId: benchmark?.id, reason: 'invalid_finding' };
  }

  const findingFile = finding.file || finding.filePath || '';
  if (!isMatchingFile(findingFile, benchmark.file)) {
    return { matched: false, benchmarkId: benchmark.id, reason: 'file_mismatch' };
  }

  const findingLine = Number(finding.line) || 0;
  if (Math.abs(findingLine - benchmark.line) > maxLineDist) {
    return { matched: false, benchmarkId: benchmark.id, reason: 'line_out_of_range' };
  }

  // Validate specialist lens compatibility if present
  if (options.matchLens !== false && finding.lens && benchmark.lens) {
    const findingLens = String(finding.lens).trim().toLowerCase();
    const benchmarkLens = String(benchmark.lens).trim().toLowerCase();
    if (findingLens !== benchmarkLens) {
      return { matched: false, benchmarkId: benchmark.id, reason: 'lens_mismatch' };
    }
  }

  // Validate severity compatibility if present
  if (options.matchSeverity !== false && finding.severity && benchmark.expectedSeverity) {
    const severityRanks = { p0: 0, p1: 1, p2: 2, p3: 3, nit: 4 };
    const findingSev = String(finding.severity).trim().toLowerCase();
    const benchmarkSev = String(benchmark.expectedSeverity).trim().toLowerCase();

    if (options.matchSeverity === 'exact') {
      if (findingSev !== benchmarkSev) {
        return { matched: false, benchmarkId: benchmark.id, reason: 'severity_mismatch' };
      }
    } else {
      const findingRank = severityRanks[findingSev];
      const benchmarkRank = severityRanks[benchmarkSev];
      const maxSeverityDelta = options.maxSeverityDelta ?? 1;

      if (findingRank !== undefined && benchmarkRank !== undefined) {
        if (Math.abs(findingRank - benchmarkRank) > maxSeverityDelta) {
          return { matched: false, benchmarkId: benchmark.id, reason: 'severity_mismatch' };
        }
      }
    }
  }

  // Check text keyword matches
  const textContent = [
    finding.title,
    finding.body,
    finding.commentary,
    finding.rule,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matchedKeywords = benchmark.keywords.filter((kw) =>
    textContent.includes(kw.toLowerCase())
  );

  if (matchedKeywords.length === 0) {
    return { matched: false, benchmarkId: benchmark.id, reason: 'no_keyword_match' };
  }

  return {
    matched: true,
    benchmarkId: benchmark.id,
    dimension: benchmark.dimension,
    matchedKeywords,
  };
}

/**
 * Evaluates a set of code review findings against the benchmark defect suite.
 *
 * @param {Array<Object>} findings - Set of findings produced by reviewer
 * @param {Array<Object>} [benchmarks=CALIBRATION_BENCHMARKS] - Benchmark cases
 * @param {Object} [options={}] - Options passed to evaluateCalibrationFinding
 * @returns {Object} Evaluation report including recall, precision, and match details
 */
export function evaluateCalibrationSuite(findings = [], benchmarks = CALIBRATION_BENCHMARKS, options = {}) {
  const safeFindings = Array.isArray(findings) ? findings : [];
  const matched = [];
  const missed = [];
  const matchedFindingIndices = new Set();

  for (const benchmark of benchmarks) {
    let matchedIndex = -1;
    for (let i = 0; i < safeFindings.length; i++) {
      const evaluation = evaluateCalibrationFinding(safeFindings[i], benchmark, options);
      if (evaluation.matched) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex !== -1) {
      matched.push({
        benchmark,
        finding: safeFindings[matchedIndex],
      });
      matchedFindingIndices.add(matchedIndex);
    } else {
      missed.push(benchmark);
    }
  }

  const totalBenchmarks = benchmarks.length;
  const recall = totalBenchmarks > 0 ? matched.length / totalBenchmarks : 1.0;
  const precision =
    safeFindings.length > 0 ? Math.min(1.0, matchedFindingIndices.size / safeFindings.length) : 0.0;
  const passed = recall >= 0.8;

  return {
    totalBenchmarks,
    matchedCount: matched.length,
    missedCount: missed.length,
    recall,
    precision,
    passed,
    matched,
    missed,
  };
}
