#!/usr/bin/env node
/**
 * server/index.js — Model Context Protocol (MCP) Server
 *
 * Implements Agent Plugins 1.0 standard MCP server providing tools for:
 * - pr_review_subagents: parallel multi-lens review execution
 * - pr_review_diff: unified diff parsing and hunk commentability verification
 * - pr_review_publish: host-gated GitHub review submission
 */
import readline from 'node:readline';
import path from 'node:path';
import {
  getPrDiff,
  parseUnifiedDiff,
  isLargeDiff,
  generateDiffManifest,
  formatDiffManifest,
  createHostSupervisedDiffReader,
  LARGE_DIFF_THRESHOLD_BYTES,
} from '../src/diff.js';
import { publishReview } from '../src/publish.js';
import { publishCachedReview } from '../src/cache.js';
import { runReview, resolveReviewMode } from '../src/reviewer.js';
import { createSubagentRunner } from '../src/subagents.js';
import { loadConfig } from '../src/config.js';
import {
  fetchPriorReviews,
  classifyCommitRelationship,
  getIncrementalDiff,
  revalidatePriorFindings,
  formatRevalidationSummary,
} from '../src/prior.js';
import {
  runVerification,
  listVerificationProfiles,
  formatVerificationSummary,
} from '../src/verify.js';
import { runSelfReview } from '../src/self-review.js';
import { loadGuidelines } from '../src/guidelines.js';
import { PLUGIN_VERSION } from '../src/version.js';

