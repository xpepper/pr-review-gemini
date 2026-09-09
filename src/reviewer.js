import { getPrDiff, parseUnifiedDiff } from './diff.js';
import {
  parseMarkdownFindings,
  classifyFindings,
  formatReviewSummary,
  publishReview,
  checkHeadFreshness,
} from './publish.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import {
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
  DEFAULT_LENS_TIERS,
} from './subagents.js';

export {
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
  DEFAULT_LENS_TIERS,
};

export const REVIEW_MODES = {
  balanced: {
    name: 'balanced',
    description: 'Balanced review running 5 specialist lenses in parallel.',
    lenses: ['correctness', 'contracts', 'security', 'performance', 'conventions'],
    defaultTier: 'medium',
  },
  quick: {
    name: 'quick',
    description: 'Fast triage running 3 critical lenses: correctness, security, conventions.',
    lenses: ['correctness', 'security', 'conventions'],
    defaultTier: 'light',
  },
  full: {
    name: 'full',
    description: 'Exhaustive review running 6 specialist lenses including tests.',
    lenses: ['correctness', 'contracts', 'security', 'performance', 'conventions', 'tests'],
    defaultTier: 'heavy',
  },
  deep: {
    name: 'deep',
    description: 'Focused deep analysis on correctness with high reasoning effort.',
    lenses: ['correctness'],
    defaultTier: 'heavy',
    reasoningEffort: 'high',
  },
};

export const LENS_DEFINITIONS = {
  correctness: {
    id: 'correctness',
    name: 'Correctness & Concurrency',
    description: 'Logic flaws, calculation bugs, off-by-one errors, race conditions, deadlocks, and async lifecycle issues.',
    instructions: `You are an expert software engineer reviewing code specifically for Correctness & Concurrency.
Inspect the unified diff carefully for:
- Logical defects, faulty calculations, incorrect conditional checks, off-by-one errors.
- Unhandled null/undefined values or missing error boundaries.
- Async issues: unhandled promise rejections, missing awaits, uncoordinated concurrent mutations.
- State corruption, deadlocks, or race conditions.`,
  },
  contracts: {
    id: 'contracts',
    name: 'Contracts & Data',
    description: 'API surface, backwards compatibility, typing, schema mutations, and data invariants.',
    instructions: `You are an expert software engineer reviewing code specifically for Contracts & Data invariants.
Inspect the unified diff carefully for:
- Breaking API or signature changes.
- Inconsistent data typing or serialization schema mismatches.
- Missing field defaults or invalid assumptions about external payloads.
- Invariant violations across component boundaries.`,
  },
  security: {
    id: 'security',
    name: 'Security & Trust Boundaries',
    description: 'Injection vulnerabilities, auth bypass, sensitive data leaks, and untrusted inputs.',
    instructions: `You are an expert security engineer reviewing code specifically for Security & Trust Boundaries.
Inspect the unified diff carefully for:
- Injection attacks (SQL, shell, command, XSS, template injection).
- Authentication and authorization bypasses or weak access controls.
- Exposure of secrets, API keys, tokens, or PII in logs or responses.
- Insecure deserialization or processing of untrusted input.`,
  },
  performance: {
    id: 'performance',
    name: 'Performance & Resources',
    description: 'Algorithmic complexity regressions, N+1 queries, memory leaks, and resource management.',
    instructions: `You are an expert performance engineer reviewing code specifically for Performance & Resources.
Inspect the unified diff carefully for:
- Algorithmic complexity regressions (e.g. O(N^2) loops where O(N) or O(log N) is expected).
- N+1 database queries or unbatched I/O operations.
- Resource leaks: unclosed streams, unreleased handles, persistent event listeners.
- Unnecessary large object allocations inside hot code paths.`,
  },
  conventions: {
    id: 'conventions',
    name: 'Conventions & Maintainability',
    description: 'Architectural cohesion, readability, naming clarity, and codebase standards.',
    instructions: `You are an expert software craftsman reviewing code specifically for Conventions & Maintainability.
Inspect the unified diff carefully for:
- Architectural cohesion and clean separation of concerns.
- Obscure naming or overly convoluted abstractions.
- Dead code, dangling commented-out blocks, or copy-paste duplication.
- Project-level convention violations.`,
  },
  tests: {
    id: 'tests',
    name: 'Test Quality & Verification',
    description: 'Test coverage for new code paths, brittle assertions, and regression prevention.',
    instructions: `You are an expert QA and test engineer reviewing code specifically for Test Quality & Verification.
Inspect the unified diff carefully for:
- Missing unit or integration tests for new features, edge cases, or failure branches.
- Flaky, brittle, or non-deterministic test assertions.
- Test ergonomics, assertion clarity, and realistic mocking boundaries.`,
  },
};

