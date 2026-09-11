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
} from '../src/ci.js';
import { runReview } from '../src/reviewer.js';
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

  if (!ciEnv.prNumber) {
    const errorMsg =
      'Error: Unable to determine PR number. Ensure workflow is triggered by pull_request or specify pr_number input.';
    io.error(errorMsg);
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

  io.log('========================================================');
  io.log('Gem PR Review — GitHub Actions CI Reviewer');
  io.log('========================================================');
  io.log(`PR Number: #${ciEnv.prNumber}`);
  io.log(`Repository: ${ciEnv.repo || '(auto-detect)'}`);
  io.log(`Mode: ${ciEnv.mode}`);
  io.log(`Action: ${ciEnv.action}`);
  io.log(`Incremental: ${ciEnv.incremental ? 'true (synchronize / re-review)' : 'false'}`);
  io.log(`Quality Gate (fail_on): ${ciEnv.failOn}`);
  io.log('========================================================\n');

  const cwd = options.cwd || process.cwd();
  const isMock = Boolean(options.mock || env.MOCK_CI === '1');

  // Subagent runner setup
  let runnerFn;
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

  // GitHub CLI wrapper
  const execGhFn = (args, ghOpts = {}) => {
    if (isMock) {
      if (args[0] === 'pr' && args[1] === 'view') {
        return Promise.resolve(
          JSON.stringify({
            headRefOid: 'ci-mock-head-sha',
            author: { login: 'ci-author' },
            state: 'OPEN',
            title: `CI PR #${ciEnv.prNumber}`,
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
  };

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
    });

    const qualityGate = evaluateCiQualityGate(reviewResult.findings, {
      failOn: ciEnv.failOn,
    });

    // Write GitHub Action Step outputs
    writeGitHubStepOutputs(
      {
        verdict: qualityGate.verdict,
        findings_count: String(qualityGate.totalFindings),
        blocking_count: String(qualityGate.blockingCount),
        summary: reviewResult.summary || '',
      },
      { outputFile: env.GITHUB_OUTPUT }
    );

    // Write GITHUB_STEP_SUMMARY if configured
    if (env.GITHUB_STEP_SUMMARY) {
      const ciSummary = formatCiSummary({ reviewResult, qualityGateResult: qualityGate, ciEnv });
      try {
        fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${ciSummary}\n`, 'utf8');
      } catch (summaryErr) {
        io.warn(`Warning: Could not write to GITHUB_STEP_SUMMARY: ${summaryErr.message}`);
      }
    }

    io.log('\n────────────────────────────────────────────────────────');
    io.log(reviewResult.summary);
    io.log('────────────────────────────────────────────────────────\n');

    if (!qualityGate.passed) {
      io.error(
        `❌ Quality gate failed: ${qualityGate.blockingCount} blocking defect(s) detected (Threshold: ${ciEnv.failOn}).`
      );
      return {
        exitCode: 1,
        qualityGate,
        reviewResult,
        ciEnv,
      };
    }

    io.log(`✅ AI Code Review passed quality gate (Threshold: ${ciEnv.failOn}).`);
    return {
      exitCode: 0,
      qualityGate,
      reviewResult,
      ciEnv,
    };
  } catch (err) {
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