export const MCP_TOOLS = [
  {
    name: 'gem_pr_review_subagents',
    description:
      'Executes parallel specialist review lenses across a PR diff using Copilot SDK or configured model tiers.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number to review',
        },
        mode: {
          type: 'string',
          enum: ['balanced', 'quick', 'full', 'deep'],
          description: 'Review mode (balanced: 5 lenses, quick: 3 lenses, full: 6 lenses, deep: 1 lens)',
          default: 'balanced',
        },
        diffText: {
          type: 'string',
          description: 'Optional raw unified diff text (retrieved via gh if omitted)',
        },
        customInstructions: {
          type: 'string',
          description: 'Optional additional review instructions for specialist lenses',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, performs review analysis and returns findings without publishing to GitHub',
          default: true,
        },
        publish: {
          type: 'boolean',
          description: 'If true and dryRun is false, submits host-gated review to GitHub',
          default: false,
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of review role IDs to execute (standard lenses or custom roles)',
        },
        replaceStandardRoles: {
          type: 'boolean',
          description: 'If true, only executes custom/specified roles and skips standard lenses',
          default: false,
        },
        customRoles: {
          type: 'object',
          description: 'Optional dictionary of custom role definitions { [roleId]: { name, prompt, model, reasoningEffort } }',
        },
        guidelinesPath: {
          type: 'string',
          description: 'Optional custom path to repository review guidelines markdown file',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_pr_review_diff',
    description:
      'Retrieves and parses the unified diff and hunk commentability for a GitHub pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_pr_review_diff_read',
    description:
      'Performs host-supervised inspection (read, grep, find) on a PR diff with strict budget caps (max 16 reads, ~640 KB total).',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        operation: {
          type: 'string',
          enum: ['read', 'grep', 'find'],
          description:
            'Supervised reader operation (read: slice diff or file, grep: pattern search, find: list changed files)',
          default: 'read',
        },
        file: {
          type: 'string',
          description: 'Optional file path within the diff',
        },
        offset: {
          type: 'integer',
          description: 'Character offset for read operation',
        },
        limit: {
          type: 'integer',
          description: 'Max characters to read',
        },
        startLine: {
          type: 'integer',
          description: '1-based starting line number for read operation',
        },
        lineCount: {
          type: 'integer',
          description: 'Number of lines to read',
        },
        query: {
          type: 'string',
          description: 'Search query for grep or find',
        },
        isRegex: {
          type: 'boolean',
          description: 'Treat query as regex for grep operation',
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_pr_review_publish',
    description:
      'Publishes host-gated code review comments and summary to GitHub with diff hunk validation.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        findings: {
          type: 'array',
          description: 'List of structured findings to anchor and publish',
        },
        reviewBody: {
          type: 'string',
          description: 'Optional review summary markdown body',
        },
        expectedHeadSha: {
          type: 'string',
          description: 'Expected PR head SHA for stale review check',
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
      },
      required: ['prNumber', 'findings'],
    },
  },
  {
    name: 'gem_pr_review_publish_cached',
    description:
      'Publishes previously cached review findings for a PR without rerunning model inference, after verifying that the PR head commit has not changed and diff hunks remain valid.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
        expectedHeadSha: {
          type: 'string',
          description: 'Expected PR head commit SHA for freshness check',
        },
        selectedIndices: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Optional 0-based indices of cached findings to publish',
        },
        minSeverity: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3', 'nit'],
          description: 'Optional minimum severity threshold to include',
        },
        reviewBody: {
          type: 'string',
          description: 'Optional review summary markdown body override',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_pr_review_prior',
    description:
      'Discovers prior reviews on a PR, classifies commit relationship (same_head, incremental, diverged, none), and revalidates prior findings against incremental commits.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        currentHeadSha: {
          type: 'string',
          description: 'Current PR head commit SHA (retrieved if omitted)',
        },
        repo: {
          type: 'string',
          description: 'Optional repository in owner/repo format',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_pr_review_verify',
    description:
      'Executes verification commands (e.g. tests or build) against the exact PR head in an isolated detached git worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'list'],
          description: 'Verification action (run: execute test in worktree, list: list available profiles)',
          default: 'run',
        },
        prNumber: {
          type: 'integer',
          description: 'GitHub pull request number',
        },
        headSha: {
          type: 'string',
          description: 'PR head commit SHA (retrieved automatically if omitted)',
        },
        profile: {
          type: 'string',
          description: 'Verification profile name (e.g. "test", "build", "lint")',
          default: 'test',
        },
        command: {
          type: 'string',
          description: 'Optional custom command override',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Execution timeout in milliseconds',
        },
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'gem_self_review',
    description:
      'Executes a one-shot coding-task self-review on uncommitted local working tree changes (staged, unstaged, untracked). Returns fail-closed status ("passed" vs "failed") based on blocking P0/P1 issues.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'staged', 'unstaged', 'head'],
          description: 'Working tree changes scope to inspect (default: "all")',
          default: 'all',
        },
        mode: {
          type: 'string',
          enum: ['balanced', 'quick', 'full', 'deep'],
          description: 'Review mode (balanced: 5 lenses, quick: 3 lenses, full: 6 lenses, deep: 1 lens)',
          default: 'balanced',
        },
        includeUntracked: {
          type: 'boolean',
          description: 'Whether to include untracked new files via synthetic diffs (default: true)',
          default: true,
        },
        diffText: {
          type: 'string',
          description: 'Optional diff text override to review instead of querying git worktree',
        },
        failOn: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'Minimum severity threshold that triggers failure (default: "P1")',
          default: 'P1',
        },
        customInstructions: {
          type: 'string',
          description: 'Optional additional instructions for review lenses',
        },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of review role IDs to execute (standard lenses or custom roles)',
        },
        replaceStandardRoles: {
          type: 'boolean',
          description: 'If true, only executes custom/specified roles and skips standard lenses',
          default: false,
        },
        customRoles: {
          type: 'object',
          description: 'Optional dictionary of custom role definitions { [roleId]: { name, prompt, model, reasoningEffort } }',
        },
        guidelinesPath: {
          type: 'string',
          description: 'Optional custom path to repository review guidelines markdown file',
        },
      },
    },
  },
  {
    name: 'gem_pr_review_self',
    description:
      'Alias for gem_self_review. Executes a one-shot coding-task self-review on uncommitted local working tree changes.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'staged', 'unstaged', 'head'],
          description: 'Working tree changes scope to inspect (default: "all")',
          default: 'all',
        },
        mode: {
          type: 'string',
          enum: ['balanced', 'quick', 'full', 'deep'],
          description: 'Review mode (balanced: 5 lenses, quick: 3 lenses, full: 6 lenses, deep: 1 lens)',
          default: 'balanced',
        },
        includeUntracked: {
          type: 'boolean',
          description: 'Whether to include untracked new files via synthetic diffs (default: true)',
          default: true,
        },
        diffText: {
          type: 'string',
          description: 'Optional diff text override to review instead of querying git worktree',
        },
        failOn: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'Minimum severity threshold that triggers failure (default: "P1")',
          default: 'P1',
        },
        customInstructions: {
          type: 'string',
          description: 'Optional additional instructions for review lenses',
        },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of review role IDs to execute (standard lenses or custom roles)',
        },
        replaceStandardRoles: {
          type: 'boolean',
          description: 'If true, only executes custom/specified roles and skips standard lenses',
          default: false,
        },
        customRoles: {
          type: 'object',
          description: 'Optional dictionary of custom role definitions { [roleId]: { name, prompt, model, reasoningEffort } }',
        },
        guidelinesPath: {
          type: 'string',
          description: 'Optional custom path to repository review guidelines markdown file',
        },
      },
    },
  },
  {
    name: 'gem_pr_review_guidelines',
    description:
      'Inspects and parses repository review guidelines and domain invariants (.github/gem-pr-review.md).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional custom path to guidelines file (defaults to .github/gem-pr-review.md)',
        },
        cwd: {
          type: 'string',
          description: 'Optional workspace directory to search from',
        },
      },
    },
  },
  {
    name: 'pr_review_guidelines',
    description: 'Alias for gem_pr_review_guidelines.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional custom path to guidelines file (defaults to .github/gem-pr-review.md)',
        },
        cwd: {
          type: 'string',
          description: 'Optional workspace directory to search from',
        },
      },
    },
  },
];