const SEVERITY_RANK = {
  P0: 5,
  P1: 4,
  P2: 3,
  P3: 2,
  nit: 1,
};

/**
 * Resolves review mode object from name or CLI flag (e.g. 'quick' or '--quick').
 */
export function resolveReviewMode(modeInput) {
  if (!modeInput || typeof modeInput !== 'string') {
    return REVIEW_MODES.balanced;
  }
  const clean = modeInput.replace(/^--/, '').toLowerCase().trim();
  return REVIEW_MODES[clean] || REVIEW_MODES.balanced;
}

/**
 * Builds the prompt for a single specialist lens review pass.
 */
export function buildReviewerPrompt({ lens, diffText, prMetadata, customInstructions }) {
  const lensDef = typeof lens === 'string' ? LENS_DEFINITIONS[lens] : lens;
  const lensName = lensDef?.name || 'Code Review';
  const instructions = lensDef?.instructions || '';

  const prContext = prMetadata
    ? `Pull Request Context:\n- PR #${prMetadata.number ?? ''}: ${prMetadata.title ?? ''}\n`
    : '';

  const customBlock = customInstructions
    ? `Additional Review Instructions:\n${customInstructions}\n\n`
    : '';

  return `# Specialist Code Review: ${lensName}

${instructions}

${prContext}${customBlock}## Structured Output Contract

Review the unified diff below. If you identify defects within your specialization with high confidence (>= 0.7), report them using the following JSON envelope:

<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Concise summary of defect",
    "severity": "P0 | P1 | P2 | P3 | nit",
    "file": "exact/path/from/diff.js",
    "line": 42,
    "side": "RIGHT",
    "confidence": 0.9,
    "body": "Technical explanation of the defect and suggested concrete remediation."
  }
]
<<<END_PR_REVIEW_JSON>>>

Notes:
- Severity:
  - P0: Blocker (security exploit, crash, data corruption).
  - P1: Major bug / functional defect / broken contract.
  - P2: Medium concern / edge case / non-critical defect.
  - P3: Minor improvement / maintainability note.
  - nit: Trivial cosmetic note.
- Only report findings that are grounded in the diff lines below.
- If no defects meet the threshold, return an empty array: <<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>.

## Unified Diff to Inspect:
\`\`\`diff
${diffText}
\`\`\`
`;
}

/**
 * Deduplicates findings across multiple lens review passes.
 * If multiple findings point to the same file and line, retains the higher severity.
 */
