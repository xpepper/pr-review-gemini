import { execFile } from 'node:child_process';
import { parseUnifiedDiff, getFileDiff, isLineCommentable, getPrDiff } from './diff.js';

/**
 * Maximum number of inline comments allowed per published PR review.
 * Prevents GitHub API rate limits and reviewer spam.
 */
export const MAX_INLINE_COMMENTS = 50;

/**
 * Valid review finding severity levels.
 */
export const VALID_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'nit']);

/**
 * Relative priority rank of severities (lower index = higher urgency).
 */
export const SEVERITY_RANK = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  nit: 4,
});

/**
 * Delimited JSON envelope markers used by AI review models.
 */
export const JSON_ENVELOPE_START = '<<<PR_REVIEW_JSON>>>';
export const JSON_ENVELOPE_END = '<<<END_PR_REVIEW_JSON>>>';

/**
 * Cleans backticks, quotes, and whitespace from file paths.
 *
 * @param {string | null | undefined} rawPath
 * @returns {string}
 */
function cleanFilePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let cleaned = rawPath.trim();
  if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith('a/') || cleaned.startsWith('b/')) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Normalizes a severity string to standard vocabulary.
 *
 * @param {string | null | undefined} raw
 * @returns {'P0' | 'P1' | 'P2' | 'P3' | 'nit'}
 */
function normalizeSeverity(raw) {
  if (!raw || typeof raw !== 'string') return 'P2';
  const upper = raw.trim().toUpperCase();
  if (upper === 'NIT') return 'nit';
  if (VALID_SEVERITIES.includes(upper)) return upper;
  return 'P2';
}

/**
 * Parses confidence score into a float between 0.0 and 1.0.
 *
 * @param {number | string | null | undefined} raw
 * @returns {number}
 */
