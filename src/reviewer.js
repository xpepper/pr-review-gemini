import path from 'node:path';
import {
  getPrDiff,
  parseUnifiedDiff,
  isLargeDiff,
  createFileBackedDiff,
  generateDiffManifest,
  formatDiffManifest,
  LARGE_DIFF_THRESHOLD_BYTES,
} from './diff.js';
import {
  parseMarkdownFindings,
  classifyFindings,
  formatReviewSummary,
  publishReview,
  checkHeadFreshness,
  recoverFindingsFromText,
  extractJsonEnvelope,
  repairJsonString,
  extractCandidateObjects,
  normalizeFindingCandidate,
  isValidFindingCandidate,
} from './publish.js';
import { loadConfig, DEFAULT_CONFIG, getCustomRoles, formatDefaultRoleName } from './config.js';
import {
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
  DEFAULT_LENS_TIERS,
  isQuotaOrCapacityError,
  isQuotaError,
  isModelUnavailableError,
  isRetriableModelError,
} from './subagents.js';
import {
  fetchPriorReviews,
  classifyCommitRelationship,
  getIncrementalDiff,
  revalidatePriorFindings,
  formatRevalidationSummary,
} from './prior.js';
import {
  saveReviewCache,
  getReviewCache,
  invalidateReviewCache,
  listReviewCaches,
  publishCachedReview,
} from './cache.js';
import {
  formatFindingRow,
  formatFindingsTable,
  parseSelectionInput,
  filterFindings,
  promptFindingSelection,
} from './selection.js';
import {
  runSelfReview,
  evaluateSelfReviewVerdict,
  formatSelfReviewSummary,
  getWorktreeDiff,
  generateSyntheticDiff,
} from './self-review.js';
import {
  parseEventPayload,
  resolveCiEnvironment,
  evaluateCiQualityGate,
  writeGitHubStepOutputs,
  formatCiSummary,
  parseCommentCommand,
  isAuthorizedCommenter,
  getCommenterAuthorization,
  addCommentReaction,
  postIssueComment,
  formatUnauthorizedReply,
  formatHelpReply,
  formatCompletionReply,
} from './ci.js';
import {
  VERSION,
  PLUGIN_VERSION,
  PLUGIN_NAME,
  isValidSemVer,
  parseSemVer,
} from './version.js';
import {
  CALIBRATION_BENCHMARKS,
  evaluateCalibrationFinding,
  evaluateCalibrationSuite,
} from './calibration.js';

