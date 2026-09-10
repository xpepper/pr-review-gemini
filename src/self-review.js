import path from 'node:path';
import fs from 'node:fs';
import {
  getWorktreeDiff,
  generateSyntheticDiff,
  parseUnifiedDiff,
  isLargeDiff,
  generateDiffManifest,
  formatDiffManifest,
  createFileBackedDiff,
  LARGE_DIFF_THRESHOLD_BYTES,
} from './diff.js';
import { parseMarkdownFindings } from './publish.js';
import { loadConfig } from './config.js';
import {
  resolveReviewMode,
  deduplicateFindings,
  buildReviewerPrompt,
  LENS_DEFINITIONS,
} from './reviewer.js';
import {
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
} from './subagents.js';
import { formatFindingRow, formatFindingsTable } from './selection.js';

export {
  getWorktreeDiff,
  generateSyntheticDiff,
};

const SEVERITY_LEVELS = ['P0', 'P1', 'P2', 'P3', 'nit'];

/**
 * Resolves the list of blocking severities based on failOn threshold.
 *
 * @param {string} [failOn='P1'] - Threshold severity ('P0', 'P1', 'P2', 'P3', 'nit')
 * @returns {string[]}
 */
export function resolveBlockingSeverities(failOn = 'P1') {
  const normalized = (failOn || 'P1').toUpperCase();
  const index = SEVERITY_LEVELS.indexOf(normalized === 'NIT' ? 'nit' : normalized);
  if (index === -1) {
    return ['P0', 'P1'];
  }
  return SEVERITY_LEVELS.slice(0, index + 1);
}

/**
 * Evaluates the fail-closed pass/fail verdict on a list of review findings.
 *
 * @param {Array<object>} findings - List of review findings
 * @param {object} [options]
 * @param {string} [options.failOn='P1'] - Minimum severity to trigger failure
 * @param {Array<string>} [options.blockingSeverities] - Explicit list of blocking severities
 * @returns {object} Verdict summary
 */
export function evaluateSelfReviewVerdict(findings = [], options = {}) {
  const blockingSeverities =
    options.blockingSeverities || resolveBlockingSeverities(options.failOn || 'P1');

  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 };
  const blockingFindings = [];
  const remediation = [];

  for (const f of findings) {
    const sev = f.severity || 'P2';
    if (counts[sev] !== undefined) {
      counts[sev]++;
    } else {
      counts[sev] = 1;
    }

    if (blockingSeverities.includes(sev)) {
      blockingFindings.push(f);
      remediation.push({
        title: f.title || 'Untitled defect',
        severity: sev,
        file: f.filePath || f.file || '',
        line: f.line ?? null,
        side: f.side || 'RIGHT',
        remediation: f.commentary || f.body || f.title || 'Review code and correct issue.',
      });
    }
  }

  const blockingCount = blockingFindings.length;
  const status = blockingCount > 0 ? 'failed' : 'passed';
  const verdict = blockingCount > 0 ? 'FAIL' : 'PASS';

  return {
    status,
    verdict,
    blockingCount,
    blockingFindings,
    counts,
    remediation,
  };
}

/**
 * Formats a clean markdown report for self-review.
 */
