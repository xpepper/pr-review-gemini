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
    isComment: false,
    commentId: null,
    commentBody: null,
    commentAuthorAssociation: null,
    commentUser: null,
    commandInfo: null,
    rawPayload: null,
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

  const isComment = Boolean(payload.comment);
  const isPr = Boolean(
    payload.pull_request ||
    (payload.issue && payload.issue.pull_request) ||
    (!payload.issue && payload.number && (payload.action === 'synchronize' || payload.action === 'opened' || payload.action === 'reopened'))
  );

  const prNumber =
    payload.pull_request?.number ||
    (isPr ? payload.issue?.number : null) ||
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

  const commentId = payload.comment?.id || null;
  const commentBody = payload.comment?.body || null;
  const commentAuthorAssociation =
    payload.comment?.author_association ||
    payload.sender?.author_association ||
    null;
  const commentUser = payload.comment?.user?.login || payload.sender?.login || null;
  const commandInfo = commentBody ? parseCommentCommand(commentBody) : null;

  return {
    isPullRequest: isPr,
    prNumber,
    repo,
    action,
    headSha,
    baseSha,
    sender,
    isComment,
    commentId,
    commentBody,
    commentAuthorAssociation,
    commentUser,
    commandInfo,
    rawPayload: payload,
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
    isComment: false,
    commentId: null,
    commentBody: null,
    commentAuthorAssociation: null,
    commentUser: null,
    commandInfo: null,
    rawPayload: null,
  };

  if (env.GITHUB_EVENT_PATH) {
    eventInfo = parseEventPayload(env.GITHUB_EVENT_PATH);
  } else if (options.eventPayload) {
    eventInfo = parseEventPayload(options.eventPayload);
  }

  const cmd = eventInfo.commandInfo;
  const isCommentCommand = Boolean(eventInfo.isComment && cmd?.isCommand);
  const isAuthorized = isCommentCommand
    ? isAuthorizedCommenter(eventInfo)
    : true;

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

  // 3. Review Mode (Command mode overrides action default if provided)
  const mode = options.mode || cmd?.mode || env.INPUT_MODE || 'balanced';

  // 4. Quality Gate fail_on
  let failOn = options.failOn || cmd?.failOn || env.INPUT_FAIL_ON || 'none';
  if (typeof failOn === 'string') {
    const upper = failOn.trim().toUpperCase();
    if (upper === 'NONE' || upper === 'OFF' || upper === 'FALSE' || upper === '') {
      failOn = 'none';
    } else if (SEVERITY_LEVELS.includes(upper) || upper === 'NIT') {
      failOn = upper === 'NIT' ? 'nit' : upper;
    }
  }

  // 5. Incremental review resolution
  const rawIncremental =
    options.incremental !== undefined
      ? options.incremental
      : cmd?.incremental !== null && cmd?.incremental !== undefined
      ? cmd.incremental
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
  const action = options.action || cmd?.action || env.INPUT_ACTION || 'publish';

  // 7. Select filter
  const select = options.select || cmd?.select || env.INPUT_SELECT || null;

  // 8. Specialist Roles & Composition
  const roles = options.roles || options.enabledRoles || (cmd?.roles && cmd.roles.length > 0 ? cmd.roles : null) || null;
  const replaceStandardRoles = Boolean(
    options.replaceStandardRoles ?? cmd?.replaceStandardRoles ?? false
  );

  // 9. Worktree Verification
  const verify = options.verify ?? cmd?.verify ?? null;

  // 10. GitHub Token
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
    roles,
    replaceStandardRoles,
    verify,
    githubToken,
    isComment: eventInfo.isComment,
    isCommentCommand,
    isAuthorized,
    commentId: eventInfo.commentId,
    commentBody: eventInfo.commentBody,
    commentAuthorAssociation: eventInfo.commentAuthorAssociation,
    commentUser: eventInfo.commentUser,
    commandInfo: cmd,
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
 * @param {object} [params.verificationResult]
 * @returns {string}
 */