function normalizeConfidence(raw) {
  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return Math.max(0, Math.min(1, raw));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.endsWith('%')) {
      const parsedPct = parseFloat(trimmed.slice(0, -1));
      if (!Number.isNaN(parsedPct)) return Math.max(0, Math.min(1, parsedPct / 100));
    }
    const parsed = parseFloat(trimmed);
    if (!Number.isNaN(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return 1.0;
}

/**
 * Normalizes a line number to a positive integer or null.
 *
 * @param {number | string | null | undefined} raw
 * @returns {number | null}
 */
function normalizeLine(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const match = raw.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      if (Number.isInteger(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Extracts and parses finding objects from Markdown review text, structured bullet lists,
 * or embedded JSON blocks.
 *
 * @param {string | Array<object>} input - Markdown string or finding object array
 * @returns {Array<object>} Parsed finding objects
 */
export function parseMarkdownFindings(input) {
  if (!input) return [];

  // If already an array of finding objects, normalize each entry
  if (Array.isArray(input)) {
    return input.map((item) => ({
      title: item.title || '',
      severity: normalizeSeverity(item.severity),
      confidence: normalizeConfidence(item.confidence),
      filePath: cleanFilePath(item.filePath || item.path || item.file),
      line: normalizeLine(item.line ?? item.endLine ?? item.startLine),
      side: item.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      commentary: item.commentary || item.body || item.description || item.actual || '',
    }));
  }

  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const text = input.trim();
  const findings = [];

  // 1. Try parsing delimited JSON envelope (<<<PR_REVIEW_JSON>>> ... <<<END_PR_REVIEW_JSON>>>)
  if (text.includes(JSON_ENVELOPE_START) && text.includes(JSON_ENVELOPE_END)) {
    try {
      const startIndex = text.indexOf(JSON_ENVELOPE_START) + JSON_ENVELOPE_START.length;
      const endIndex = text.indexOf(JSON_ENVELOPE_END);
      const jsonContent = text.slice(startIndex, endIndex).trim();
      const parsed = JSON.parse(jsonContent);

      const items = Array.isArray(parsed)
        ? parsed
        : parsed.candidates || parsed.findings || parsed.decisions || [];

      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const loc = item.location || {};
          findings.push({
            title: item.title || '',
            severity: normalizeSeverity(item.severity),
            confidence: normalizeConfidence(item.confidence),
            filePath: cleanFilePath(item.filePath || item.path || loc.path),
            line: normalizeLine(item.line ?? loc.endLine ?? loc.startLine),
            side: (item.side || loc.side) === 'LEFT' ? 'LEFT' : 'RIGHT',
            commentary:
              item.commentary ||
              item.actual ||
              [item.trigger, item.expected, item.actual].filter(Boolean).join('\n\n') ||
              '',
          });
        }
        return findings;
      }
    } catch {
      // Fall through to markdown parsing if JSON fails
    }
  }

  // 2. Try parsing fenced ```json blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let codeBlockMatch;
  while ((codeBlockMatch = jsonCodeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      const items = Array.isArray(parsed)
        ? parsed
        : parsed.findings || parsed.candidates || [];
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          findings.push({
            title: item.title || '',
            severity: normalizeSeverity(item.severity),
            confidence: normalizeConfidence(item.confidence),
            filePath: cleanFilePath(item.filePath || item.path || item.location?.path),
            line: normalizeLine(item.line ?? item.location?.endLine),
            side: item.side === 'LEFT' ? 'LEFT' : 'RIGHT',
            commentary: item.commentary || item.body || item.actual || '',
          });
        }
        return findings;
      }
    } catch {
      // Not a valid JSON finding block, continue parsing markdown
    }
  }

  // 3. Parse Markdown heading blocks:
  // e.g. ### [P1] Title or ### Finding: [P2] Title
  const headingSectionRegex = /(?:^|\n)#{1,4}\s+(?:Finding(?:\s+\d+)?:?\s*)?(?:\[(P[0-3]|nit)\])?\s*([^\n]+)\n([\s\S]*?)(?=(?:\n#{1,4}\s+)|$)/gi;
  let match;
  let hasHeadingFindings = false;

  while ((match = headingSectionRegex.exec(text)) !== null) {
    const rawHeaderSeverity = match[1];
    const headerTitle = match[2]?.trim() || '';
    const sectionBody = match[3] || '';

    // Extract fields from section body:
    // - **File**: `path` or File: path
    // - **Line**: 12
    // - **Confidence**: 0.95
    // - **Severity**: P1
    const fileMatch = sectionBody.match(/(?:-|\*)\s*\*\*?(?:File|Path)\*\*?:\s*`?([^`\r\n]+)`?/i) ||
      sectionBody.match(/(?:File|Path):\s*`?([^`\r\n]+)`?/i);
    const lineMatch = sectionBody.match(/(?:-|\*)\s*\*\*?Line\*\*?:\s*(\d+)/i) ||
      sectionBody.match(/(?:Line|L):\s*(\d+)/i);
    const confMatch = sectionBody.match(/(?:-|\*)\s*\*\*?Confidence\*\*?:\s*([0-9.]+%?)/i) ||
      sectionBody.match(/(?:Confidence):\s*([0-9.]+%?)/i);
    const sevMatch = sectionBody.match(/(?:-|\*)\s*\*\*?Severity\*\*?:\s*`?([a-z0-9]+)`?/i);
    const sideMatch = sectionBody.match(/(?:-|\*)\s*\*\*?Side\*\*?:\s*(RIGHT|LEFT)/i);

    if (fileMatch || rawHeaderSeverity || sevMatch) {
      hasHeadingFindings = true;
      let rawFilePath = fileMatch?.[1] || '';
      let rawLine = lineMatch?.[1] || null;
      if (rawFilePath && !rawLine) {
        const colonMatch = rawFilePath.match(/^(.+?):(\d+)$/);
        if (colonMatch) {
          rawFilePath = colonMatch[1];
          rawLine = colonMatch[2];
        }
      }

      // Strip metadata lines from commentary
      const commentaryLines = sectionBody
        .split(/\r?\n/)
        .filter((l) => !/^\s*(?:-|\*)\s*\*\*?(?:File|Path|Line|Confidence|Severity|Side)\*\*?:/i.test(l));

      findings.push({
        title: headerTitle,
        severity: normalizeSeverity(rawHeaderSeverity || sevMatch?.[1]),
        confidence: normalizeConfidence(confMatch?.[1]),
        filePath: cleanFilePath(rawFilePath),
        line: normalizeLine(rawLine),
        side: sideMatch?.[1]?.toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT',
        commentary: commentaryLines.join('\n').trim(),
      });
    }
  }

  if (hasHeadingFindings && findings.length > 0) {
    return findings;
  }

  // 4. Parse bullet-list style findings:
  // e.g. - **[P0]** `src/auth.js:45` (confidence: 0.9): Commentary
  const bulletRegex = /(?:^|\n)\s*[-*]\s*(?:\*\*\[(P[0-3]|nit)\]\*\*|\[(P[0-3]|nit)\])\s*(?:`?([^`:\s]+):(\d+)`?)?\s*(?:\(confidence:\s*([0-9.]+%?)\))?:?\s*([\s\S]*?)(?=(?:\n\s*[-*]\s*(?:\*\*\[|\[)(?:P[0-3]|nit))|$)/gi;

  while ((match = bulletRegex.exec(text)) !== null) {
    const sev = match[1] || match[2];
    const path = match[3];
    const line = match[4];
    const conf = match[5];
    const commentary = match[6]?.trim() || '';

    findings.push({
      title: '',
      severity: normalizeSeverity(sev),
      confidence: normalizeConfidence(conf),
      filePath: cleanFilePath(path),
      line: normalizeLine(line),
      side: 'RIGHT',
      commentary,
    });
  }

  return findings;
}

/**
 * Classifies review findings against PR unified diff hunks.
 * Anchored findings become inline comments; unanchored or overflow findings are demoted to summary.
 *
 * @param {Array<object>} findings - Array of parsed findings
 * @param {Array<object> | string} diffs - Parsed file diffs or raw unified diff string
 * @param {object} [options]
 * @param {number} [options.maxInlineComments=MAX_INLINE_COMMENTS] - Cap on inline comments
 * @returns {{ inlineComments: Array<object>, demotedFindings: Array<object>, allFindings: Array<object> }}
 */
export function classifyFindings(findings, diffs, options = {}) {
  const maxInlineComments = options.maxInlineComments ?? MAX_INLINE_COMMENTS;
  const parsedDiffs = typeof diffs === 'string' ? parseUnifiedDiff(diffs) : Array.isArray(diffs) ? diffs : [];

  const commentableCandidates = [];
  const demotedFindings = [];
  const allFindings = [];

  for (const rawFinding of findings || []) {
    const finding = { ...rawFinding };

    if (!finding.filePath || !finding.line) {
      finding.anchored = false;
      finding.demoteReason = 'Missing file path or line number';
      demotedFindings.push(finding);
      allFindings.push(finding);
      continue;
    }

    const fileDiff = getFileDiff(parsedDiffs, finding.filePath);
    if (!fileDiff) {
      finding.anchored = false;
      finding.demoteReason = `File "${finding.filePath}" is not modified in PR diff`;
      demotedFindings.push(finding);
      allFindings.push(finding);
      continue;
    }

    if (fileDiff.isBinary || fileDiff.status === 'binary') {
      finding.anchored = false;
      finding.demoteReason = `File "${finding.filePath}" is a binary file`;
      demotedFindings.push(finding);
      allFindings.push(finding);
      continue;
    }

    if (finding.side === 'RIGHT' && fileDiff.status === 'deleted') {
      finding.anchored = false;
      finding.demoteReason = `File "${finding.filePath}" was deleted in this PR`;
      demotedFindings.push(finding);
      allFindings.push(finding);
      continue;
    }

    const commentable = isLineCommentable(fileDiff, finding.line, { side: finding.side || 'RIGHT' });
    if (!commentable) {
      finding.anchored = false;
      finding.demoteReason = `Line ${finding.line} is outside diff hunks`;
      demotedFindings.push(finding);
      allFindings.push(finding);
      continue;
    }

    finding.anchored = true;
    commentableCandidates.push(finding);
    allFindings.push(finding);
  }

  // Cap inline comments at maxInlineComments
  let inlineComments = [];
  if (commentableCandidates.length > maxInlineComments) {
    // Sort commentable findings by severity urgency (P0 > P1 > P2 > P3 > nit), then descending confidence
    commentableCandidates.sort((a, b) => {
      const rankA = SEVERITY_RANK[a.severity] ?? 99;
      const rankB = SEVERITY_RANK[b.severity] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return (b.confidence ?? 1.0) - (a.confidence ?? 1.0);
    });

    inlineComments = commentableCandidates.slice(0, maxInlineComments);
    const overflow = commentableCandidates.slice(maxInlineComments);

    for (const item of overflow) {
      item.anchored = false;
      item.demoteReason = `Exceeded max inline comments limit (${maxInlineComments})`;
      demotedFindings.push(item);
    }
  } else {
    inlineComments = commentableCandidates;
  }

  return {
    inlineComments,
    demotedFindings,
    allFindings,
  };
}

/**
 * Formats a finding into an inline review comment body.
 *
 * @param {object} finding
 * @returns {string} Markdown comment body
 */
export function formatInlineComment(finding) {
  const parts = [];
  const titlePart = finding.title ? ` ${finding.title}` : '';
  const confText = typeof finding.confidence === 'number' ? ` (confidence: ${finding.confidence})` : '';

  parts.push(`**[${finding.severity}]${titlePart}**${confText}`);

  if (finding.commentary) {
    parts.push('');
    parts.push(finding.commentary);
  }

  return parts.join('\n');
}

/**
 * Formats the review summary body, appending any demoted or unanchored findings
 * to ensure all feedback is visible.
 *
 * @param {object} params
 * @param {string} [params.summary=''] - Main review summary prose
 * @param {Array<object>} [params.demotedFindings=[]] - Findings demoted from inline comments
 * @param {number} [params.inlineCommentsCount=0] - Number of inline comments posted
 * @param {'COMMENT' | 'APPROVE'} [params.reviewEvent='COMMENT'] - Review event verdict
 * @returns {string} Formatted review body
 */
export function formatReviewSummary({
  summary = '',
  demotedFindings = [],
  inlineCommentsCount = 0,
  reviewEvent = 'COMMENT',
} = {}) {
  const sections = [];
  if (summary && summary.trim()) {
    sections.push(summary.trim());
  }

  if (Array.isArray(demotedFindings) && demotedFindings.length > 0) {
    const demotedLines = [
      '### Additional Findings (Unanchored / General)',
      'The following findings could not be anchored to diff hunks or exceeded the inline comment cap:',
      '',
    ];

    for (const item of demotedFindings) {
      const loc = item.filePath
        ? item.line
          ? `${item.filePath}:${item.line}`
          : item.filePath
        : 'general';
      const reason = item.demoteReason ? ` (${item.demoteReason})` : '';
      const title = item.title ? `: ${item.title}` : '';
      const commentary = item.commentary ? `\n  ${item.commentary.replace(/\n/g, '\n  ')}` : '';

      demotedLines.push(`- **[${item.severity}]** \`${loc}\`${reason}${title}${commentary}`);
    }

    sections.push(demotedLines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Determines the GitHub review event (COMMENT or APPROVE) based on configuration safety gates.
 * NEVER emits REQUEST_CHANGES.
 *
 * @param {object} params
 * @param {Array<object>} [params.findings=[]] - Review findings
 * @param {'off' | 'P2' | 'P3' | 'nit'} [params.approveMaxPriorityLevel='off'] - Configuration threshold
 * @param {string | null} [params.prAuthor=null] - Author of the PR
 * @param {string | null} [params.currentUser=null] - Currently authenticated user
 * @param {string | null} [params.requestedEvent=null] - Explicitly requested event
 * @returns {'COMMENT' | 'APPROVE'} Gated review event
 */
export function determineReviewEvent({
  findings = [],
  approveMaxPriorityLevel = 'off',
  prAuthor = null,
  currentUser = null,
  requestedEvent = null,
} = {}) {
  // Gate 1: Never emit REQUEST_CHANGES
  if (requestedEvent === 'REQUEST_CHANGES') {
    return 'COMMENT';
  }

  // Gate 2: Cannot approve one's own PR
  if (prAuthor && currentUser && prAuthor.toLowerCase() === currentUser.toLowerCase()) {
    return 'COMMENT';
  }

  // Gate 3: If approval threshold is disabled ('off'), default to COMMENT
  if (approveMaxPriorityLevel === 'off' || !approveMaxPriorityLevel) {
    return 'COMMENT';
  }

  // Gate 4: Check if findings exceed approveMaxPriorityLevel
  const maxAllowedRank = SEVERITY_RANK[approveMaxPriorityLevel];
  if (maxAllowedRank === undefined) {
    return 'COMMENT';
  }

  // Any finding with rank < maxAllowedRank has higher urgency and prevents approval
  for (const finding of findings || []) {
    const rank = SEVERITY_RANK[finding.severity] ?? 99;
    if (rank < maxAllowedRank) {
      return 'COMMENT';
    }
  }

  return 'APPROVE';
}

/**
 * Helper to run a `gh` CLI command supporting dependency injection.
 *
 * @param {Array<string>} args
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {string | null} [options.input=null]
 * @param {Function | null} [options.execGhFn=null]
 * @param {Function | null} [options.execFileFn=null]
 * @returns {Promise<string>}
 */
async function runGh(args, { cwd = process.cwd(), input = null, execGhFn = null, execFileFn = null } = {}) {
  if (execGhFn) {
    // If execGhFn is an execFile callback signature (file, args, opts, cb)
    if (execGhFn.length >= 4) {
      return new Promise((resolve, reject) => {
        const child = execGhFn('gh', args, { cwd }, (err, stdout, stderr) => {
          if (err) {
            const detail = (stderr && stderr.trim()) || err.message;
            reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
            return;
          }
          resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
        });
        if (input && child?.stdin) {
          child.stdin.write(input);
          child.stdin.end();
        }
      });
    }
    // Async runner signature: (args, { cwd, input })
    const result = await execGhFn(args, { cwd, input });
    return typeof result === 'string' ? result : result?.toString?.() ?? '';
  }

  if (execFileFn) {
    return new Promise((resolve, reject) => {
      const child = execFileFn('gh', args, { cwd }, (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr && stderr.trim()) || err.message;
          reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
      });
      if (input && child?.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && stderr.trim()) || err.message;
        reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
    });
    if (input && child?.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Queries PR state and checks head freshness to prevent stale review submissions.
 *
 * @param {object} params
 * @param {number | string} params.prNumber - Pull request number
 * @param {string | null} [params.expectedHeadSha=null] - Expected commit SHA
 * @param {Function | null} [params.execGhFn=null] - Optional runner for testing
 * @param {Function | null} [params.execFileFn=null] - Optional execFile runner for testing
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ headRefOid: string, author: string, state: string }>}
 */
export async function checkHeadFreshness({
  prNumber,
  expectedHeadSha = null,
  execGhFn = null,
  execFileFn = null,
  cwd = process.cwd(),
} = {}) {
  const prNum = Number(prNumber);
  if (!Number.isInteger(prNum) || prNum <= 0) {
    throw new TypeError(`Invalid PR number: "${prNumber}". Expected a positive integer.`);
  }

  const stdout = await runGh(
    ['pr', 'view', String(prNum), '--json', 'headRefOid,author,state'],
    { cwd, execGhFn, execFileFn }
  );

  let parsed = {};
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse PR metadata for #${prNum}: ${err.message}`);
  }

  const headRefOid = parsed.headRefOid || '';
  const author = parsed.author?.login || '';
  const state = parsed.state || '';

  if (expectedHeadSha && expectedHeadSha.trim() !== headRefOid.trim()) {
    throw new Error(
      `Head SHA mismatch for PR #${prNum}: expected ${expectedHeadSha}, but PR head is ${headRefOid}. PR has been updated; rerun review.`
    );
  }

  return { headRefOid, author, state };
}