export function formatSelfReviewSummary({
  verdict,
  status,
  findings = [],
  blockingFindings = [],
  counts = { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
  mode = 'balanced',
  diffStats = null,
  lenses = [],
  remediation = [],
  emptyDiff = false,
  executionErrors = [],
}) {
  const isPass = status === 'passed';
  const banner = isPass
    ? '# ✅ SELF-REVIEW PASSED (PASS)'
    : '# ❌ SELF-REVIEW FAILED (FAIL)';

  let diffSummary = '';
  if (diffStats) {
    const filesCount = diffStats.totalFiles ?? diffStats.filesCount ?? 0;
    const adds = diffStats.totalAdditions ?? 0;
    const dels = diffStats.totalDeletions ?? 0;
    diffSummary = ` | **Diff**: ${filesCount} files (+${adds} / -${dels})`;
  }

  const header = `${banner}\n\n**Status**: \`${status}\` | **Mode**: \`${mode}\`${diffSummary}`;

  if (emptyDiff) {
    return `${header}

No uncommitted changes detected in working tree. Self-review passed cleanly.`;
  }

  if (executionErrors.length > 0) {
    const errorLines = executionErrors.map((e) => `- **${e.lensName || e.lensId}**: ${e.error}`);
    return `${header}

> ⚠️ **Execution Errors Encountered**:
${errorLines.join('\n')}

Self-review failed closed due to execution errors during specialist subagent analysis.`;
  }

  const countSummary = `${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2, ${counts.P3} P3, ${counts.nit} nit`;
  const blockingCount = blockingFindings.length;

  if (isPass) {
    let findingsSection = '';
    if (findings.length > 0) {
      const advisoryItems = findings.map(
        (f) => `#### [${f.severity}] ${f.title}\n- **Location**: \`${f.filePath || f.file}${f.line ? `:${f.line}` : ''}\`\n- **Note**: ${f.commentary || f.body || f.title}`
      );
      findingsSection = `\n### Advisory Findings (${findings.length}):\n${advisoryItems.join('\n\n')}`;
    }

    const lensList = lenses.length > 0
      ? `\n### Evaluated Specialist Lenses:\n${lenses.map((l) => `- ✅ ${LENS_DEFINITIONS[l]?.name || l} (\`${l}\`)`).join('\n')}`
      : '';

    const noDefectsMsg = findings.length === 0
      ? 'No defects detected across evaluated specialist lenses. Working tree changes look clean and ready to commit.'
      : 'No blocking defects detected across evaluated specialist lenses. Working tree changes look clean and ready to commit.';

    return `${header}
**Findings**: 0 blocking | ${findings.length} advisory (${countSummary})

${noDefectsMsg}${findingsSection}${lensList}`;
  }

  // Failing report with remediation
  const remediationItems = remediation.map((item, idx) => {
    const loc = item.file ? `\`${item.file}${item.line ? `:${item.line}` : ''}\`` : 'General';
    return `#### ${idx + 1}. [${item.severity}] ${item.title}\n- **Location**: ${loc} (${item.side || 'RIGHT'})\n- **Remediation**: ${item.remediation}`;
  });

  return `${header}
**Findings**: ${blockingCount} blocking ${blockingCount === 1 ? 'issue' : 'issues'} detected (${countSummary})

> ⚠️ **Action Required**: The fail-closed safety gate blocked completion due to ${blockingCount} high-severity defect${blockingCount === 1 ? '' : 's'}.
> Please address the remediation steps below before finalizing your task or committing.

### 🚨 Blocking Issues & Remediation:

${remediationItems.join('\n\n')}`;
}

/**
 * Orchestrates a one-shot coding-task self-review on local worktree changes.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @param {'all' | 'staged' | 'unstaged' | 'head'} [options.scope='all'] - Scope of changes
 * @param {boolean} [options.includeUntracked=true] - Whether to include untracked files
 * @param {string} [options.diffText] - Direct diff text override
 * @param {string} [options.mode='balanced'] - Review mode
 * @param {string} [options.failOn='P1'] - Failure threshold severity
 * @param {Array<string>} [options.blockingSeverities] - Custom blocking severities list
 * @param {string} [options.customInstructions] - Custom instructions for specialist lenses
 * @param {object} [options.config] - Pre-loaded configuration
 * @param {Function} [options.runnerFn] - Subagent runner function
 * @param {Function} [options.execGitFn] - Git executor for testing
 * @param {Function} [options.execFileFn] - ExecFile executor for testing
 * @param {object} [options.fsModule] - Filesystem module for testing
 * @returns {Promise<object>} Self-review result
 */
