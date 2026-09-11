#!/usr/bin/env node
/**
 * scripts/ci-action.mjs — GitHub Action CI Review Runner
 *
 * Runs multi-lens AI code review on GitHub pull requests inside GitHub Actions,
 * enforcing automated CI quality gates (fail_on) and publishing step outputs.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import {
  resolveCiEnvironment,
  evaluateCiQualityGate,
  writeGitHubStepOutputs,
  formatCiSummary,
  addCommentReaction,
  postIssueComment,
  formatUnauthorizedReply,
  formatHelpReply,
  formatCompletionReply,
  isVerificationPassed,
} from '../src/ci.js';
import { runReview } from '../src/reviewer.js';
import { runVerification, listVerificationProfiles } from '../src/verify.js';
import { createSubagentRunner } from '../src/subagents.js';
import { PLUGIN_VERSION, printVersionBanner } from '../src/version.js';
import { handleCommonFlags, runIfDirect } from '../src/cli.js';

export function printUsage(output = console.log) {
  output(`
Usage: node scripts/ci-action.mjs [options]

Runs multi-lens AI code review on GitHub pull requests inside GitHub Actions,
enforcing automated CI quality gates (fail_on) and publishing step outputs.

Options:
  -v, --version     Display version information
  --help, -h        Display this help message
`);
}

const MOCK_DIFF = `diff --git a/src/sample.js b/src/sample.js
index 1111111..2222222 100644
--- a/src/sample.js
+++ b/src/sample.js
@@ -1,3 +1,4 @@
 function calculate() {
+  console.log("ci test sample");
   return 42;
 }
`;

/**
 * Executes CI Action workflow.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.version] - Programmatic version flag (CLI invocations handled by handleCommonFlags)
 * @param {object} [env=process.env]
 * @param {object} [io=console]
 * @returns {Promise<{ exitCode: number, qualityGate?: object, reviewResult?: object, ciEnv?: object, error?: string }>}
 */