export function deduplicateFindings(findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }

  const map = new Map();

  for (const item of findings) {
    if (!item || typeof item !== 'object') continue;
    const file = item.filePath || item.file || '';
    const line = Number(item.line) || 0;
    const side = item.side === 'LEFT' ? 'LEFT' : 'RIGHT';
    const key = `${file}:${line}:${side}`;

    const normalizedItem = {
      ...item,
      file,
      filePath: file,
      line: item.line ?? null,
      side,
    };

    if (!map.has(key)) {
      map.set(key, normalizedItem);
      continue;
    }

    const existing = map.get(key);
    const existingRank = SEVERITY_RANK[existing.severity] || 0;
    const itemRank = SEVERITY_RANK[item.severity] || 0;

    if (itemRank > existingRank) {
      map.set(key, {
        ...normalizedItem,
        body: normalizedItem.body || normalizedItem.commentary || existing.body || existing.commentary,
        commentary: normalizedItem.commentary || normalizedItem.body || existing.commentary || existing.body,
        confidence: Math.max(normalizedItem.confidence ?? 0.7, existing.confidence ?? 0.7),
      });
    } else {
      map.set(key, {
        ...existing,
        confidence: Math.max(existing.confidence ?? 0.7, normalizedItem.confidence ?? 0.7),
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Orchestrates an end-to-end multi-lens review for a pull request.
 */
export async function runReview({
  prNumber,
  mode = 'balanced',
  diffText,
  config,
  runnerFn,
  execGhFn,
  execFileFn,
  cwd = process.cwd(),
  repo,
  expectedHeadSha,
  dryRun = false,
  publish = false,
  customInstructions,
}) {
  const num = Number(prNumber);
  if (!num || num <= 0 || !Number.isInteger(num)) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  const resolvedConfig = config || (await loadConfig({ cwd }));
  const resolvedMode = resolveReviewMode(mode);

  // 1. Retrieve diff if not provided directly
  let unifiedDiffText = diffText;
  if (unifiedDiffText === undefined || unifiedDiffText === null) {
    unifiedDiffText = await getPrDiff({
      prNumber: num,
      repo,
      execGhFn,
      execFileFn,
      cwd,
    });
  }

  if (!unifiedDiffText || !unifiedDiffText.trim()) {
    throw new Error(`PR diff is empty or could not be retrieved for PR #${num}`);
  }

  // 2. Retrieve PR metadata if gh is available
  let prMetadata = { number: num, title: `PR #${num}` };
  let currentHeadSha = expectedHeadSha || null;

  if (execGhFn) {
    try {
      const ghArgs = ['pr', 'view', String(num), '--json', 'headRefOid,author,title'];
      if (repo) ghArgs.push('--repo', repo);
      const rawMeta = await execGhFn(ghArgs, { cwd });
      if (rawMeta && rawMeta.trim()) {
        const meta = JSON.parse(rawMeta);
        currentHeadSha = meta.headRefOid || currentHeadSha;
        prMetadata = {
          number: num,
          title: meta.title || `PR #${num}`,
          author: meta.author?.login || null,
          headSha: meta.headRefOid,
        };
      }
    } catch {
      // Fallback if metadata query fails
    }
  }

  // 3. Execute review passes across lenses in parallel
  const plan = resolveLensPlan({ mode: resolvedMode, config: resolvedConfig });
  const executedLenses = plan.map((p) => p.lensId);
  let allFindings = [];
  let subagentErrors = [];

  if (typeof runnerFn === 'function') {
    const subagentResult = await dispatchSubagentsParallel({
      plan,
      diffText: unifiedDiffText,
      prMetadata,
      customInstructions,
      runnerFn,
    });
    allFindings = subagentResult.findings;
    subagentErrors = subagentResult.errors;
  }

  // 4. Deduplicate findings
  const deduplicated = deduplicateFindings(allFindings);

  // 5. Generate Review Summary
  const severityCounts = { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 };
  for (const f of deduplicated) {
    const sev = f.severity || 'P2';
    if (severityCounts[sev] !== undefined) {
      severityCounts[sev]++;
    }
  }

  const lensesList = executedLenses.map((id) => LENS_DEFINITIONS[id]?.name || id).join(', ');
  const countsSummary = Object.entries(severityCounts)
    .filter(([, count]) => count > 0)
    .map(([sev, count]) => `**${sev}**: ${count}`)
    .join(' | ') || 'None';

  const summary = `## PR Review Summary (Mode: \`${resolvedMode.name}\`)

- **Pull Request**: #${num}${prMetadata.title ? ` (${prMetadata.title})` : ''}
- **Specialist Lenses Inspected**: ${lensesList}
- **Total Findings**: ${deduplicated.length} (${countsSummary})

${deduplicated.length === 0 ? '✅ **No defects or blocking issues identified across all evaluated lenses.**' : 'Findings have been analyzed and anchored to unified diff hunks below.'}`;

  // 6. Publish or Dry Run
  const diffs = parseUnifiedDiff(unifiedDiffText);

  if (publish && !dryRun) {
    const pubResult = await publishReview({
      prNumber: num,
      reviewBody: summary,
      findings: deduplicated,
      diffText: unifiedDiffText,
      expectedHeadSha: currentHeadSha,
      config: resolvedConfig,
      execGhFn,
      execFileFn,
      cwd,
      repo,
    });

    return {
      prNumber: num,
      repo: repo || null,
      headSha: currentHeadSha,
      mode: resolvedMode.name,
      lensesExecuted: executedLenses,
      subagentPlan: plan,
      errors: subagentErrors,
      findings: deduplicated,
      rawFindingsCount: allFindings.length,
      summary: pubResult.reviewBody,
      classification: pubResult.classification,
      publication: pubResult,
      published: true,
    };
  }

  const classification = classifyFindings(deduplicated, diffs, {
    maxInlineComments: resolvedConfig.publishing?.maxInlineComments ?? 50,
  });

  return {
    prNumber: num,
    repo: repo || null,
    headSha: currentHeadSha,
    mode: resolvedMode.name,
    lensesExecuted: executedLenses,
    subagentPlan: plan,
    errors: subagentErrors,
    findings: deduplicated,
    rawFindingsCount: allFindings.length,
    summary,
    classification,
    publication: null,
    published: false,
  };
}
