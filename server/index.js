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
import { getPrDiff, parseUnifiedDiff } from '../src/diff.js';
import { publishReview } from '../src/publish.js';
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

export const MCP_TOOLS = [
  {
    name: 'pr_review_subagents',
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
      },
      required: ['prNumber'],
    },
  },
  {
    name: 'pr_review_diff',
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
    name: 'pr_review_publish',
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
    name: 'pr_review_prior',
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
];

/**
 * Creates an MCP message handler implementing the JSON-RPC 2.0 protocol.
 */
export function createMcpHandler(options = {}) {
  const {
    getPrDiffFn = getPrDiff,
    publishReviewFn = publishReview,
    runReviewFn = runReview,
    fetchPriorReviewsFn = fetchPriorReviews,
    classifyCommitRelationshipFn = classifyCommitRelationship,
    getIncrementalDiffFn = getIncrementalDiff,
    revalidatePriorFindingsFn = revalidatePriorFindings,
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
                name: 'copilot-pr-review',
                version: '0.1.0',
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
            if (toolName === 'pr_review_diff') {
              const diffText = await getPrDiffFn({
                prNumber: args.prNumber,
                repo: args.repo,
                cwd,
              });
              const parsedDiffs = parseUnifiedDiff(diffText);
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

            if (toolName === 'pr_review_subagents') {
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

            if (toolName === 'pr_review_publish') {
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

            if (toolName === 'pr_review_prior') {
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
