#!/usr/bin/env node
/**
 * scripts/dogfood-review.mjs — Dogfood AI Code Reviewer Runner
 *
 * Runs multi-lens AI code review on GitHub pull requests using Copilot CLI
 * or Copilot SDK and publishes host-gated reviews.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  runReview,
  resolveReviewMode,
  LENS_DEFINITIONS,
  publishCachedReview,
  getReviewCache,
  formatFindingsTable,
  promptFindingSelection,
  parseSelectionInput,
  filterFindings,
  runSelfReview,
} from '../src/reviewer.js';
import { createSubagentRunner } from '../src/subagents.js';
import { handleCommonFlags, runIfDirect } from '../src/cli.js';

const execFileAsync = promisify(execFile);

export function printUsage(output = console.log) {
  output(`
Usage: node scripts/dogfood-review.mjs <PR_NUMBER> [options]

Options:
  --self            Run one-shot self-review on local worktree changes instead of remote PR
  --quick           Fast triage (correctness, security, conventions)
  --balanced        Default review (5 specialist lenses)
  --full            Exhaustive review (6 lenses including tests)
  --deep            Deep-focus review on correctness
  --incremental     Re-review PR incrementally against previous review (revalidates prior findings)
  --dry-run         Run review analysis and output summary without publishing to GitHub
  --no-comment      Alias for --dry-run
  --comment         Publish the host-gated review to GitHub
  --publish         Alias for --comment
  --publish-cached  Publish previously cached review findings without rerunning inference
  --all             Publish all findings without interactive triage prompt
  --interactive     Prompt for interactive finding selection before publishing
  --select <spec>   Filter findings by indices, ranges, or severities (e.g. "1,3", "p0,p1")
  --role <id>       Run specific review role(s) (can be repeated or comma-separated)
  --replace-standard-roles Run only custom/specified roles and skip standard lenses
  --cache-dir <dir> Custom directory for session cache (defaults to .gem-pr-cache)
  --repo <repo>     GitHub repository in owner/repo format (e.g. xpepper/pr-review-gemini)
  --model <model>   Override model name
  --mock            Use synthetic runner for testing without inference
  -v, --version     Display version information
  --help, -h        Display this help message
`);
}

export function parseCliArgs(args) {
  let prNumber = null;
  let mode = 'balanced';
  let dryRun = false;
  let publish = false;
  let publishCached = false;
  let all = false;
  let interactive = false;
  let select = null;
  let cacheDir = null;
  let repo = null;
  let model = null;
  let mock = false;
  let mockGh = process.env.MOCK_GH === '1';
  let self = false;
  let incremental = false;
  let showHelp = false;
  let showVersion = false;
  const roles = [];
  let replaceStandardRoles = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else if (arg === '--self') {
      self = true;
    } else if (arg === '--quick' || arg === '--balanced' || arg === '--full' || arg === '--deep') {
      mode = arg.slice(2);
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg === '--mode') {
      mode = args[++i] || 'balanced';
    } else if (arg === '--incremental') {
      incremental = true;
    } else if (arg === '--dry-run' || arg === '--no-comment') {
      dryRun = true;
    } else if (arg === '--comment' || arg === '--publish') {
      publish = true;
    } else if (arg === '--publish-cached') {
      publishCached = true;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--interactive') {
      interactive = true;
    } else if (arg.startsWith('--select=')) {
      select = arg.slice('--select='.length);
    } else if (arg === '--select') {
      select = args[++i] || null;
    } else if (arg.startsWith('--role=')) {
      const val = arg.slice('--role='.length);
      roles.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--role') {
      const val = args[++i] || '';
      roles.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--replace-standard-roles') {
      replaceStandardRoles = true;
    } else if (arg.startsWith('--cache-dir=')) {
      cacheDir = arg.slice('--cache-dir='.length);
    } else if (arg === '--cache-dir') {
      cacheDir = args[++i] || null;
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length);
    } else if (arg === '--repo') {
      repo = args[++i] || null;
    } else if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length);
    } else if (arg === '--model') {
      model = args[++i] || null;
    } else if (arg === '--mock') {
      mock = true;
    } else if (arg === '--mock-gh') {
      mockGh = true;
    } else if (/^\d+$/.test(arg) && !prNumber) {
      prNumber = parseInt(arg, 10);
    }
  }

  return {
    prNumber,
    self,
    mode,
    dryRun,
    publish,
    publishCached,
    all,
    interactive,
    select,
    cacheDir,
    repo,
    model,
    mock,
    mockGh,
    incremental,
    showHelp,
    showVersion,
    roles: roles.length > 0 ? roles : undefined,
    replaceStandardRoles,
  };
}

const MOCK_DIFF = `diff --git a/src/index.js b/src/index.js
index 1111111..2222222 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,4 @@
 function calculate() {
+  console.log("debug");
   return 42;
 }
`;

export async function main() {
  const rawArgs = process.argv.slice(2);
  handleCommonFlags(rawArgs, { printUsage });

  const {
    prNumber,
    self,
    mode,
    dryRun,
    publish,
    publishCached,
    all,
    interactive,
    select,
    cacheDir,
    repo,
    model,
    mock,
    mockGh,
    incremental,
    roles,
    replaceStandardRoles,
  } = parseCliArgs(rawArgs);

  if (self) {
    const cwd = process.cwd();
    const runnerFn = mock
      ? async () => '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>'
      : await createSubagentRunner({ cwd });

    try {
      const result = await runSelfReview({
        cwd,
        mode,
        runnerFn,
        roles,
        replaceStandardRoles,
      });

      console.log(result.summary);
      process.exit(result.status === 'failed' ? 1 : 0);
    } catch (err) {
      console.error(`Self-review failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (!prNumber) {
    printUsage(console.error);
    process.exit(1);
  }

  const cwd = process.cwd();

  // Track cached head for mock matching
  let mockHeadSha = null;

  // Wrapper for gh CLI execution
  const execGhFn = (args, options = {}) => {
    if (mockGh) {
      if (args[0] === 'pr' && args[1] === 'view') {
        return Promise.resolve(
          JSON.stringify({
            headRefOid: mockHeadSha || 'mock-head-sha',
            author: { login: 'mock-author' },
            state: 'OPEN',
            title: `Mock PR #${prNumber}`,
          })
        );
      }
      if (args[0] === 'api' && args[1] === 'user') {
        return Promise.resolve(JSON.stringify({ login: 'copilot-reviewer' }));
      }
      if (args[0] === 'api' && args.includes('POST')) {
        return Promise.resolve(JSON.stringify({ id: 9999, state: 'COMMENTED' }));
      }
      return Promise.resolve('[]');
    }

    return new Promise((resolve, reject) => {
      const child = execFile('gh', args, { cwd: options.cwd || cwd }, (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr && stderr.trim()) || err.message;
          reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
          return;
        }
        resolve(stdout);
      });
      if (options.input && child?.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  };

  // 1. Workflow: Publish-Cached (no subagent model inference pass)
  if (publishCached) {
    console.log(`\n📦 Publishing cached review for PR #${prNumber}...`);

    try {
      const cached = await getReviewCache({ prNumber, repo }, { cacheDir });
      if (!cached) {
        throw new Error(
          `No cached review found for PR #${prNumber}. Run an analysis review first.`
        );
      }

      mockHeadSha = cached.headSha;

      console.log(`✓ Retrieved ${cached.findings.length} cached findings (Mode: ${cached.mode}, Commit: ${cached.headSha.slice(0, 7)}).`);

      let selectedIndices = null;

      if (select) {
        selectedIndices = parseSelectionInput(select, cached.findings.length, cached.findings);
      } else if (interactive || (process.stdin.isTTY && !all)) {
        const selectionResult = await promptFindingSelection({
          findings: cached.findings,
          isInteractive: true,
        });
        if (selectionResult.cancelled) {
          console.log('\nPublish cancelled.');
          process.exit(0);
        }
        selectedIndices = selectionResult.selectedIndices;
      }

      const pubResult = await publishCachedReview({
        prNumber,
        repo,
        headSha: cached.headSha,
        selectedIndices,
        diffText: mock ? MOCK_DIFF : undefined,
        execGhFn,
        cwd,
        cacheDir,
      });

      console.log('\n────────────────────────────────────────────────────────');
      console.log(pubResult.reviewBody || cached.summary);
      console.log('────────────────────────────────────────────────────────\n');

      if (pubResult.classification) {
        const { inlineComments, demotedFindings } = pubResult.classification;
        console.log(`📍 Inline comments generated: ${inlineComments.length}`);
        console.log(`📋 Demoted findings (summary): ${demotedFindings.length}`);

        if (inlineComments.length > 0) {
          console.log('\nInline Comments:');
          for (const c of inlineComments) {
            console.log(`  - [${c.severity}] ${c.filePath}:${c.line} (${Math.round((c.confidence ?? 1) * 100)}% conf) ${c.title}`);
          }
        }
      }

      console.log(`\n✅ Cached review successfully posted to GitHub for PR #${prNumber}! (${pubResult.publishedCount} findings published)`);
      return;
    } catch (err) {
      console.error(`\n❌ Review failed: ${err.message}`);
      process.exit(1);
    }
  }

  // 2. Standard Review Analysis Workflow
  console.log(`\n🔍 Starting Gem PR Review on PR #${prNumber}...`);
  console.log(`   Mode: ${mode}${incremental ? ' [incremental]' : ''}`);
  console.log(`   Action: ${dryRun ? 'Dry-run (inspect only)' : publish ? 'Publish host-gated review' : 'Dry-run (default)'}`);

  const runnerFn = await createSubagentRunner({ modelOverride: model, mock, cwd });
  const shouldPublish = publish && !dryRun;
  const isInteractiveTriage = shouldPublish && (interactive || (process.stdin.isTTY && !all));

  try {
    // If interactive triage is needed before publishing, run review in dry-run first to capture findings
    const reviewResult = await runReview({
      prNumber,
      mode,
      repo,
      diffText: mock ? MOCK_DIFF : undefined,
      runnerFn,
      execGhFn,
      cwd,
      dryRun: isInteractiveTriage ? true : !shouldPublish,
      publish: isInteractiveTriage ? false : shouldPublish,
      incremental,
      cacheDir,
      roles,
      replaceStandardRoles,
    });

    console.log('\n────────────────────────────────────────────────────────');
    console.log(reviewResult.summary);
    console.log('────────────────────────────────────────────────────────\n');

    if (reviewResult.classification) {
      const { inlineComments, demotedFindings } = reviewResult.classification;
      console.log(`📍 Inline comments generated: ${inlineComments.length}`);
      console.log(`📋 Demoted findings (summary): ${demotedFindings.length}`);

      if (inlineComments.length > 0) {
        console.log('\nInline Comments:');
        for (const c of inlineComments) {
          console.log(`  - [${c.severity}] ${c.filePath}:${c.line} (${Math.round((c.confidence ?? 1) * 100)}% conf) ${c.title}`);
        }
      }
    }

    // Handle interactive selection prompt if requested
    if (isInteractiveTriage && reviewResult.findings.length > 0) {
      const selectionResult = await promptFindingSelection({
        findings: reviewResult.findings,
        isInteractive: true,
      });

      if (selectionResult.cancelled) {
        console.log('\nPublish cancelled: no review posted to GitHub.');
        return;
      }

      console.log(`\nSubmitting host-gated review with ${selectionResult.selectedFindings.length} selected findings...`);

      const pubResult = await publishCachedReview({
        prNumber,
        repo,
        headSha: reviewResult.headSha,
        selectedIndices: selectionResult.selectedIndices,
        diffText: mock ? MOCK_DIFF : undefined,
        execGhFn: mock ? undefined : execGhFn,
        cwd,
        cacheDir,
      });

      console.log(`\n✅ Review successfully posted to GitHub for PR #${prNumber}! (${pubResult.publishedCount} findings published)`);
      return;
    }

    if (reviewResult.published) {
      console.log(`\n✅ Review successfully posted to GitHub for PR #${prNumber}!`);
    } else {
      console.log('\nDry-run complete: no review published to GitHub.');
      if (reviewResult.cached) {
        console.log(`💡 Findings retained in session cache. To publish later without rerunning inference:`);
        console.log(`   node scripts/dogfood-review.mjs ${prNumber} --publish-cached`);
      }
    }
  } catch (err) {
    console.error(`\n❌ Review failed: ${err.message}`);
    process.exit(1);
  }
}

runIfDirect(import.meta.url, main);