export async function runCiAction(options = {}, env = process.env, io = console) {
  if (options.version || env.INPUT_VERSION === 'true') {
    printVersionBanner(io);
    return { exitCode: 0, version: PLUGIN_VERSION };
  }

  const ciEnv = resolveCiEnvironment(options, env);

  // If event is an issue comment without a review command, skip cleanly
  if (ciEnv.isComment && !ciEnv.isCommentCommand) {
    io.log(
      `[CI] Issue comment #${ciEnv.commentId} received, but does not contain a /gem-review command. Skipping review.`
    );
    return { exitCode: 0, skipped: true, reason: 'not_a_command', ciEnv };
  }

  const cwd = options.cwd || process.cwd();
  const isMock = Boolean(options.mock || env.MOCK_CI === '1');
  const runVerificationFn = options.runVerificationFn || runVerification;

  // GitHub CLI wrapper
  const execGhFn =
    options.execGhFn ||
    ((args, ghOpts = {}) => {
      if (isMock) {
        if (args[0] === 'pr' && args[1] === 'view') {
          return Promise.resolve(
            JSON.stringify({
              headRefOid: 'ci-mock-head-sha',
              author: { login: 'ci-author' },
              state: 'OPEN',
              title: `CI PR #${ciEnv.prNumber || 0}`,
              isCrossRepository: false,
            })
          );
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return Promise.resolve(JSON.stringify({ login: 'github-actions[bot]' }));
        }
        if (args[0] === 'api' && args.includes('POST')) {
          return Promise.resolve(JSON.stringify({ id: 8888, state: 'COMMENTED' }));
        }
        return Promise.resolve('[]');
      }

      return new Promise((resolve, reject) => {
        const childEnv = { ...process.env, ...env };
        if (ciEnv.githubToken) {
          childEnv.GITHUB_TOKEN = ciEnv.githubToken;
          childEnv.GH_TOKEN = ciEnv.githubToken;
        }
        const child = execFile(
          'gh',
          args,
          { cwd: ghOpts.cwd || cwd, env: childEnv },
          (err, stdout, stderr) => {
            if (err) {
              const detail = (stderr && stderr.trim()) || err.message;
              reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
              return;
            }
            resolve(stdout);
          }
        );
        if (ghOpts.input && child?.stdin) {
          child.stdin.write(ghOpts.input);
          child.stdin.end();
        }
      });
    });

  // Safe reaction & comment helpers that catch/log API errors
  const safeReact = async (reaction) => {
    if (!ciEnv.commentId) return { success: false, skipped: true };
    const res = await addCommentReaction({
      repo: ciEnv.repo,
      commentId: ciEnv.commentId,
      reaction,
      execGhFn,
    });
    if (!res.success && res.error) {
      io.warn(`[CI] Warning: Failed to add '${reaction}' reaction to comment #${ciEnv.commentId}: ${res.error}`);
    }
    return res;
  };

  const safePostComment = async (body) => {
    if (!ciEnv.prNumber) return { success: false, skipped: true };
    const res = await postIssueComment({
      repo: ciEnv.repo,
      prNumber: ciEnv.prNumber,
      body,
      execGhFn,
    });
    if (!res.success && res.error) {
      io.warn(`[CI] Warning: Failed to post comment reply to PR #${ciEnv.prNumber}: ${res.error}`);
    }
    return res;
  };

  if (!ciEnv.prNumber) {
    const errorMsg =
      'Error: Unable to determine PR number. Ensure workflow is triggered by pull_request or specify pr_number input.';
    io.error(errorMsg);
    if (ciEnv.isCommentCommand && ciEnv.commentId) {
      await safeReact('confused');
    }
    writeGitHubStepOutputs(
      {
        verdict: 'FAIL',
        findings_count: '0',
        blocking_count: '0',
        summary: errorMsg,
      },
      { outputFile: env.GITHUB_OUTPUT }
    );
    return { exitCode: 1, error: errorMsg, ciEnv };
  }

  // Handle PR comment command dispatcher lifecycle
  if (ciEnv.isCommentCommand && ciEnv.commentId) {
    // 1. Immediate acknowledgment (eyes 👀)
    await safeReact('eyes');

    // 2. Authorization check
    if (!ciEnv.isAuthorized) {
      io.warn(
        `[CI] Unauthorized comment command from @${ciEnv.commentUser} (${ciEnv.commentAuthorAssociation}).`
      );
      await safeReact('confused');

      const denialReply = formatUnauthorizedReply({
        username: ciEnv.commentUser,
        association: ciEnv.commentAuthorAssociation,
        command: ciEnv.commandInfo?.command || '/gem-review',
      });
      await safePostComment(denialReply);

      return { exitCode: 0, unauthorized: true, ciEnv };
    }

    // 3. Help check
    if (ciEnv.commandInfo?.help) {
      io.log(`[CI] Providing /gem-review help guide to @${ciEnv.commentUser}.`);
      await safeReact('+1');

      const helpReply = formatHelpReply();
      await safePostComment(helpReply);

      return { exitCode: 0, help: true, ciEnv };
    }

    // 4. In-progress status reaction (rocket 🚀)
    await safeReact('rocket');
  }

  io.log('========================================================');
  io.log('Gem PR Review — GitHub Actions CI Reviewer');
  io.log('========================================================');
  io.log(`PR Number: #${ciEnv.prNumber}`);
  io.log(`Repository: ${ciEnv.repo || '(auto-detect)'}`);
  io.log(`Mode: ${ciEnv.mode}`);
  io.log(`Action: ${ciEnv.action}`);
  io.log(`Incremental: ${ciEnv.incremental ? 'true (synchronize / re-review)' : 'false'}`);
  io.log(`Quality Gate (fail_on): ${ciEnv.failOn}`);
  if (ciEnv.roles && ciEnv.roles.length > 0) {
    io.log(`Specialist Roles: ${ciEnv.roles.join(', ')}`);
  }
  io.log('========================================================\n');

  // Subagent runner setup
  let runnerFn = options.runnerFn;
  if (!runnerFn) {
    if (isMock) {
      runnerFn = async () => {
        if (options.mockFindings) {
          return `<<<PR_REVIEW_JSON>>>${JSON.stringify(options.mockFindings)}<<<END_PR_REVIEW_JSON>>>`;
        }
        return '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>';
      };
    } else {
      runnerFn = await createSubagentRunner({ cwd });
    }
  }

  const isDryRun = ciEnv.action === 'dry-run';
  const isPublish = ciEnv.action === 'publish';

  try {
    const reviewResult = await runReview({
      prNumber: ciEnv.prNumber,
      mode: ciEnv.mode,
      repo: ciEnv.repo,
      diffText: options.diffText || (isMock ? MOCK_DIFF : undefined),
      runnerFn,
      execGhFn,
      cwd,
      dryRun: isDryRun,
      publish: isPublish,
      incremental: ciEnv.incremental,
      select: ciEnv.select,
      roles: ciEnv.roles,
      replaceStandardRoles: ciEnv.replaceStandardRoles,
    });

    let verificationResult = null;
    if (ciEnv.verify) {
      const profileName = typeof ciEnv.verify === 'string' ? ciEnv.verify : 'test';
      const registered = listVerificationProfiles(options.config);
      const allowedNames = options.config?.allowedCiVerificationProfiles || Object.keys(registered);
      const SAFE_PROFILES = new Set(allowedNames);

      if (!SAFE_PROFILES.has(profileName)) {
        const errorMsg = `Security: Unrecognized or disallowed verification profile "${profileName}". Allowed safe profiles: ${[...SAFE_PROFILES].join(', ')}.`;
        io.warn(`[CI] ${errorMsg}`);
        verificationResult = {
          status: 'failed',
          profile: profileName,
          error: errorMsg,
          output: errorMsg,
        };
      } else {
        // Query PR metadata to ensure detached execution is blocked on cross-repository / fork PRs
        let isCrossRepo = true;
        let originCheckFailed = false;
        let originError = null;

        try {
          const prMetaStdout = await execGhFn(
            [
              'pr',
              'view',
              String(ciEnv.prNumber),
              '--json',
              'isCrossRepository,headRepository,headRepositoryOwner',
            ],
            { cwd }
          );
          const parsedMeta = JSON.parse(prMetaStdout);
          if (typeof parsedMeta?.isCrossRepository === 'boolean') {
            isCrossRepo = parsedMeta.isCrossRepository;
          } else if (parsedMeta?.headRepository?.nameWithOwner && ciEnv.repo) {
            isCrossRepo =
              parsedMeta.headRepository.nameWithOwner.toLowerCase() !==
              ciEnv.repo.toLowerCase();
          } else if (parsedMeta?.headRepositoryOwner?.login && ciEnv.repo) {
            const [baseOwner] = ciEnv.repo.split('/');
            isCrossRepo =
              parsedMeta.headRepositoryOwner.login.toLowerCase() !==
              baseOwner.toLowerCase();
          } else if (isMock && !options.simulateForkPr && !options.simulateOriginError) {
            isCrossRepo = false;
          } else {
            originCheckFailed = true;
            originError = 'GitHub API response missing repository origin indicators';
          }
        } catch (metaErr) {
          originCheckFailed = true;
          originError = metaErr.message;
        }

        if (originCheckFailed) {
          const errorMsg = `Unable to verify PR repository origin due to GitHub API error: ${originError}. Detached execution aborted.`;
          io.warn(`[CI] Security: ${errorMsg}`);
          verificationResult = {
            status: 'failed',
            profile: profileName,
            error: errorMsg,
            output: errorMsg,
          };
        } else if (isCrossRepo) {
          const skipMsg =
            'Detached worktree verification is disabled for cross-repository/fork PRs to prevent untrusted code execution.';
          io.warn(`[CI] Security: ${skipMsg}`);
          verificationResult = {
            status: 'failed',
            profile: profileName,
            error: skipMsg,
            output: skipMsg,
          };
        } else {
          try {
            io.log(`Running detached worktree test verification (profile: ${profileName})...`);
            verificationResult = await runVerificationFn({
              prNumber: ciEnv.prNumber,
              profileName,
              repoPath: cwd,
              execGhFn,
              config: options.config,
            });
            io.log(`Verification status: ${verificationResult.status}`);
          } catch (vErr) {
            io.warn(`Warning: Worktree verification failed: ${vErr.message}`);
            verificationResult = {
              status: 'failed',
              profile: profileName,
              error: vErr.message,
              output: vErr.message,
            };
          }
        }
      }
    }

    const qualityGate = evaluateCiQualityGate(reviewResult.findings, {
      failOn: ciEnv.failOn,
    });

    const verificationPassed = isVerificationPassed(verificationResult);
    const overallSuccess = qualityGate.passed && verificationPassed;

    // Write GitHub Action Step outputs
    writeGitHubStepOutputs(
      {
        verdict: overallSuccess ? qualityGate.verdict : 'FAIL',
        findings_count: String(qualityGate.totalFindings),
        blocking_count: String(qualityGate.blockingCount),
        summary: reviewResult.summary || '',
      },
      { outputFile: env.GITHUB_OUTPUT }
    );

    // Write GITHUB_STEP_SUMMARY if configured
    if (env.GITHUB_STEP_SUMMARY) {
      const ciSummary = formatCiSummary({
        reviewResult,
        qualityGateResult: qualityGate,
        ciEnv,
        verificationResult,
      });
      try {
        fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${ciSummary}\n`, 'utf8');
      } catch (summaryErr) {
        io.warn(`Warning: Could not write to GITHUB_STEP_SUMMARY: ${summaryErr.message}`);
      }
    }

    // PR comment command completion lifecycle (reaction + completion reply)
    if (ciEnv.isCommentCommand && ciEnv.commentId) {
      if (overallSuccess) {
        await safeReact('+1');
      } else {
        await safeReact('confused');
      }

      const completionReply = formatCompletionReply({
        reviewResult,
        qualityGateResult: qualityGate,
        ciEnv,
        verificationResult,
      });
      await safePostComment(completionReply);
    }

    io.log('\n────────────────────────────────────────────────────────');
    io.log(reviewResult.summary);
    io.log('────────────────────────────────────────────────────────\n');

    if (!overallSuccess) {
      if (!qualityGate.passed) {
        io.error(
          `❌ Quality gate failed: ${qualityGate.blockingCount} blocking defect(s) detected (Threshold: ${ciEnv.failOn}).`
        );
      }
      if (!verificationPassed) {
        io.error(
          `❌ Detached verification failed (${verificationResult?.profile || 'test'}): ${verificationResult?.error || verificationResult?.output || 'failed'}`
        );
      }
      return {
        exitCode: 1,
        qualityGate,
        reviewResult,
        verificationResult,
        ciEnv,
      };
    }

    io.log(`✅ AI Code Review passed quality gate (Threshold: ${ciEnv.failOn}).`);
    return {
      exitCode: 0,
      qualityGate,
      reviewResult,
      verificationResult,
      ciEnv,
    };
  } catch (err) {
    if (ciEnv.isCommentCommand && ciEnv.commentId) {
      await safeReact('confused');
    }

    const errorMsg = `CI Review execution failed: ${err.message}`;
    io.error(`\n❌ ${errorMsg}`);
    writeGitHubStepOutputs(
      {
        verdict: 'FAIL',
        findings_count: '0',
        blocking_count: '1',
        summary: errorMsg,
      },
      { outputFile: env.GITHUB_OUTPUT }
    );
    return { exitCode: 1, error: errorMsg, ciEnv };
  }
}

export async function main() {
  const rawArgs = process.argv.slice(2);
  handleCommonFlags(rawArgs, { printUsage });

  const result = await runCiAction({}, process.env, console);
  process.exit(result.exitCode);
}

runIfDirect(import.meta.url, main);