export function formatCiSummary({ reviewResult, qualityGateResult, ciEnv, verificationResult = null }) {
  const isPass = qualityGateResult.passed;
  const banner = isPass ? '✅ AI Code Review Passed' : '❌ AI Code Review Failed Quality Gate';
  const lines = [];

  lines.push(`## ${banner}\n`);
  lines.push(`- **Verdict**: \`${qualityGateResult.verdict}\``);
  lines.push(`- **Mode**: \`${ciEnv.mode}\`${ciEnv.incremental ? ' *(incremental re-review)*' : ''}`);
  lines.push(`- **Findings Detected**: ${qualityGateResult.totalFindings}`);
  lines.push(`- **Blocking Defects**: ${qualityGateResult.blockingCount} *(Threshold: ${ciEnv.failOn})*`);
  lines.push(`- **Action**: \`${ciEnv.action}\``);
  if (verificationResult) {
    const vStatus = verificationResult.status === 'passed' ? '`PASSED`' : '`FAILED`';
    lines.push(`- **Detached Verification (${verificationResult.profile || 'test'})**: ${vStatus}`);
  }
  lines.push('');

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

/**
 * Parses a PR comment body to detect review commands (/gem-review or /gem-pr-review)
 * and extracts command options and flags.
 *
 * @param {string} commentBody
 * @returns {object}
 */
export function parseCommentCommand(commentBody) {
  const emptyResult = {
    isCommand: false,
    command: null,
    mode: null,
    incremental: null,
    roles: [],
    replaceStandardRoles: false,
    verify: null,
    failOn: null,
    action: null,
    select: null,
    help: false,
    rawArgs: [],
    unrecognizedArgs: [],
  };

  if (!commentBody || typeof commentBody !== 'string') {
    return emptyResult;
  }

  // Strip code blocks to prevent triggering on examples or quoted instructions
  const stripped = commentBody.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

  const lines = stripped.split('\n');
  let commandLine = null;
  let commandName = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\/(?:gem-review|gem-pr-review))\b(.*)$/i);
    if (match) {
      commandName = match[1].toLowerCase();
      commandLine = match[2];
      break;
    }
  }

  if (!commandName) {
    return emptyResult;
  }

  // Tokenize arguments with support for single and double quotes
  const tokens = [];
  const tokenRegex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let m;
  while ((m = tokenRegex.exec(commandLine)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(m[1]);
    } else if (m[2] !== undefined) {
      tokens.push(m[2]);
    } else {
      tokens.push(m[0]);
    }
  }

  let mode = null;
  let incremental = null;
  const roles = [];
  let replaceStandardRoles = false;
  let verify = null;
  let failOn = null;
  let action = null;
  let select = null;
  let help = false;
  const unrecognizedArgs = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--help' || token === '-h' || token.toLowerCase() === 'help') {
      help = true;
    } else if (token === '--quick' || token === '--balanced' || token === '--full' || token === '--deep') {
      mode = token.slice(2);
    } else if (token.startsWith('--mode=')) {
      mode = token.slice('--mode='.length);
    } else if (token === '--mode' && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      mode = tokens[++i];
    } else if (token === '--incremental') {
      if (i + 1 < tokens.length && (tokens[i + 1] === 'auto' || tokens[i + 1] === 'true' || tokens[i + 1] === 'false')) {
        const nextVal = tokens[++i];
        incremental = nextVal === 'auto' ? 'auto' : nextVal === 'true';
      } else {
        incremental = true;
      }
    } else if (token === '--no-incremental') {
      incremental = false;
    } else if (token.startsWith('--incremental=')) {
      const val = token.slice('--incremental='.length).toLowerCase();
      if (val === 'true' || val === '1') incremental = true;
      else if (val === 'false' || val === '0') incremental = false;
      else if (val === 'auto') incremental = 'auto';
    } else if (token.startsWith('--role=')) {
      const val = token.slice('--role='.length);
      const splitRoles = val.split(',').map((r) => r.trim()).filter(Boolean);
      roles.push(...splitRoles);
    } else if (token === '--role' && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      const val = tokens[++i];
      const splitRoles = val.split(',').map((r) => r.trim()).filter(Boolean);
      roles.push(...splitRoles);
    } else if (token === '--replace-standard-roles') {
      replaceStandardRoles = true;
    } else if (token === '--verify') {
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        verify = tokens[++i];
      } else {
        verify = true;
      }
    } else if (token === '--no-verify') {
      verify = false;
    } else if (token.startsWith('--verify=')) {
      verify = token.slice('--verify='.length);
    } else if (token.startsWith('--fail-on=') || token.startsWith('--failOn=')) {
      failOn = token.split('=')[1];
    } else if ((token === '--fail-on' || token === '--failOn') && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      failOn = tokens[++i];
    } else if (token === '--dry-run') {
      action = 'dry-run';
    } else if (token === '--publish') {
      action = 'publish';
    } else if (token.startsWith('--action=')) {
      action = token.slice('--action='.length);
    } else if (token === '--action' && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      action = tokens[++i];
    } else if (token.startsWith('--select=')) {
      select = token.slice('--select='.length);
    } else if (token === '--select' && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      select = tokens[++i];
    } else {
      unrecognizedArgs.push(token);
    }
  }

  return {
    isCommand: true,
    command: commandName,
    mode,
    incremental,
    roles,
    replaceStandardRoles,
    verify,
    failOn,
    action,
    select,
    help,
    rawArgs: tokens,
    unrecognizedArgs,
  };
}

