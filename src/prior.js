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

/**
 * Normalizes raw review thread nodes (GraphQL) or PR comments (REST) into unified ReviewThread objects.
 *
 * @param {Array<object>} rawThreadsOrComments
 * @returns {Array<object>}
 */
export function normalizeReviewThreads(rawThreadsOrComments) {
  if (!Array.isArray(rawThreadsOrComments) || rawThreadsOrComments.length === 0) {
    return [];
  }

  // 1. Check if input is array of GraphQL thread nodes (contains comments.nodes or id starting with PRRT_)
  const isGraphql = rawThreadsOrComments.some(
    (item) => item?.comments?.nodes || (typeof item?.id === 'string' && item.id.startsWith('PRRT_'))
  );

  if (isGraphql) {
    return rawThreadsOrComments.map((node) => {
      const threadId = String(node.id || '');
      const path = node.path || '';
      const line = Number(node.line || node.originalLine || 1);
      const side = node.diffSide || 'RIGHT';
      const isResolved = Boolean(node.isResolved);
      const isOutdated = Boolean(node.isOutdated);

      const rawComments = Array.isArray(node.comments?.nodes) ? node.comments.nodes : [];
      const comments = rawComments.map((c) => ({
        id: String(c.id || c.databaseId || ''),
        databaseId: c.databaseId || null,
        author: c.author?.login || c.user?.login || 'unknown',
        body: c.body || '',
        createdAt: c.createdAt || c.created_at || '',
      }));

      const rootComment = comments[0] || null;
      const replies = comments.slice(1);
      const turnCount = comments.length;
      const replyCount = Math.max(0, turnCount - 1);
      const lastComment = comments[turnCount - 1] || null;
      const lastAuthor = lastComment?.author || null;
      const rootAuthor = rootComment?.author || null;
      const authorReplies = replies.filter((c) => c.author !== rootAuthor);

      let finding = null;
      if (rootComment?.body) {
        const parsed = parseMarkdownFindings(rootComment.body);
        if (parsed.length > 0) {
          finding = parsed[0];
        } else {
          const matchSev = rootComment.body.match(/\*\*\[(P0|P1|P2|P3|nit)\]\s*(.*?)\*\*/i);
          if (matchSev) {
            finding = {
              severity: matchSev[1].toUpperCase(),
              title: matchSev[2].trim(),
              filePath: path,
              line,
              side,
            };
          }
        }
      }

      let discussionState = 'unresolved';
      if (isResolved) {
        discussionState = 'resolved';
      } else if (isOutdated) {
        discussionState = 'outdated';
      } else if (authorReplies.length > 0) {
        discussionState = 'author_replied';
      }

      return {
        threadId,
        id: threadId,
        path,
        filePath: path,
        line,
        side,
        isResolved,
        isOutdated,
        comments,
        rootComment,
        replies,
        turnCount,
        replyCount,
        lastComment,
        lastAuthor,
        authorReplies,
        finding,
        discussionState,
      };
    });
  }

  // 2. Otherwise treat as REST comments array
  const rootComments = [];
  const repliesByParentId = new Map();

  for (const item of rawThreadsOrComments) {
    if (!item.in_reply_to_id) {
      rootComments.push(item);
    } else {
      const parentId = String(item.in_reply_to_id);
      if (!repliesByParentId.has(parentId)) {
        repliesByParentId.set(parentId, []);
      }
      repliesByParentId.get(parentId).push(item);
    }
  }

  return rootComments.map((root) => {
    const threadId = String(root.id);
    const path = root.path || '';
    const line = Number(root.line || root.original_line || 1);
    const side = root.side || 'RIGHT';

    const normalizedRoot = {
      id: String(root.id),
      databaseId: root.id || null,
      author: root.user?.login || 'unknown',
      body: root.body || '',
      createdAt: root.created_at || '',
    };

    const rawReplies = repliesByParentId.get(threadId) || [];
    const normalizedReplies = rawReplies.map((r) => ({
      id: String(r.id),
      databaseId: r.id || null,
      author: r.user?.login || 'unknown',
      body: r.body || '',
      createdAt: r.created_at || '',
    }));

    const comments = [normalizedRoot, ...normalizedReplies];
    const turnCount = comments.length;
    const replyCount = normalizedReplies.length;
    const lastComment = comments[turnCount - 1] || null;
    const lastAuthor = lastComment?.author || null;
    const authorReplies = normalizedReplies.filter((c) => c.author !== normalizedRoot.author);

    let finding = null;
    if (root.body) {
      const parsed = parseMarkdownFindings(root.body);
      if (parsed.length > 0) {
        finding = parsed[0];
      } else {
        const matchSev = root.body.match(/\*\*\[(P0|P1|P2|P3|nit)\]\s*(.*?)\*\*/i);
        if (matchSev) {
          finding = {
            severity: matchSev[1].toUpperCase(),
            title: matchSev[2].trim(),
            filePath: path,
            line,
            side,
          };
        }
      }
    }

    let discussionState = 'unresolved';
    if (authorReplies.length > 0) {
      discussionState = 'author_replied';
    }

    return {
      threadId,
      id: threadId,
      path,
      filePath: path,
      line,
      side,
      isResolved: false,
      isOutdated: false,
      comments,
      rootComment: normalizedRoot,
      replies: normalizedReplies,
      turnCount,
      replyCount,
      lastComment,
      lastAuthor,
      authorReplies,
      finding,
      discussionState,
    };
  });
}

