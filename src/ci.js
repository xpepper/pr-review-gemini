/**
 * src/ci.js — Reusable GitHub Action & Automated CI Review Runner
 *
 * Provides event payload detection, CI environment resolution,
 * host-enforced quality gate evaluation, and GitHub Actions output integration.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveBlockingSeverities } from './self-review.js';

const SEVERITY_LEVELS = ['P0', 'P1', 'P2', 'P3', 'nit'];

/**
 * Parses GitHub event payload from object, JSON string, or file path.
 *
 * @param {object|string} payloadOrPath
 * @returns {object}
 */
export function parseEventPayload(payloadOrPath) {
  const emptyResult = {
    isPullRequest: false,
    prNumber: null,
    repo: null,
    action: null,
    headSha: null,
    baseSha: null,
    sender: null,
  };

  if (!payloadOrPath) {
    return emptyResult;
  }

  let payload = payloadOrPath;

  if (typeof payloadOrPath === 'string') {
    const trimmed = payloadOrPath.trim();
    if (!trimmed) {
      return emptyResult;
    }

    // Check if it's a file path
    try {
      if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
        const fileContent = fs.readFileSync(trimmed, 'utf8');
        payload = JSON.parse(fileContent);
      } else {
        payload = JSON.parse(trimmed);
      }
    } catch {
      return emptyResult;
    }
  }

  if (!payload || typeof payload !== 'object') {
    return emptyResult;
  }

  const isPr = Boolean(
    payload.pull_request ||
    (payload.issue && payload.issue.pull_request) ||
    payload.number && (payload.action === 'synchronize' || payload.action === 'opened' || payload.action === 'reopened')
  );

  const prNumber =
    payload.pull_request?.number ||
    payload.issue?.number ||
    (isPr ? payload.number : null) ||
    null;

  const repo =
    payload.repository?.full_name ||
    payload.pull_request?.base?.repo?.full_name ||
    null;

  const action = payload.action || null;
  const headSha = payload.pull_request?.head?.sha || null;
  const baseSha = payload.pull_request?.base?.sha || null;
  const sender = payload.sender?.login || null;

  return {
    isPullRequest: isPr,
    prNumber,
    repo,
    action,
    headSha,
    baseSha,
    sender,
  };
}

/**
 * Resolves CI environment configuration by combining explicit options,
 * GitHub Actions inputs (INPUT_*), event payload, and environment variables.
 *
 * @param {object} [options={}]
 * @param {object} [env=process.env]
 * @returns {object}
 */
export function resolveCiEnvironment(options = {}, env = process.env) {
  let eventInfo = {
    isPullRequest: false,
    prNumber: null,
    repo: null,
    action: null,
    headSha: null,
    baseSha: null,
    sender: null,
  };

  if (env.GITHUB_EVENT_PATH) {
    eventInfo = parseEventPayload(env.GITHUB_EVENT_PATH);
  }

  // 1. PR Number resolution
  let prNumber = null;
  if (options.prNumber != null && options.prNumber !== '') {
    prNumber = parseInt(String(options.prNumber), 10);
  } else if (env.INPUT_PR_NUMBER != null && env.INPUT_PR_NUMBER !== '') {
    prNumber = parseInt(String(env.INPUT_PR_NUMBER), 10);
  } else if (eventInfo.prNumber != null) {
    prNumber = eventInfo.prNumber;
  }

  // 2. Repository resolution
  let repo =
    options.repo ||
    env.INPUT_REPO ||
    eventInfo.repo ||
    env.GITHUB_REPOSITORY ||
    null;

  // 3. Review Mode
  const mode = options.mode || env.INPUT_MODE || 'balanced';

  // 4. Quality Gate fail_on
  let failOn = options.failOn || env.INPUT_FAIL_ON || 'none';
  if (typeof failOn === 'string') {
    const upper = failOn.trim().toUpperCase();
    if (upper === 'NONE' || upper === 'OFF' || upper === 'FALSE' || upper === '') {
      failOn = 'none';
    } else if (SEVERITY_LEVELS.includes(upper) || upper === 'NIT') {
      failOn = upper === 'NIT' ? 'nit' : upper;
    }
  }

  // 5. Incremental review resolution
  let rawIncremental =
    options.incremental !== undefined
      ? options.incremental
      : env.INPUT_INCREMENTAL !== undefined
      ? env.INPUT_INCREMENTAL
      : 'auto';

  let incremental = false;
  if (rawIncremental === true || rawIncremental === 'true' || rawIncremental === '1') {
    incremental = true;
  } else if (rawIncremental === false || rawIncremental === 'false' || rawIncremental === '0') {
    incremental = false;
  } else if (rawIncremental === 'auto') {
    // Automatically select incremental mode on synchronize events
    incremental = eventInfo.action === 'synchronize';
  }

  // 6. Review Action (publish vs dry-run)
  const action = options.action || env.INPUT_ACTION || 'publish';

  // 7. Select filter
  const select = options.select || env.INPUT_SELECT || null;

  // 8. GitHub Token
  const githubToken =
    options.githubToken ||
    env.INPUT_GITHUB_TOKEN ||
    env.GITHUB_TOKEN ||
    env.GH_TOKEN ||
    null;

  return {
    prNumber,
    repo,
    mode,
    failOn,
    incremental,
    action,
    select,
    githubToken,
    eventInfo,
  };
}