const DEFAULT_ALLOWED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/**
 * Checks commenter authorization against GitHub author_association, repository write permissions,
 * and optional allowed user lists. Returns detailed authorization metadata.
 *
 * @param {object} payload
 * @param {object} [options={}]
 * @param {string[]} [options.allowedAssociations=['OWNER', 'MEMBER', 'COLLABORATOR']]
 * @param {string[]} [options.allowedUsers=[]]
 * @returns {{ authorized: boolean, association: string|null, username: string, reason: string }}
 */
export function getCommenterAuthorization(payload, options = {}) {
  const allowedAssociations = (options.allowedAssociations || DEFAULT_ALLOWED_ASSOCIATIONS).map((a) =>
    String(a).toUpperCase()
  );
  const allowedUsers = (options.allowedUsers || []).map((u) => String(u).toLowerCase());

  if (!payload || typeof payload !== 'object') {
    return {
      authorized: false,
      association: null,
      username: 'unknown',
      reason: 'Empty or invalid event payload.',
    };
  }

  const username =
    payload.commentUser ||
    payload.comment?.user?.login ||
    payload.sender?.login ||
    payload.user ||
    payload.username ||
    'unknown';

  const rawAssoc =
    payload.commentAuthorAssociation ||
    payload.comment?.author_association ||
    payload.sender?.author_association ||
    payload.author_association ||
    payload.authorAssociation ||
    null;

  const association = rawAssoc ? String(rawAssoc).toUpperCase() : null;

  // 1. Explicit allowed users check
  if (allowedUsers.includes(username.toLowerCase())) {
    return {
      authorized: true,
      association,
      username,
      reason: `Commenter '${username}' is in explicitly allowed users list.`,
    };
  }

  // 2. Author association check (GitHub sets OWNER, MEMBER, or COLLABORATOR for users with write/admin rights)
  if (association && allowedAssociations.includes(association)) {
    return {
      authorized: true,
      association,
      username,
      reason: `Author association '${association}' is authorized to trigger review commands.`,
    };
  }

  return {
    authorized: false,
    association,
    username,
    reason: `Author association '${association || 'NONE'}' is not authorized to trigger review commands.`,
  };
}

/**
 * Returns boolean indicating whether commenter is authorized to trigger review commands.
 *
 * @param {object} payload
 * @param {object} [options={}]
 * @returns {boolean}
 */
export function isAuthorizedCommenter(payload, options = {}) {
  return getCommenterAuthorization(payload, options).authorized;
}

const REACTION_MAP = {
  '+1': '+1',
  'thumbs_up': '+1',
  '👍': '+1',
  '-1': '-1',
  'thumbs_down': '-1',
  '👎': '-1',
  'laugh': 'laugh',
  'confused': 'confused',
  '😕': 'confused',
  'heart': 'heart',
  '❤️': 'heart',
  'hooray': 'hooray',
  '🎉': 'hooray',
  'rocket': 'rocket',
  '🚀': 'rocket',
  'eyes': 'eyes',
  '👀': 'eyes',
};

/**
 * Adds a reaction to a GitHub issue comment via GitHub API.
 *
 * @param {object} params
 * @param {string} params.repo
 * @param {number|string} params.commentId
 * @param {string} params.reaction - '+1', 'eyes', 'rocket', 'confused', or emoji
 * @param {Function} params.execGhFn
 * @returns {Promise<{ success: boolean, reaction?: string, id?: number, error?: string }>}
 */