export async function runSelfReview(options = {}) {
  const {
    cwd = process.cwd(),
    scope = 'all',
    includeUntracked = true,
    mode: rawMode = 'balanced',
    failOn = 'P1',
    blockingSeverities,
    customInstructions,
    runnerFn,
    execGitFn,
    execFileFn,
    fsModule = fs,
  } = options;

  const modeObj = resolveReviewMode(rawMode);
  const resolvedConfig = options.config || loadConfig(cwd);

  // 1. Acquire diff
  let diffText = options.diffText;
  if (diffText === undefined || diffText === null) {
    diffText = await getWorktreeDiff({
      cwd,
      scope,
      includeUntracked,
      execGitFn,
      execFileFn,
      fsModule,
    });
  }

  // 2. Handle empty diff (clean worktree)
  if (!diffText || !diffText.trim()) {
    const verdict = evaluateSelfReviewVerdict([], { failOn, blockingSeverities });
    const emptyStats = { totalFiles: 0, totalAdditions: 0, totalDeletions: 0, totalBytes: 0, isLarge: false };
    const summary = formatSelfReviewSummary({
      verdict: verdict.verdict,
      status: verdict.status,
      findings: [],
      counts: verdict.counts,
      mode: modeObj.name,
      diffStats: emptyStats,
      lenses: modeObj.lenses,
      emptyDiff: true,
    });

    return {
      status: verdict.status,
      verdict: verdict.verdict,
      mode: modeObj.name,
      findings: [],
      blockingFindings: [],
      blockingCount: 0,
      counts: verdict.counts,
      lenses: modeObj.lenses,
      diffStats: emptyStats,
      remediation: [],
      summary,
    };
  }

  // 3. Parse diff and detect large diff transport
  const parsedDiffs = parseUnifiedDiff(diffText);
  const isLarge = isLargeDiff(diffText);
  const manifest = generateDiffManifest(parsedDiffs, { threshold: LARGE_DIFF_THRESHOLD_BYTES });

  let fileBackedDiff = null;
  let diffTransport = null;

  try {
    if (isLarge) {
      fileBackedDiff = await createFileBackedDiff({ diffText });
      diffTransport = {
        isLarge: true,
        byteSize: fileBackedDiff.byteSize,
        diffFilePath: fileBackedDiff.diffFilePath,
        formattedManifest: fileBackedDiff.formattedManifest,
        manifest: fileBackedDiff.manifest,
        reader: fileBackedDiff.reader,
      };
    }

    // 4. Resolve lens plan
    const plan = resolveLensPlan(modeObj, resolvedConfig);

    // 5. Setup subagent runner
    const runner = runnerFn || (await createSubagentRunner({ cwd }));

    // 6. Dispatch parallel subagents
    const dispatchOutput = await dispatchSubagentsParallel({
      plan,
      diffText,
      customInstructions,
      diffTransport,
      runnerFn: runner,
      config: resolvedConfig,
    });

    const lensResults = dispatchOutput.results || [];
    const executionErrors = dispatchOutput.errors || lensResults.filter((r) => r.status === 'error');
    const allLensesErrored = executionErrors.length > 0 && executionErrors.length === plan.length;

    if (allLensesErrored) {
      const summary = formatSelfReviewSummary({
        verdict: 'FAIL',
        status: 'failed',
        findings: [],
        counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
        mode: modeObj.name,
        diffStats: manifest,
        lenses: modeObj.lenses,
        executionErrors,
      });

      return {
        status: 'failed',
        verdict: 'FAIL',
        mode: modeObj.name,
        findings: [],
        blockingFindings: [],
        blockingCount: 0,
        counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
        lenses: modeObj.lenses,
        diffStats: manifest,
        remediation: [],
        executionErrors,
        summary,
      };
    }

    // 7. Collect and deduplicate findings across lenses
    const rawFindings = [];
    if (Array.isArray(dispatchOutput.findings) && dispatchOutput.findings.length > 0) {
      rawFindings.push(...dispatchOutput.findings);
    } else {
      for (const res of lensResults) {
        if (res.status === 'error' || !res.output) continue;
        const parsed = parseMarkdownFindings(res.output);
        for (const item of parsed) {
          rawFindings.push({
            ...item,
            lensId: res.lensId,
            lensName: res.lensName,
          });
        }
      }
    }

    const deduplicated = deduplicateFindings(rawFindings);

    // 8. Evaluate fail-closed verdict
    const verdict = evaluateSelfReviewVerdict(deduplicated, { failOn, blockingSeverities });

    // 9. Format report summary
    const summary = formatSelfReviewSummary({
      verdict: verdict.verdict,
      status: verdict.status,
      findings: deduplicated,
      blockingFindings: verdict.blockingFindings,
      counts: verdict.counts,
      mode: modeObj.name,
      diffStats: manifest,
      lenses: modeObj.lenses,
      remediation: verdict.remediation,
      executionErrors,
    });

    return {
      status: verdict.status,
      verdict: verdict.verdict,
      mode: modeObj.name,
      findings: deduplicated,
      blockingFindings: verdict.blockingFindings,
      blockingCount: verdict.blockingCount,
      counts: verdict.counts,
      lenses: modeObj.lenses,
      diffStats: manifest,
      remediation: verdict.remediation,
      summary,
    };
  } finally {
    if (fileBackedDiff?.cleanup) {
      await fileBackedDiff.cleanup();
    }
  }
}