/**
 * Evaluates CI quality gate against review findings.
 *
 * @param {Array<object>} findings
 * @param {object} [options={}]
 * @param {string} [options.failOn='none']
 * @returns {object}
 */
export function evaluateCiQualityGate(findings = [], options = {}) {
  const failOn = (options.failOn || 'none').toUpperCase();

  if (failOn === 'NONE' || failOn === 'OFF' || failOn === 'FALSE' || !failOn) {
    return {
      passed: true,
      verdict: 'PASS',
      blockingCount: 0,
      blockingFindings: [],
      totalFindings: findings.length,
      remediation: [],
    };
  }

  const blockingSeverities = resolveBlockingSeverities(failOn);
  const blockingFindings = [];
  const remediation = [];

  for (const f of findings) {
    const sev = f.severity || 'P2';
    if (blockingSeverities.includes(sev)) {
      blockingFindings.push(f);
      remediation.push({
        title: f.title || 'Untitled finding',
        severity: sev,
        file: f.filePath || f.file || '',
        line: f.line ?? null,
        side: f.side || 'RIGHT',
        remediation: f.commentary || f.body || f.title || 'Review code and correct issue.',
      });
    }
  }

  const blockingCount = blockingFindings.length;
  const passed = blockingCount === 0;
  const verdict = passed ? 'PASS' : 'FAIL';

  return {
    passed,
    verdict,
    blockingCount,
    blockingFindings,
    totalFindings: findings.length,
    remediation,
  };
}

/**
 * Writes outputs to GITHUB_OUTPUT file adhering to GitHub Actions multiline syntax.
 *
 * @param {Record<string, any>} outputs
 * @param {object} [options={}]
 * @param {string} [options.outputFile]
 */
export function writeGitHubStepOutputs(outputs = {}, options = {}) {
  const outputFile = options.outputFile || process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }

  let buffer = '';
  for (const [key, rawValue] of Object.entries(outputs)) {
    const value = rawValue == null ? '' : String(rawValue);
    if (value.includes('\n')) {
      const delimiter = `ghadelimiter_${crypto.randomBytes(8).toString('hex')}`;
      buffer += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    } else {
      buffer += `${key}=${value}\n`;
    }
  }

  try {
    fs.appendFileSync(outputFile, buffer, 'utf8');
  } catch (err) {
    // Non-fatal logging if writing output fails
    console.warn(`[CI] Warning: Failed to write GITHUB_OUTPUT to ${outputFile}: ${err.message}`);
  }
}

/**
 * Formats a clean CI markdown summary suitable for GITHUB_STEP_SUMMARY and step logs.
 *
 * @param {object} params
 * @param {object} params.reviewResult
 * @param {object} params.qualityGateResult
 * @param {object} params.ciEnv
 * @returns {string}
 */
export function formatCiSummary({ reviewResult, qualityGateResult, ciEnv }) {
  const isPass = qualityGateResult.passed;
  const banner = isPass ? '✅ AI Code Review Passed' : '❌ AI Code Review Failed Quality Gate';
  const lines = [];

  lines.push(`## ${banner}\n`);
  lines.push(`- **Verdict**: \`${qualityGateResult.verdict}\``);
  lines.push(`- **Mode**: \`${ciEnv.mode}\`${ciEnv.incremental ? ' *(incremental re-review)*' : ''}`);
  lines.push(`- **Findings Detected**: ${qualityGateResult.totalFindings}`);
  lines.push(`- **Blocking Defects**: ${qualityGateResult.blockingCount} *(Threshold: ${ciEnv.failOn})*`);
  lines.push(`- **Action**: \`${ciEnv.action}\`\n`);

  if (!isPass && qualityGateResult.blockingFindings.length > 0) {
    lines.push('### 🚫 Blocking Issues\n');
    lines.push('| Severity | Location | Title |');
    lines.push('| :--- | :--- | :--- |');
    for (const b of qualityGateResult.blockingFindings) {
      const loc = b.filePath ? `${b.filePath}${b.line ? `:${b.line}` : ''}` : 'General';
      lines.push(`| **${b.severity}** | \`${loc}\` | ${b.title || 'Untitled defect'} |`);
    }
    lines.push('');
  }

  if (reviewResult?.summary) {
    lines.push('### 📝 Review Details\n');
    lines.push(reviewResult.summary);
  }

  return lines.join('\n');
}