/**
 * Creates an MCP message handler implementing the JSON-RPC 2.0 protocol.
 */
export function createMcpHandler(options = {}) {
  const {
    getPrDiffFn = getPrDiff,
    publishReviewFn = publishReview,
    publishCachedReviewFn = publishCachedReview,
    runReviewFn = runReview,
    runSelfReviewFn = runSelfReview,
    fetchPriorReviewsFn = fetchPriorReviews,
    classifyCommitRelationshipFn = classifyCommitRelationship,
    getIncrementalDiffFn = getIncrementalDiff,
    revalidatePriorFindingsFn = revalidatePriorFindings,
    runVerificationFn = runVerification,
    listVerificationProfilesFn = listVerificationProfiles,
    createHostSupervisedDiffReaderFn = createHostSupervisedDiffReader,
    loadGuidelinesFn = loadGuidelines,
    runnerFn,
    cwd = process.cwd(),
  } = options;

  return {
    async handleMessage(message) {
      if (!message || typeof message !== 'object') {
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        };
      }

      const { id, method, params } = message;

      // Handle Notifications (e.g. notifications/initialized)
      if (id === undefined || id === null) {
        return null;
      }

      switch (method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: params?.protocolVersion || '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'gem-pr-review',
                version: PLUGIN_VERSION,
              },
            },
          };
        }

        case 'ping': {
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          };
        }

        case 'tools/list': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: MCP_TOOLS,
            },
          };
        }

        case 'tools/call': {
          const toolName = params?.name;
          const args = params?.arguments || {};

          try {
            if (toolName === 'gem_pr_review_diff' || toolName === 'pr_review_diff') {
              const diffText = await getPrDiffFn({
                prNumber: args.prNumber,
                repo: args.repo,
                cwd,
              });
              const parsedDiffs = parseUnifiedDiff(diffText);
              const isLarge = isLargeDiff(diffText);
              const manifest = generateDiffManifest(parsedDiffs, {
                threshold: LARGE_DIFF_THRESHOLD_BYTES,
              });

              const summary = {
                prNumber: args.prNumber,
                filesCount: parsedDiffs.length,
                files: parsedDiffs.map((f) => ({
                  path: f.path,
                  oldPath: f.oldPath,
                  isNew: f.isNew,
                  isDeleted: f.isDeleted,
                  isBinary: f.isBinary,
                  hunksCount: f.hunks.length,
                })),
                rawDiffLength: diffText.length,
                isLarge,
                thresholdBytes: LARGE_DIFF_THRESHOLD_BYTES,
                manifest: {
                  totalFiles: manifest.totalFiles,
                  totalAdditions: manifest.totalAdditions,
                  totalDeletions: manifest.totalDeletions,
                  totalBytes: manifest.totalBytes,
                  isLarge: manifest.isLarge,
                },
              };

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(summary, null, 2),
                    },
                  ],
                },
              };
            }

            if (toolName === 'gem_pr_review_diff_read' || toolName === 'pr_review_diff_read') {
              const diffText = await getPrDiffFn({
                prNumber: args.prNumber,
                repo: args.repo,
                cwd,
              });
              const reader = createHostSupervisedDiffReaderFn({ diffText });
              const op = args.operation || 'read';
              let opResult = null;

              if (op === 'read') {
                opResult = await reader.read({
                  file: args.file,
                  offset: args.offset,
                  limit: args.limit,
                  startLine: args.startLine,
                  lineCount: args.lineCount,
                });
              } else if (op === 'grep') {
                opResult = await reader.grep({
                  query: args.query,
                  file: args.file,
                  isRegex: args.isRegex,
                });
              } else if (op === 'find') {
                opResult = reader.find({
                  query: args.query,
                  status: args.status,
                });
              } else {
                opResult = { error: `Unsupported operation: ${op}` };
              }

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          prNumber: args.prNumber,
                          operation: op,
                          result: opResult,
                          budgetState: reader.getBudgetState(),
                        },
                        null,
                        2
                      ),
                    },
                  ],
                },
              };
            }

            if (toolName === 'gem_pr_review_subagents' || toolName === 'pr_review_subagents') {
              let diffText = args.diffText;
              if (!diffText) {
                diffText = await getPrDiffFn({
                  prNumber: args.prNumber,
                  repo: args.repo,
                  cwd,
                });
              }
              const runner = runnerFn || (await createSubagentRunner({ cwd }));
              const reviewResult = await runReviewFn({
                prNumber: args.prNumber,
                mode: args.mode || 'balanced',
                diffText,
                customInstructions: args.customInstructions,
                dryRun: args.dryRun !== false,
                publish: args.publish === true,
                repo: args.repo,
                runnerFn: runner,
                cwd,
                roles: args.roles || args.enabledRoles,
                replaceStandardRoles: args.replaceStandardRoles,
                customRoles: args.customRoles,
                guidelinesPath: args.guidelinesPath,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(reviewResult, null, 2),
                    },
                  ],
                },
              };
            }

            if (toolName === 'gem_pr_review_publish' || toolName === 'pr_review_publish') {
              const pubResult = await publishReviewFn({
                prNumber: args.prNumber,
                findings: args.findings || [],
                reviewBody: args.reviewBody || 'Automated code review summary.',
                expectedHeadSha: args.expectedHeadSha,
                repo: args.repo,
                cwd,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(pubResult, null, 2),
                    },
                  ],
                },
              };
            }

            if (
              toolName === 'gem_pr_review_publish_cached' ||
              toolName === 'pr_review_publish_cached'
            ) {
              const pubCachedResult = await publishCachedReviewFn({
                prNumber: args.prNumber,
                repo: args.repo,
                headSha: args.expectedHeadSha,
                selectedIndices: args.selectedIndices,
                minSeverity: args.minSeverity,
                reviewBody: args.reviewBody,
                cwd,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(pubCachedResult, null, 2),
                    },
                  ],
                },
              };
            }

            if (toolName === 'gem_pr_review_prior' || toolName === 'pr_review_prior') {
              const prNum = Number(args.prNumber);
              const currentHeadSha = args.currentHeadSha;
              const repo = args.repo;

              const prior = await fetchPriorReviewsFn({ prNumber: prNum, repo, cwd });
              const priorHeadSha = prior?.latestReview?.commitId || null;

              const relationshipInfo = await classifyCommitRelationshipFn({
                priorHeadSha,
                currentHeadSha,
                cwd,
              });

              let revalidation = null;
              if (relationshipInfo.canIncremental && prior?.findings?.length > 0) {
                const incDiff = await getIncrementalDiffFn({
                  priorHeadSha,
                  currentHeadSha,
                  repo,
                  cwd,
                });
                if (incDiff) {
                  revalidation = revalidatePriorFindingsFn({
                    priorFindings: prior.findings,
                    incrementalDiffText: incDiff,
                  });
                }
              }

              const priorResult = {
                prNumber: prNum,
                repo: repo || null,
                priorReview: prior?.latestReview || null,
                relationship: relationshipInfo.relationship,
                canIncremental: relationshipInfo.canIncremental,
                reason: relationshipInfo.reason,
                findings: revalidation?.findings || prior?.findings || [],
                revalidation: revalidation || null,
                revalidationSummary: revalidation ? formatRevalidationSummary(revalidation) : null,
              };

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(priorResult, null, 2),
                    },
                  ],
                },
              };
            }

            if (toolName === 'gem_pr_review_verify' || toolName === 'pr_review_verify') {
              const prNum = parseInt(args.prNumber, 10);
              const action = args.action || 'run';
              const headSha = args.headSha;
              const profile = args.profile || 'test';
              const command = args.command;
              const timeoutMs = args.timeoutMs;

              const config = loadConfig(cwd);

              if (action === 'list') {
                const profiles = listVerificationProfilesFn(config);
                return {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({ profiles }, null, 2),
                      },
                    ],
                  },
                };
              }

              if (!prNum) {
                return {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    isError: true,
                    content: [
                      {
                        type: 'text',
                        text: 'prNumber is required for pr_review_verify',
                      },
                    ],
                  },
                };
              }

              // Custom command overlay if supplied
              if (command) {
                config.verificationProfiles = {
                  ...config.verificationProfiles,
                  [profile]: {
                    command,
                    timeoutMs: timeoutMs || 60000,
                  },
                };
              }

              const verifyResult = await runVerificationFn({
                prNumber: prNum,
                headSha,
                profileName: profile,
                config,
                repoPath: cwd,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          ...verifyResult,
                          summary: formatVerificationSummary(verifyResult),
                        },
                        null,
                        2
                      ),
                    },
                  ],
                },
              };
            }

            if (
              toolName === 'gem_self_review' ||
              toolName === 'gem_pr_review_self' ||
              toolName === 'pr_review_self'
            ) {
              const runner = runnerFn || (await createSubagentRunner({ cwd }));
              const selfReviewResult = await runSelfReviewFn({
                cwd,
                scope: args.scope || 'all',
                mode: args.mode || 'balanced',
                includeUntracked: args.includeUntracked !== false,
                diffText: args.diffText,
                failOn: args.failOn || 'P1',
                customInstructions: args.customInstructions,
                runnerFn: runner,
                roles: args.roles || args.enabledRoles,
                replaceStandardRoles: args.replaceStandardRoles,
                customRoles: args.customRoles,
                guidelinesPath: args.guidelinesPath,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(selfReviewResult, null, 2),
                    },
                  ],
                },
              };
            }

            if (
              toolName === 'gem_pr_review_guidelines' ||
              toolName === 'pr_review_guidelines'
            ) {
              const targetCwd = args.cwd || cwd;
              const config = loadConfig(targetCwd);
              const guidelines = loadGuidelinesFn({
                cwd: targetCwd,
                config,
                guidelinesPath: args.path,
              });

              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          enabled: guidelines.enabled,
                          found: guidelines.found,
                          path: guidelines.path,
                          relativePath: guidelines.relativePath,
                          byteSize: guidelines.byteSize,
                          truncated: guidelines.truncated,
                          rawContent: guidelines.rawContent,
                          parsed: guidelines.parsed,
                        },
                        null,
                        2
                      ),
                    },
                  ],
                },
              };
            }

            return {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: `Unknown tool: ${toolName}`,
                  },
                ],
              },
            };
          } catch (err) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: `Tool execution failed: ${err.message}`,
                  },
                ],
              },
            };
          }
        }

        default: {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
        }
      }
    },
  };
}

/**
 * Starts the stdio-based JSON-RPC MCP server.
 */
export function startMcpServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const handler = createMcpHandler(options);

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const message = JSON.parse(trimmed);
      const response = await handler.handleMessage(message);
      if (response !== null && response !== undefined) {
        output.write(JSON.stringify(response) + '\n');
      }
    } catch {
      output.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }) + '\n'
      );
    }
  });

  return {
    close() {
      rl.close();
    },
  };
}

// Execute when invoked directly from CLI
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve('server/index.js');

if (isDirectRun) {
  startMcpServer();
}