export async function addCommentReaction({
  repo,
  commentId,
  reaction,
  execGhFn,
}) {
  if (!commentId || !repo || !reaction) {
    return { success: false, error: 'Missing repo, commentId, or reaction' };
  }

  if (!execGhFn) {
    return { success: false, error: 'execGhFn is required' };
  }

  const normalized = REACTION_MAP[reaction] || reaction;

  const args = [
    'api',
    '--method',
    'POST',
    `repos/${repo}/issues/comments/${commentId}/reactions`,
    '-f',
    `content=${normalized}`,
  ];

  try {
    const stdout = await execGhFn(args);
    let parsed = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Non-JSON response
    }
    return { success: true, reaction: normalized, id: parsed.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Posts a comment to a GitHub PR or issue thread via GitHub API.
 *
 * @param {object} params
 * @param {string} params.repo
 * @param {number|string} [params.prNumber]
 * @param {number|string} [params.issueNumber]
 * @param {string} params.body
 * @param {Function} params.execGhFn
 * @returns {Promise<{ success: boolean, id?: number, error?: string }>}
 */
export async function postIssueComment({
  repo,
  prNumber,
  issueNumber,
  body,
  execGhFn,
}) {
  const number = prNumber || issueNumber;
  if (!number || !repo || !body) {
    return { success: false, error: 'Missing repo, prNumber, or body' };
  }

  if (!execGhFn) {
    return { success: false, error: 'execGhFn is required' };
  }

  const args = [
    'api',
    '--method',
    'POST',
    `repos/${repo}/issues/${number}/comments`,
    '-f',
    `body=${body}`,
  ];

  try {
    const stdout = await execGhFn(args);
    let parsed = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Non-JSON response
    }
    return { success: true, id: parsed.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Formats a friendly denial reply when an unauthorized commenter attempts to run /gem-review.
 *
 * @param {object} [params={}]
 * @param {string} [params.username='user']
 * @param {string} [params.association='NONE']
 * @param {string} [params.command='/gem-review']
 * @returns {string}
 */
export function formatUnauthorizedReply({
  username = 'user',
  association = 'NONE',
  command = '/gem-review',
} = {}) {
  const cleanAssoc = association || 'NONE';
  return `> [!WARNING]
> **Gem PR Review Command Not Authorized**
>
> @${username}, your author association is \`${cleanAssoc}\`.
>
> To protect CI runner capacity and model quota, \`${command}\` commands can only be triggered by repository collaborators, members, or owners.
>
> If you are a contributor, please ask a repository maintainer to run the review command for you.`;
}

/**
 * Formats a comprehensive Markdown usage guide for PR comment review commands.
 *
 * @returns {string}
 */
export function formatHelpReply() {
  return `### 💎 Gem PR Review — Comment Commands Guide

Trigger automated multi-lens AI code reviews directly from pull request comments using \`/gem-review\` or \`/gem-pr-review\`.

#### Usage
\`\`\`
/gem-review [options]
/gem-pr-review [options]
\`\`\`

#### Review Modes
- \`--quick\`: Fast 3-lens review (correctness, contracts, conventions)
- \`--balanced\`: Standard 5-lens review (default)
- \`--full\`: Comprehensive 6-lens review (includes security, performance, tests)
- \`--deep\`: Focused deep-dive single lens review

#### Options & Flags
- \`--incremental\`: Only review changes introduced since the last review
- \`--role=<role-id>\`: Run specific specialist review roles (e.g. \`--role=a11y\`, \`--role=perf\`)
- \`--replace-standard-roles\`: Run only specified custom roles, skipping standard lenses
- \`--verify\`: Run detached worktree test verification against PR head commit
- \`--fail-on=<P0|P1|P2|P3|none>\`: Set CI quality gate failure threshold
- \`--select=<filter>\`: Filter findings to publish (e.g. \`--select=p0,p1\`, \`--select="min:p2"\`)
- \`--dry-run\`: Generate review summary without posting comments to the PR
- \`--help\`, \`-h\`: Display this command usage guide

#### Examples
- \`/gem-review --quick\`
- \`/gem-review --incremental\`
- \`/gem-review --role=a11y --role=perf\`
- \`/gem-review --full --fail-on=P1\``;
}

/**
 * Formats a concise completion reply posted to the comment thread.
 *
 * @param {object} [params={}]
 * @param {object} [params.qualityGateResult={}]
 * @param {object} [params.ciEnv={}]
 * @param {object} [params.verificationResult]
 * @returns {string}
 */
export function formatCompletionReply({
  qualityGateResult = {},
  ciEnv = {},
  verificationResult = null,
} = {}) {
  const verdict = qualityGateResult.verdict || 'PASS';
  const passed = qualityGateResult.passed !== false;
  const icon = passed ? '✅' : '❌';
  const findings = qualityGateResult.totalFindings ?? 0;
  const blocking = qualityGateResult.blockingCount ?? 0;
  const mode = ciEnv.mode || 'balanced';
  const incremental = ciEnv.incremental ? ' *(incremental)*' : '';
  const failOn = ciEnv.failOn || 'none';

  let verifyLine = '';
  if (verificationResult) {
    const vStatus = verificationResult.status === 'passed' ? '`PASSED`' : '`FAILED`';
    verifyLine = `\n> - **Detached Verification (${verificationResult.profile || 'test'})**: ${vStatus}`;
  }

  return `> ${icon} **Gem PR Review Complete**
>
> - **Verdict**: \`${verdict}\` (${passed ? 'Passed' : 'Failed quality gate'})
> - **Mode**: \`${mode}\`${incremental}
> - **Findings**: ${findings} detected (${blocking} blocking)
> - **Quality Gate (fail_on)**: \`${failOn}\`${verifyLine}`;
}