/**
 * Retrieves the currently authenticated GitHub user login.
 *
 * @param {object} [options]
 * @returns {Promise<string | null>}
 */
export async function getCurrentUser({ execGhFn = null, execFileFn = null, cwd = process.cwd() } = {}) {
  try {
    const stdout = await runGh(['api', 'user'], { cwd, execGhFn, execFileFn });
    const parsed = JSON.parse(stdout);
    return parsed.login || null;
  } catch {
    return null;
  }
}

/**
 * Publishes a code review to GitHub atomically with diff anchor validation and safety gates.
 *
 * @param {object} params
 * @param {number | string} params.prNumber - Pull request number
 * @param {string} [params.reviewBody=''] - Review summary markdown
 * @param {string | Array<object>} [params.findings=[]] - Markdown findings or structured array
 * @param {string | null} [params.diffText=null] - Raw unified diff text (fetched via gh pr diff if omitted)
 * @param {string | null} [params.expectedHeadSha=null] - Expected PR head commit SHA for stale checking
 * @param {object} [params.config={}] - Resolved configuration (approveMaxPriorityLevel, etc.)
 * @param {Function | null} [params.execGhFn=null] - Custom gh CLI runner for testing
 * @param {Function | null} [params.execFileFn=null] - Custom execFile runner for testing
 * @param {string} [params.cwd=process.cwd()] - Current working directory
 * @param {string | null} [params.repo=null] - GitHub repository (owner/name); defaults to local repository context
 * @returns {Promise<object>} Outcome summary with review ID, URL, and counts
 */
