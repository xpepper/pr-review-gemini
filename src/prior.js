import { execFile } from 'node:child_process';
import { parseUnifiedDiff } from './diff.js';
import { parseMarkdownFindings } from './publish.js';

/**
 * Executes a git command with fallback to child_process.execFile.
 *
 * @param {Array<string>} args
 * @param {object} [options]
 * @param {Function} [options.execGitFn]
 * @param {string} [options.cwd=process.cwd()]
 * @returns {Promise<string>}
 */
async function runGit(args, { execGitFn = null, cwd = process.cwd() } = {}) {
  if (typeof execGitFn === 'function') {
    const res = await execGitFn(args, { cwd });
    return typeof res === 'string' ? res : res?.toString?.() ?? '';
  }

  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && stderr.trim()) || err.message;
        reject(new Error(`git ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
    });
  });
}

/**
 * Executes a gh command with fallback to child_process.execFile.
 *
 * @param {Array<string>} args
 * @param {object} [options]
 * @param {Function} [options.execGhFn]
 * @param {string} [options.cwd=process.cwd()]
 * @returns {Promise<string>}
 */
async function runGh(args, { execGhFn = null, cwd = process.cwd() } = {}) {
  if (typeof execGhFn === 'function') {
    const res = await execGhFn(args, { cwd });
    return typeof res === 'string' ? res : res?.toString?.() ?? '';
  }

  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && stderr.trim()) || err.message;
        reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
    });
  });
}

/**
 * Classifies commit relationship between the prior evaluated head and current PR head.
 *
 * Possible classifications:
 * - 'none': No prior review found on this pull request.
 * - 'same_head': Current head commit is identical to prior evaluated commit.
 * - 'incremental': Current head directly extends prior evaluated commit (linear descendant).
 * - 'diverged': Commits have diverged (e.g. rebase, force-push).
 *
 * @param {object} params
 * @param {string | null} params.priorHeadSha
 * @param {string} params.currentHeadSha
 * @param {Function} [params.execGitFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ relationship: 'none' | 'same_head' | 'incremental' | 'diverged', priorHeadSha: string | null, currentHeadSha: string, canIncremental: boolean, reason: string }>}
 */
export async function classifyCommitRelationship({
  priorHeadSha = null,
  currentHeadSha,
  execGitFn = null,
  cwd = process.cwd(),
} = {}) {
  const current = currentHeadSha ? currentHeadSha.trim() : '';
  const prior = priorHeadSha ? priorHeadSha.trim() : null;

  if (!prior) {
    return {
      relationship: 'none',
      priorHeadSha: null,
      currentHeadSha: current,
      canIncremental: false,
      reason: 'No prior review found on this pull request.',
    };
  }

  if (prior === current) {
    return {
      relationship: 'same_head',
      priorHeadSha: prior,
      currentHeadSha: current,
      canIncremental: false,
      reason: `PR head commit has not changed since the last review (${prior}).`,
    };
  }

  try {
    // Check whether prior commit is an ancestor of current commit
    await runGit(['merge-base', '--is-ancestor', prior, current], { execGitFn, cwd });
    return {
      relationship: 'incremental',
      priorHeadSha: prior,
      currentHeadSha: current,
      canIncremental: true,
      reason: `Current head (${current}) directly extends prior reviewed commit (${prior}).`,
    };
  } catch {
    return {
      relationship: 'diverged',
      priorHeadSha: prior,
      currentHeadSha: current,
      canIncremental: false,
      reason: `PR head (${current}) has diverged from prior reviewed commit (${prior}) via rebase or force-push.`,
    };
  }
}

/**
 * Extracts structured findings from prior review body and review comments.
 *
 * @param {object} params
 * @param {string} [params.reviewBody='']
 * @param {Array<object>} [params.reviewComments=[]]
 * @returns {Array<object>}
 */
export function extractPriorFindings({ reviewBody = '', reviewComments = [] } = {}) {
  const findings = [];
  const seenKeys = new Set();

  // 1. Parse findings from review body
  if (reviewBody) {
    const bodyFindings = parseMarkdownFindings(reviewBody);
    for (const f of bodyFindings) {
      const key = `${f.filePath}:${f.line}:${f.title || f.body || ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        findings.push(f);
      }
    }
  }

  // 2. Parse findings from review comments
  if (Array.isArray(reviewComments)) {
    for (const comment of reviewComments) {
      const body = comment.body || '';
      const filePath = comment.path || '';
      const line = Number(comment.line || comment.original_line || 1);
      const side = comment.side || 'RIGHT';

      // Attempt parsing via standard format parser
      const parsedComments = parseMarkdownFindings(body);
      if (parsedComments.length > 0) {
        for (const f of parsedComments) {
          f.filePath = f.filePath || filePath;
          f.line = f.line || line;
          f.side = f.side || side;
          const key = `${f.filePath}:${f.line}:${f.title || f.body || ''}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            findings.push(f);
          }
        }
      } else {
        // Extract basic severity and title from inline comment
        const matchSev = body.match(/\*\*\[(P0|P1|P2|P3|nit)\]\s*(.*?)\*\*/i);
        const severity = matchSev ? matchSev[1].toUpperCase() : 'P2';
        const title = matchSev && matchSev[2] ? matchSev[2].trim() : body.slice(0, 80);

        const key = `${filePath}:${line}:${title}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          findings.push({
            id: comment.id ? String(comment.id) : undefined,
            filePath,
            line,
            side,
            severity,
            title,
            commentary: body,
            body,
            confidence: 1.0,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Fetches prior reviews and review comments from GitHub API.
 *
 * @param {object} params
 * @param {number} params.prNumber
 * @param {string} [params.repo]
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ latestReview: object, findings: Array<object>, allReviews: Array<object> } | null>}
 */
export async function fetchPriorReviews({
  prNumber,
  repo = null,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  const num = Number(prNumber);
  const reviewsEndpoint = repo
    ? `repos/${repo}/pulls/${num}/reviews`
    : `repos/:owner/:repo/pulls/${num}/reviews`;
  const commentsEndpoint = repo
    ? `repos/${repo}/pulls/${num}/comments`
    : `repos/:owner/:repo/pulls/${num}/comments`;

  let reviews = [];
  try {
    const raw = await runGh(['api', reviewsEndpoint], { execGhFn, cwd });
    reviews = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return null;
  }

  // Filter for valid reviews with commit_id
  const validReviews = reviews.filter((r) => r.commit_id && r.state !== 'PENDING');
  if (validReviews.length === 0) {
    return null;
  }

  // Sort descending by submitted_at or id
  validReviews.sort((a, b) => {
    const timeA = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const timeB = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;
    return (b.id || 0) - (a.id || 0);
  });

  const latestReview = validReviews[0];

  let comments = [];
  try {
    const rawComments = await runGh(['api', commentsEndpoint], { execGhFn, cwd });
    comments = JSON.parse(rawComments);
  } catch {
    comments = [];
  }

  const reviewComments = Array.isArray(comments)
    ? comments.filter((c) => c.pull_request_review_id === latestReview.id || !c.pull_request_review_id)
    : [];

  const findings = extractPriorFindings({
    reviewBody: latestReview.body || '',
    reviewComments,
  });

  return {
    latestReview: {
      id: latestReview.id,
      commitId: latestReview.commit_id,
      state: latestReview.state,
      submittedAt: latestReview.submitted_at,
      author: latestReview.user?.login || null,
      body: latestReview.body || '',
    },
    findings,
    allReviews: validReviews,
  };
}

/**
 * Revalidates prior review findings against an incremental diff.
 *
 * For each prior finding:
 * - 'resolved': Modified or fixed in the incremental diff.
 * - 'obsolete': File deleted or surrounding code removed.
 * - 'still open': File/location unchanged in incremental commits.
 *
 * @param {object} params
 * @param {Array<object>} params.priorFindings
 * @param {string} params.incrementalDiffText
 * @returns {{ findings: Array<object>, counts: { resolved: number, stillOpen: number, obsolete: number } }}
 */
export function revalidatePriorFindings({ priorFindings = [], incrementalDiffText = '' } = {}) {
  const parsedDiffs = parseUnifiedDiff(incrementalDiffText);
  const diffByPath = new Map();

  for (const d of parsedDiffs) {
    if (d.filePath) diffByPath.set(d.filePath, d);
    if (d.newPath) diffByPath.set(d.newPath, d);
    if (d.oldPath) diffByPath.set(d.oldPath, d);
  }

  const counts = { resolved: 0, stillOpen: 0, obsolete: 0 };
  const revalidated = [];

  for (const item of priorFindings) {
    const finding = { ...item };
    const filePath = finding.filePath || '';
    const line = Number(finding.line || 1);
    const fileDiff = diffByPath.get(filePath);

    if (!fileDiff) {
      // File was not modified at all in the incremental diff
      finding.status = 'still open';
      finding.statusReason = 'Unchanged in incremental commits.';
      counts.stillOpen++;
    } else if (fileDiff.status === 'deleted' || fileDiff.isDeleted) {
      // File was deleted
      finding.status = 'obsolete';
      finding.statusReason = 'File deleted in incremental commits.';
      counts.obsolete++;
    } else {
      // Check if any hunk in the incremental diff touches the flagged line
      let touchedByHunk = false;
      for (const hunk of fileDiff.hunks) {
        // Check old line range
        const oldStart = hunk.oldStart;
        const oldEnd = oldStart + Math.max(hunk.oldLines, 1) - 1;
        // Check new line range
        const newStart = hunk.newStart;
        const newEnd = newStart + Math.max(hunk.newLines, 1) - 1;

        // Give a generous window of +/- 3 lines around the flagged line
        if (
          (line >= oldStart - 3 && line <= oldEnd + 3) ||
          (line >= newStart - 3 && line <= newEnd + 3)
        ) {
          touchedByHunk = true;
          break;
        }
      }

      if (touchedByHunk) {
        finding.status = 'resolved';
        finding.statusReason = 'Modified in incremental diff.';
        counts.resolved++;
      } else {
        finding.status = 'still open';
        finding.statusReason = 'File modified elsewhere; flagged location unchanged.';
        counts.stillOpen++;
      }
    }

    revalidated.push(finding);
  }

  return { findings: revalidated, counts };
}

/**
 * Formats revalidation results into a markdown section.
 *
 * @param {object} params
 * @param {Array<object>} params.findings
 * @param {object} params.counts
 * @returns {string}
 */
export function formatRevalidationSummary({ findings = [], counts = {} } = {}) {
  const lines = [
    '### Prior Findings Revalidation (Incremental Re-Review)',
    `- **Resolved**: ${counts.resolved || 0} findings addressed in new commits`,
    `- **Still Open**: ${counts.stillOpen || 0} findings remaining`,
    `- **Obsolete**: ${counts.obsolete || 0} findings obsolete`,
    '',
  ];

  const resolved = findings.filter((f) => f.status === 'resolved');
  if (resolved.length > 0) {
    lines.push('#### Resolved');
    for (const f of resolved) {
      lines.push(`- [x] **[${f.severity}]** \`${f.filePath}:${f.line}\`: ${f.title || f.body || ''}`);
    }
    lines.push('');
  }

  const stillOpen = findings.filter((f) => f.status === 'still open');
  if (stillOpen.length > 0) {
    lines.push('#### Still Open');
    for (const f of stillOpen) {
      lines.push(`- [ ] **[${f.severity}]** \`${f.filePath}:${f.line}\`: ${f.title || f.body || ''}`);
    }
    lines.push('');
  }

  const obsolete = findings.filter((f) => f.status === 'obsolete');
  if (obsolete.length > 0) {
    lines.push('#### Obsolete');
    for (const f of obsolete) {
      lines.push(`- [~] **[${f.severity}]** \`${f.filePath}:${f.line}\`: ${f.title || f.body || ''}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Fetches the unified diff between prior reviewed commit SHA and current PR head SHA.
 *
 * @param {object} params
 * @param {string} params.priorHeadSha
 * @param {string} params.currentHeadSha
 * @param {string} [params.repo]
 * @param {Function} [params.execGitFn]
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<string>}
 */
export async function getIncrementalDiff({
  priorHeadSha,
  currentHeadSha,
  repo = null,
  execGitFn = null,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  const range = `${priorHeadSha}..${currentHeadSha}`;

  // 1. Attempt git diff locally
  try {
    const diff = await runGit(['diff', range], { execGitFn, cwd });
    if (diff && diff.trim()) {
      return diff;
    }
  } catch {
    // Fall back to gh compare API if local git diff fails
  }

  // 2. Fall back to GitHub Compare API via gh
  const compareEndpoint = repo
    ? `repos/${repo}/compare/${priorHeadSha}...${currentHeadSha}`
    : `repos/:owner/:repo/compare/${priorHeadSha}...${currentHeadSha}`;

  try {
    const raw = await runGh(['api', compareEndpoint], { execGhFn, cwd });
    const data = JSON.parse(raw);
    if (Array.isArray(data.files) && data.files.length > 0) {
      return data.files
        .map((f) => {
          const patch = f.patch || '';
          return `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n${patch}`;
        })
        .join('\n');
    }
  } catch {
    // Ignore fallback errors
  }

  return '';
}