export {
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
  DEFAULT_LENS_TIERS,
  fetchPriorReviews,
  classifyCommitRelationship,
  getIncrementalDiff,
  revalidatePriorFindings,
  formatRevalidationSummary,
  saveReviewCache,
  getReviewCache,
  invalidateReviewCache,
  listReviewCaches,
  publishCachedReview,
  formatFindingRow,
  formatFindingsTable,
  parseSelectionInput,
  filterFindings,
  promptFindingSelection,
  isQuotaOrCapacityError,
  isQuotaError,
  isModelUnavailableError,
  isRetriableModelError,
  runSelfReview,
  evaluateSelfReviewVerdict,
  formatSelfReviewSummary,
  getWorktreeDiff,
  generateSyntheticDiff,
  recoverFindingsFromText,
  extractJsonEnvelope,
  repairJsonString,
  extractCandidateObjects,
  normalizeFindingCandidate,
  isValidFindingCandidate,
  parseEventPayload,
  resolveCiEnvironment,
  evaluateCiQualityGate,
  writeGitHubStepOutputs,
  formatCiSummary,
  parseCommentCommand,
  isAuthorizedCommenter,
  getCommenterAuthorization,
  addCommentReaction,
  postIssueComment,
  formatUnauthorizedReply,
  formatHelpReply,
  formatCompletionReply,
  getCustomRoles,
  formatDefaultRoleName,
  VERSION,
  PLUGIN_VERSION,
  PLUGIN_NAME,
  isValidSemVer,
  parseSemVer,
  CALIBRATION_BENCHMARKS,
  evaluateCalibrationFinding,
  evaluateCalibrationSuite,
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
Review to find where the argument breaks down. Inspect the unified diff carefully for:
- Where the argument breaks down: Trace execution paths through edge cases, boundary conditions, and failure/exception escapes rather than trusting the happy path. Verify whether unhandled exceptions, promise rejections, or errors escape into unhandled execution contexts.
- Precondition & Landing Surface Invariants: Inspect assumptions about external state, file paths, git refs, environment variables, or resources before code executes. Verify whether activation triggers (CI workflows, dispatch inputs, flags, schedulers) assume pre-existing environment state without verification.
- Concurrency & Async Lifecycle: Uncoordinated concurrent mutations, race conditions, missing awaits, unhandled promise rejections, thread/process lifecycle leaks, deadlocks, or state corruption.
- Calculation & Logic: Faulty calculations, incorrect boolean conditions, off-by-one errors, and unhandled null/undefined values.`,
  },
  contracts: {
    id: 'contracts',
    name: 'Contracts & Data',
    description: 'API surface, backwards compatibility, typing, schema mutations, and data invariants.',
    instructions: `You are an expert software engineer reviewing code specifically for Contracts & Data invariants.
Inspect the unified diff carefully for:
- Explicit Parameterization vs. Ambient State Coupling: Flag reusable library functions, modules, or components that read implicit global, ambient process (e.g. process.argv, process.cwd(), process.env), or environment state instead of receiving explicit parameters via configuration, options, or dependency injection.
- Interface Stability & Compatibility: Breaking API or signature changes, schema drift, missing field defaults, or invalid assumptions about external payloads.
- Data Exposure: Surfacing existing internal data to a new external audience or output (logs, error payloads, responses) is an exposure, not a refactor. Verify invariant boundaries across component interfaces.`,
  },
  security: {
    id: 'security',
    name: 'Security & Trust Boundaries',
    description: 'Injection vulnerabilities, auth bypass, sensitive data leaks, and untrusted inputs.',
    instructions: `You are an expert security engineer reviewing code specifically for Security & Trust Boundaries.
Inspect the unified diff carefully for:
- Trust Boundary Crossings: Injection sinks (SQL, shell, command execution, template injection, XSS), path traversal (user input resolving to filesystem or storage keys), and unsafe deserialization.
- Landing Surface Authorization: Verify that new or modified endpoints, actions, or workflows enforce proper access controls and cannot be invoked unauthenticated or with unintended elevated privileges.
- Secret Exposure: Hardcoded tokens, API keys, credentials, private keys, or sensitive internal data leaking into logs, responses, or error payloads.`,
  },
  performance: {
    id: 'performance',
    name: 'Performance & Resources',
    description: 'Algorithmic complexity regressions, N+1 queries, memory leaks, and resource management.',
    instructions: `You are an expert performance engineer reviewing code specifically for Performance & Resources.
Inspect the unified diff carefully for:
- Redundant Work & Side-Effect Duplication: Duplicate or repeated subprocess invocations, file I/O operations, database queries (N+1), or network refetches when the result is already computed or can be computed once up-front.
- Algorithmic Complexity Traps: O(N^2) loops over unbounded inputs, unindexed lookups, redundant re-traversals, and unnecessary large object allocations inside hot code paths.
- Resource Lifecycles & Leaks: Unclosed streams or handles, unreleased locks, persistent event listener accumulation, and memory retention.`,
  },
  conventions: {
    id: 'conventions',
    name: 'Conventions & Maintainability',
    description: 'Architectural cohesion, readability, naming clarity, and codebase standards.',
    instructions: `You are an expert software craftsman reviewing code specifically for Conventions & Maintainability.
Inspect the unified diff carefully for:
- Dead Code & Phantom Logic: Dead variable initializations, unreachable branches, shadowed variables, and redundant conditional assignments that are immediately overwritten or never take effect.
- Duplication & Single Source of Truth: Copy-pasting boilerplate logic (e.g. flag parsing, banner printing, error formatting) across multiple sibling entrypoints or CLI commands rather than centralizing in a shared abstraction (DRY).
- Architectural Cohesion: Clean separation of concerns, clear abstraction boundaries, and domain-appropriate naming clarity.`,
  },
  tests: {
    id: 'tests',
    name: 'Test Quality & Verification',
    description: 'Test coverage for new code paths, brittle assertions, and regression prevention.',
    instructions: `You are an expert QA and test engineer reviewing code specifically for Test Quality & Verification.
Inspect the unified diff carefully for:
- Evidence Before Completion: Verify whether newly introduced behaviors, failure paths, and edge cases are backed by passing automated tests.
- Test Integrity: Flaky assertions, non-deterministic timing, unrealistic mocking boundaries, or tests asserting implementation details instead of observable behavior.`,
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
export function buildReviewerPrompt({
  lens,
  diffText,
  prMetadata,
  customInstructions,
  diffTransport,
}) {
  const lensDef = typeof lens === 'string' ? LENS_DEFINITIONS[lens] : lens;
  const lensName = lensDef?.name || 'Code Review';
  const instructions = lensDef?.instructions || lensDef?.prompt || '';

  const prContext = prMetadata
    ? `Pull Request Context:\n- PR #${prMetadata.number ?? ''}: ${prMetadata.title ?? ''}\n`
    : '';

  const customBlock = customInstructions
    ? `Additional Review Instructions:\n${customInstructions}\n\n`
    : '';

  let diffSection = '';

  const isLarge =
    diffTransport?.isLarge ?? (typeof diffText === 'string' && isLargeDiff(diffText));

  if (isLarge) {
    const transport = diffTransport || {
      isLarge: true,
      byteSize: Buffer.byteLength(diffText || '', 'utf8'),
      diffFilePath: null,
      formattedManifest: formatDiffManifest(generateDiffManifest(diffText || '')),
    };

    const formatBytes = (bytes) => {
      if (!bytes || bytes <= 0) return '0 B';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const diffRef = transport.diffFilePath
      ? path.basename(transport.diffFilePath)
      : 'diff.patch';

    diffSection = `## Large Diff Transport Notice (> 200 KB)

The unified diff for this pull request is ${formatBytes(transport.byteSize)} (exceeds inline threshold of 200 KB).
To protect session context and enable thorough investigation of critical changes, file-backed transport is active.
Diff Reference: \`${diffRef}\`

### Changed Files Manifest:
${transport.formattedManifest}

### Host-Supervised Inspection Tools:
You have access to host-supervised tools (\`read\`, \`grep\`, \`find\`) capped at an access budget of ~640 KB across 16 read operations.
Use these tools to inspect specific files, hunks, or search for patterns relevant to your specialist lens.
`;
  } else {
    diffSection = `## Unified Diff to Inspect:
\`\`\`diff
${diffText}
\`\`\`
`;
  }

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
- Grounding & Landing Surface:
  - Only report findings that are grounded in the diff lines below.
  - Consider the surface the change lands on: assess whether the code makes invalid assumptions about ambient environment state, unverified external refs, or unhandled failure escape paths.
- If no defects meet the threshold, return an empty array: <<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>.

${diffSection}`;
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
  execGitFn,
  cwd = process.cwd(),
  repo,
  expectedHeadSha,
  dryRun = false,
  publish = false,
  customInstructions,
  incremental = false,
  selectedIndices,
  selection,
  cacheReview = true,
  cacheDir,
  roles,
  enabledRoles,
  replaceStandardRoles,
  customRoles,
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

  // Detect if diff exceeds 200 KB threshold
  const isLarge = isLargeDiff(unifiedDiffText);
  let diffTransport = null;
  let autoCreatedTransport = false;

  if (isLarge) {
    diffTransport = await createFileBackedDiff(unifiedDiffText);
    autoCreatedTransport = true;
  }

  try {
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

    // 2b. Incremental re-review discovery & relationship classification
    let priorData = null;
    let commitRel = null;
    let revalidation = null;

    if (incremental) {
      priorData = await fetchPriorReviews({ prNumber: num, repo, execGhFn, cwd });
      commitRel = await classifyCommitRelationship({
        priorHeadSha: priorData?.latestReview?.commitId || null,
        currentHeadSha,
        execGitFn,
        cwd,
      });

      if (commitRel.relationship === 'same_head') {
        const summary = `## PR Review Summary (gem-pr-review v${PLUGIN_VERSION}, Mode: \`${resolvedMode.name}\` [Incremental])

- **Pull Request**: #${num}${prMetadata.title ? ` (${prMetadata.title})` : ''}
- **Status**: ℹ️ PR head commit (${currentHeadSha || 'unknown'}) has not changed since the last review. No new commits to evaluate.`;

        return {
          prNumber: num,
          repo: repo || null,
          headSha: currentHeadSha,
          mode: resolvedMode.name,
          relationship: 'same_head',
          canIncremental: false,
          priorReview: priorData?.latestReview || null,
          lensesExecuted: [],
          subagentPlan: [],
          errors: [],
          findings: priorData?.findings || [],
          rawFindingsCount: priorData?.findings?.length || 0,
          summary,
          revalidation: null,
          classification: null,
          publication: null,
          published: false,
          diffTransport: diffTransport
            ? {
                isLarge: true,
                byteSize: diffTransport.byteSize,
                totalFiles: diffTransport.manifest.totalFiles,
              }
            : {
                isLarge: false,
                byteSize: Buffer.byteLength(unifiedDiffText, 'utf8'),
              },
        };
      }

      if (commitRel.relationship === 'incremental') {
        const incDiff = await getIncrementalDiff({
          priorHeadSha: commitRel.priorHeadSha,
          currentHeadSha,
          repo,
          execGitFn,
          execGhFn,
          cwd,
        });

        if (incDiff && incDiff.trim()) {
          unifiedDiffText = incDiff;
        }

        revalidation = revalidatePriorFindings({
          priorFindings: priorData?.findings || [],
          incrementalDiffText: incDiff || '',
        });
      }
    }

    // 3. Execute review passes across lenses in parallel
    const plan = resolveLensPlan({
      mode: resolvedMode,
      config: resolvedConfig,
      roles: roles || enabledRoles,
      replaceStandardRoles,
      customRoles,
    });
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
        diffTransport,
        config: resolvedConfig,
      });
      allFindings = subagentResult.findings;
      subagentErrors = subagentResult.errors;
    }

    // 4. Deduplicate findings (merging still-open prior findings in incremental mode)
    let combinedFindings = allFindings;
    if (incremental && revalidation?.findings) {
      const stillOpen = revalidation.findings.filter((f) => f.status === 'still open');
      combinedFindings = [...allFindings, ...stillOpen];
    }
    const deduplicated = deduplicateFindings(combinedFindings);

    // 5. Generate Review Summary
    const severityCounts = { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 };
    for (const f of deduplicated) {
      const sev = f.severity || 'P2';
      if (severityCounts[sev] !== undefined) {
        severityCounts[sev]++;
      }
    }

    const roleNameById = new Map(
      plan.map((p) => [p.lensId, p.lensDef?.name || formatDefaultRoleName(p.lensId)])
    );
    const lensesList = executedLenses
      .map((id) => roleNameById.get(id) || LENS_DEFINITIONS[id]?.name || formatDefaultRoleName(id))
      .join(', ');
    const countsSummary = Object.entries(severityCounts)
      .filter(([, count]) => count > 0)
      .map(([sev, count]) => `**${sev}**: ${count}`)
      .join(' | ') || 'None';

    const modeLabel = incremental ? `${resolvedMode.name} [Incremental]` : resolvedMode.name;
    let summary = `## PR Review Summary (gem-pr-review v${PLUGIN_VERSION}, Mode: \`${modeLabel}\`)

- **Pull Request**: #${num}${prMetadata.title ? ` (${prMetadata.title})` : ''}
- **Specialist Lenses Inspected**: ${lensesList}
- **Total Findings**: ${deduplicated.length} (${countsSummary})
${isLarge ? `- **Diff Transport**: 📦 File-backed transport active (${(diffTransport.byteSize / 1024).toFixed(1)} KB exceeds 200 KB threshold)\n` : ''}
${deduplicated.length === 0 ? '✅ **No defects or blocking issues identified across all evaluated lenses.**' : 'Findings have been analyzed and anchored to unified diff hunks below.'}`;

    if (revalidation) {
      summary += '\n\n' + formatRevalidationSummary(revalidation);
    }

    const transportInfo = diffTransport
      ? {
          isLarge: true,
          byteSize: diffTransport.byteSize,
          totalFiles: diffTransport.manifest.totalFiles,
        }
      : {
          isLarge: false,
          byteSize: Buffer.byteLength(unifiedDiffText, 'utf8'),
        };

    // 5b. In-session caching (publish-later retention)
    let cachedRecord = null;
    if (cacheReview !== false && currentHeadSha) {
      try {
        cachedRecord = await saveReviewCache(
          {
            prNumber: num,
            headSha: currentHeadSha,
            repo,
            mode: resolvedMode.name,
            findings: deduplicated,
            rawFindingsCount: allFindings.length,
            summary,
            lensesExecuted: executedLenses,
            diffTransport: transportInfo,
            revalidation,
          },
          { cacheDir }
        );
      } catch {
        // Cache save failure is non-fatal for direct review execution
      }
    }

    // 6. Publish or Dry Run
    const diffs = parseUnifiedDiff(unifiedDiffText);

    if (publish && !dryRun) {
      let findingsToPublish = deduplicated;
      if (Array.isArray(selectedIndices)) {
        findingsToPublish = filterFindings(deduplicated, selectedIndices);
      } else if (selection !== undefined && selection !== null) {
        findingsToPublish = filterFindings(deduplicated, selection);
      }

      const pubResult = await publishReview({
        prNumber: num,
        reviewBody: summary,
        findings: findingsToPublish,
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
        relationship: commitRel?.relationship || null,
        canIncremental: commitRel?.canIncremental ?? false,
        priorReview: priorData?.latestReview || null,
        revalidation: revalidation || null,
        lensesExecuted: executedLenses,
        subagentPlan: plan,
        errors: subagentErrors,
        findings: deduplicated,
        rawFindingsCount: allFindings.length,
        summary: pubResult.reviewBody,
        classification: pubResult.classification,
        publication: pubResult,
        published: true,
        diffTransport: transportInfo,
        cached: Boolean(cachedRecord),
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
      relationship: commitRel?.relationship || null,
      canIncremental: commitRel?.canIncremental ?? false,
      priorReview: priorData?.latestReview || null,
      revalidation: revalidation || null,
      lensesExecuted: executedLenses,
      subagentPlan: plan,
      errors: subagentErrors,
      findings: deduplicated,
      rawFindingsCount: allFindings.length,
      summary,
      classification,
      publication: null,
      published: false,
      diffTransport: transportInfo,
      cached: Boolean(cachedRecord),
    };
  } finally {
    if (autoCreatedTransport && diffTransport) {
      await diffTransport.cleanup();
    }
  }
}