export async function publishReview({
  prNumber,
  reviewBody = '',
  findings = [],
  diffText = null,
  expectedHeadSha = null,
  config = {},
  execGhFn = null,
  execFileFn = null,
  cwd = process.cwd(),
  repo = null,
} = {}) {
  const prNum = Number(prNumber);
  if (!Number.isInteger(prNum) || prNum <= 0) {
    throw new TypeError(`Invalid PR number: "${prNumber}". Expected a positive integer.`);
  }

  // 1. Verify head freshness & obtain PR metadata
  const headInfo = await checkHeadFreshness({
    prNumber: prNum,
    expectedHeadSha,
    execGhFn,
    execFileFn,
    cwd,
  });

  // 2. Obtain current authenticated GitHub user
  const currentUser = await getCurrentUser({ execGhFn, execFileFn, cwd });

  // 3. Acquire unified diff (use provided diffText or fetch via getPrDiff)
  let rawDiff = diffText;
  if (typeof rawDiff !== 'string') {
    if (execGhFn && typeof execGhFn === 'function' && execGhFn.length < 4) {
      const adaptedExecFile = (_cmd, args, _opts, callback) => {
        Promise.resolve(execGhFn(args, _opts))
          .then((out) => callback(null, out, ''))
          .catch((err) => callback(err, '', err.message));
      };
      rawDiff = await getPrDiff(prNum, { cwd, execFileFn: adaptedExecFile });
    } else {
      rawDiff = await getPrDiff(prNum, { cwd, execFileFn: execFileFn || execGhFn });
    }
  }
  const parsedDiffs = parseUnifiedDiff(rawDiff);

  // 4. Parse findings
  const parsedFindings = parseMarkdownFindings(findings);

  // 5. Classify findings & validate diff anchors
  const { inlineComments, demotedFindings, allFindings } = classifyFindings(
    parsedFindings,
    parsedDiffs,
    { maxInlineComments: MAX_INLINE_COMMENTS }
  );

  // 6. Determine review event verdict (COMMENT or APPROVE)
  const event = determineReviewEvent({
    findings: allFindings,
    approveMaxPriorityLevel: config.approveMaxPriorityLevel ?? 'off',
    prAuthor: headInfo.author,
    currentUser,
  });

  // 7. Format review summary body
  const formattedBody = formatReviewSummary({
    summary: reviewBody,
    demotedFindings,
    inlineCommentsCount: inlineComments.length,
    reviewEvent: event,
  });

  // 8. Prepare inline comments payload
  const commentsPayload = inlineComments.map((finding) => ({
    path: finding.filePath,
    line: finding.line,
    side: finding.side || 'RIGHT',
    body: formatInlineComment(finding),
  }));

  const reviewPayload = {
    commit_id: headInfo.headRefOid,
    event,
    body: formattedBody,
    comments: commentsPayload,
  };

  // 9. Post review atomically via gh api
  const apiEndpoint = repo
    ? `repos/${repo}/pulls/${prNum}/reviews`
    : `repos/:owner/:repo/pulls/${prNum}/reviews`;

  const apiArgs = ['api', '--method', 'POST', apiEndpoint, '--input', '-'];
  const responseRaw = await runGh(apiArgs, {
    cwd,
    input: JSON.stringify(reviewPayload),
    execGhFn,
    execFileFn,
  });

  let responseData = {};
  try {
    responseData = JSON.parse(responseRaw);
  } catch {
    responseData = { body: responseRaw };
  }

  return {
    success: true,
    reviewId: responseData.id ?? null,
    reviewUrl: responseData.html_url ?? null,
    event,
    headSha: headInfo.headRefOid,
    inlineCommentsCount: inlineComments.length,
    demotedFindingsCount: demotedFindings.length,
    totalFindingsCount: allFindings.length,
  };
}