/**
 * Fetches review comment threads for a pull request from GitHub via GraphQL with REST fallback.
 *
 * @param {object} params
 * @param {number} params.prNumber
 * @param {string} [params.repo]
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<Array<object>>}
 */
export async function fetchReviewThreads({
  prNumber,
  repo = null,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  const num = Number(prNumber);
  if (!Number.isInteger(num) || num <= 0) {
    return [];
  }

  // 1. Attempt GraphQL query
  try {
    let owner = null;
    let name = null;

    if (repo && typeof repo === 'string' && repo.includes('/')) {
      const parts = repo.split('/');
      owner = parts[0].trim();
      name = parts[1].trim();
    } else {
      try {
        const repoOut = await runGh(['repo', 'view', '--json', 'owner,name'], { execGhFn, cwd });
        const parsedRepo = JSON.parse(repoOut);
        if (parsedRepo && typeof parsedRepo === 'object' && !Array.isArray(parsedRepo)) {
          owner = parsedRepo.owner?.login || parsedRepo.owner || null;
          name = parsedRepo.name || null;
        }
      } catch {
        // Continue to fallback if repo view fails
      }
    }

    if (owner && name) {
      const query = `query($owner: String!, $name: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 50) {
            nodes {
              id
              databaseId
              body
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  }
}`;

      const raw = await runGh(
        [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${owner}`,
          '-F',
          `name=${name}`,
          '-F',
          `prNumber=${num}`,
        ],
        { execGhFn, cwd }
      );

      const parsed = JSON.parse(raw);
      const nodes = parsed?.data?.repository?.pullRequest?.reviewThreads?.nodes;
      if (Array.isArray(nodes)) {
        return normalizeReviewThreads(nodes);
      }
    }
  } catch {
    // Fall back to REST on GraphQL failure
  }

  // 2. Fall back to REST comments endpoint
  try {
    const commentsEndpoint = repo
      ? `repos/${repo}/pulls/${num}/comments`
      : `repos/:owner/:repo/pulls/${num}/comments`;

    const rawComments = await runGh(['api', commentsEndpoint], { execGhFn, cwd });
    const comments = JSON.parse(rawComments);
    if (Array.isArray(comments)) {
      return normalizeReviewThreads(comments);
    }
  } catch {
    // REST failed
  }

  return [];
}

/**
 * Evaluates a single review thread against the diff to determine if the finding was addressed.
 *
 * @param {object} params
 * @param {object} params.thread
 * @param {string} [params.diffText='']
 * @param {string} [params.incrementalDiffText='']
 * @returns {object}
 */
export function evaluateReviewThread({ thread, diffText = '', incrementalDiffText = '' } = {}) {
  const diff = incrementalDiffText || diffText || '';
  const parsedDiffs = parseUnifiedDiff(diff);
  const diffByPath = new Map();

  for (const d of parsedDiffs) {
    if (d.filePath) diffByPath.set(d.filePath, d);
    if (d.newPath) diffByPath.set(d.newPath, d);
    if (d.oldPath) diffByPath.set(d.oldPath, d);
  }

  const filePath = thread.path || thread.filePath || '';
  const line = Number(thread.line || 1);
  const fileDiff = diffByPath.get(filePath);

  let verdict = 'STILL_OPEN';
  let status = 'still_open';
  let canResolve = false;
  let suggestedReply = '';
  let reason = '';

  if (thread.isResolved) {
    verdict = 'RESOLVED';
    status = 'resolved';
    canResolve = false;
    reason = 'Thread is already resolved on GitHub.';
  } else if (!fileDiff) {
    if (thread.authorReplies && thread.authorReplies.length > 0) {
      verdict = 'STILL_OPEN';
      status = 'author_replied';
      canResolve = false;
      reason = `Author reply received, but file '${filePath}' was not touched in diff.`;
      suggestedReply = `> ℹ️ Author reply received, but code at \`${filePath}:${line}\` is unchanged. Please review or push fix.`;
    } else {
      verdict = 'STILL_OPEN';
      status = 'still_open';
      canResolve = false;
      reason = `File '${filePath}' unchanged in diff.`;
    }
  } else if (fileDiff.status === 'deleted' || fileDiff.isDeleted) {
    verdict = 'OBSOLETE';
    status = 'obsolete';
    canResolve = true;
    reason = `File '${filePath}' was deleted in commits.`;
    suggestedReply = `> ✅ **Obsolete**: Target file \`${filePath}\` was deleted. Resolving thread.`;
  } else {
    // Check if any hunk touches the line window (+/- 3 lines)
    let touchedByHunk = false;
    for (const hunk of fileDiff.hunks) {
      const oldStart = hunk.oldStart;
      const oldEnd = oldStart + Math.max(hunk.oldLines, 1) - 1;
      const newStart = hunk.newStart;
      const newEnd = newStart + Math.max(hunk.newLines, 1) - 1;

      if (
        (line >= oldStart - 3 && line <= oldEnd + 3) ||
        (line >= newStart - 3 && line <= newEnd + 3)
      ) {
        touchedByHunk = true;
        break;
      }
    }

    if (touchedByHunk) {
      verdict = 'RESOLVED';
      status = 'resolved';
      canResolve = true;
      reason = `Code at ${filePath}:${line} was modified in diff.`;
      suggestedReply = `> ✅ **Resolved**: Verified code fix at \`${filePath}:${line}\` in latest commits. Resolving review thread.`;
    } else if (thread.authorReplies && thread.authorReplies.length > 0) {
      verdict = 'STILL_OPEN';
      status = 'author_replied';
      canResolve = false;
      reason = `Author replied, but code at ${filePath}:${line} remains unchanged in diff.`;
      suggestedReply = `> ℹ️ Author reply received, but code at \`${filePath}:${line}\` is unchanged. Please review or push fix.`;
    } else {
      verdict = 'STILL_OPEN';
      status = 'still_open';
      canResolve = false;
      reason = `Code at ${filePath}:${line} unchanged in diff.`;
    }
  }

  return {
    ...thread,
    verdict,
    status,
    canResolve,
    suggestedReply,
    reason,
  };
}

/**
 * Evaluates multiple review threads and tallies resolution counts.
 *
 * @param {object} params
 * @param {Array<object>} params.threads
 * @param {string} [params.diffText='']
 * @param {string} [params.incrementalDiffText='']
 * @returns {{ threads: Array<object>, counts: { total: number, resolved: number, obsolete: number, stillOpen: number, authorReplied: number, resolvable: number } }}
 */
export function evaluateReviewThreads({ threads = [], diffText = '', incrementalDiffText = '' } = {}) {
  const evaluated = threads.map((thread) =>
    evaluateReviewThread({ thread, diffText, incrementalDiffText })
  );

  const counts = {
    total: evaluated.length,
    resolved: evaluated.filter((t) => t.verdict === 'RESOLVED').length,
    obsolete: evaluated.filter((t) => t.verdict === 'OBSOLETE').length,
    stillOpen: evaluated.filter((t) => t.status === 'still_open').length,
    authorReplied: evaluated.filter((t) => t.status === 'author_replied').length,
    resolvable: evaluated.filter((t) => t.canResolve && !t.isResolved).length,
  };

  return { threads: evaluated, counts };
}

/**
 * Formats review thread evaluation into a clean Markdown summary.
 *
 * @param {object} evaluation - Result of evaluateReviewThreads
 * @returns {string}
 */
export function formatThreadResolutionSummary({ threads = [], counts = {} } = {}) {
  const lines = [
    '### Review Thread Verification & Automated Resolution',
    `- **Total Active Threads**: ${counts.total || threads.length}`,
    `- **Verified Resolved**: ${counts.resolved || 0}${counts.resolvable ? ` (${counts.resolvable} auto-resolved)` : ''}`,
    `- **Author Replied (Pending Action)**: ${counts.authorReplied || 0}`,
    `- **Still Open**: ${counts.stillOpen || 0}`,
    '',
  ];

  const resolved = threads.filter((t) => t.verdict === 'RESOLVED' || t.verdict === 'OBSOLETE');
  if (resolved.length > 0) {
    lines.push('#### Verified Resolved');
    for (const t of resolved) {
      const loc = `${t.path}:${t.line}`;
      const title = t.finding?.title || t.rootComment?.body?.slice(0, 60) || loc;
      lines.push(`- [x] \`${loc}\`: ${title} (Thread ${t.threadId})`);
    }
    lines.push('');
  }

  const pending = threads.filter((t) => t.status === 'author_replied' || t.status === 'still_open');
  if (pending.length > 0) {
    lines.push('#### Pending Review / Unresolved');
    for (const t of pending) {
      const loc = `${t.path}:${t.line}`;
      const title = t.finding?.title || t.rootComment?.body?.slice(0, 60) || loc;
      lines.push(`- [ ] \`${loc}\`: ${title} (Thread ${t.threadId})`);
      if (t.lastAuthor && t.authorReplies?.length > 0) {
        lines.push(`  * Last reply by @${t.lastAuthor}: "${t.lastComment?.body?.slice(0, 80) || ''}"`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Resolves a single review thread via GitHub GraphQL API.
 *
 * @param {object} params
 * @param {string} params.threadId
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ success: boolean, isResolved: boolean, threadId: string, error?: string }>}
 */
export async function resolveReviewThread({
  threadId,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  if (!threadId) {
    return { success: false, isResolved: false, threadId, error: 'Missing threadId' };
  }

  const mutation = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}`;

  try {
    const raw = await runGh(
      ['api', 'graphql', '-f', `query=${mutation}`, '-F', `threadId=${threadId}`],
      { execGhFn, cwd }
    );
    const parsed = JSON.parse(raw);
    const isResolved = parsed?.data?.resolveReviewThread?.thread?.isResolved ?? true;
    return { success: true, isResolved, threadId };
  } catch (err) {
    return { success: false, isResolved: false, threadId, error: err.message };
  }
}

/**
 * Posts a reply to an inline PR review comment thread via GraphQL or REST.
 *
 * @param {object} params
 * @param {string} params.threadId
 * @param {number|string} [params.commentId]
 * @param {number|string} [params.prNumber]
 * @param {string} [params.repo]
 * @param {string} params.body
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ success: boolean, id?: string|number, error?: string }>}
 */
export async function replyToReviewThread({
  threadId,
  commentId = null,
  prNumber = null,
  repo = null,
  body,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  if (!body) {
    return { success: false, error: 'Missing reply body' };
  }

  // 1. Try GraphQL mutation if threadId looks like a GraphQL ID (PRRT_)
  if (threadId && typeof threadId === 'string' && threadId.startsWith('PRRT_')) {
    const mutation = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      id
      databaseId
      body
      createdAt
    }
  }
}`;

    try {
      const raw = await runGh(
        [
          'api',
          'graphql',
          '-f',
          `query=${mutation}`,
          '-F',
          `threadId=${threadId}`,
          '-F',
          `body=${body}`,
        ],
        { execGhFn, cwd }
      );
      const parsed = JSON.parse(raw);
      const comment = parsed?.data?.addPullRequestReviewThreadReply?.comment;
      return { success: true, id: comment?.id || comment?.databaseId };
    } catch {
      // Fall back to REST if GraphQL fails
    }
  }

  // 2. REST fallback
  const cId = commentId || threadId;
  if (!cId) {
    return { success: false, error: 'Missing commentId or threadId for reply' };
  }

  try {
    const endpoint = repo && prNumber
      ? `repos/${repo}/pulls/${prNumber}/comments/${cId}/replies`
      : `repos/:owner/:repo/pulls/comments/${cId}/replies`;

    const raw = await runGh(
      ['api', '--method', 'POST', endpoint, '-f', `body=${body}`],
      { execGhFn, cwd }
    );
    const parsed = JSON.parse(raw);
    return { success: true, id: parsed.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Resolves all verified threads, optionally posting a confirmation reply first.
 *
 * @param {object} params
 * @param {Array<object>} params.threads
 * @param {number|string} params.prNumber
 * @param {string} [params.repo]
 * @param {boolean} [params.reply=true]
 * @param {Function} [params.execGhFn]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<{ resolvedCount: number, resolvedThreads: Array<object>, failedThreads: Array<object> }>}
 */
export async function resolveVerifiedThreads({
  threads = [],
  prNumber,
  repo = null,
  reply = true,
  execGhFn = null,
  cwd = process.cwd(),
} = {}) {
  const resolvable = threads.filter((t) => t.canResolve && !t.isResolved);
  const resolvedThreads = [];
  const failedThreads = [];

  for (const t of resolvable) {
    if (reply && t.suggestedReply) {
      await replyToReviewThread({
        threadId: t.threadId,
        commentId: t.rootComment?.id || t.id,
        prNumber,
        repo,
        body: t.suggestedReply,
        execGhFn,
        cwd,
      });
    }

    const res = await resolveReviewThread({
      threadId: t.threadId,
      execGhFn,
      cwd,
    });

    if (res.success) {
      resolvedThreads.push(t);
    } else {
      failedThreads.push({ ...t, error: res.error });
    }
  }

  return {
    resolvedCount: resolvedThreads.length,
    resolvedThreads,
    failedThreads,
  };
}

