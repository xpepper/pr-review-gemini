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
import { runReview, resolveReviewMode, LENS_DEFINITIONS } from '../src/reviewer.js';
import { loadConfig } from '../src/config.js';

const execFileAsync = promisify(execFile);

function printUsage(output = console.log) {
  output(`
Usage: node scripts/dogfood-review.mjs <PR_NUMBER> [options]

Options:
  --quick           Fast triage (correctness, security, conventions)
  --balanced        Default review (5 specialist lenses)
  --full            Exhaustive review (6 lenses including tests)
  --deep            Deep-focus review on correctness
  --dry-run         Run review analysis and output summary without publishing to GitHub
  --no-comment      Alias for --dry-run
  --comment         Publish the host-gated review to GitHub
  --publish         Alias for --comment
  --repo <repo>     GitHub repository in owner/repo format (e.g. xpepper/pr-review-gemini)
  --model <model>   Override model name
  --mock            Use synthetic runner for testing without inference
  --help, -h        Display this help message
`);
}

function parseCliArgs(args) {
  let prNumber = null;
  let mode = 'balanced';
  let dryRun = false;
  let publish = false;
  let repo = null;
  let model = null;
  let mock = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--quick' || arg === '--balanced' || arg === '--full' || arg === '--deep') {
      mode = arg.slice(2);
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg === '--mode') {
      mode = args[++i] || 'balanced';
    } else if (arg === '--dry-run' || arg === '--no-comment') {
      dryRun = true;
    } else if (arg === '--comment' || arg === '--publish') {
      publish = true;
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
    } else if (/^\d+$/.test(arg) && !prNumber) {
      prNumber = parseInt(arg, 10);
    }
  }

  return { prNumber, mode, dryRun, publish, repo, model, mock, showHelp };
}

async function createRunner({ model, mock, cwd }) {
  if (mock) {
    return async ({ lens }) => {
      return `<<<PR_REVIEW_JSON>>>
[]
<<<END_PR_REVIEW_JSON>>>`;
    };
  }

  // If COPILOT_SDK_PATH is configured, dynamically load SDK
  if (process.env.COPILOT_SDK_PATH && process.env.COPILOT_CLI_PATH) {
    try {
      const { pathToFileURL } = await import('node:url');
      const sdkModule = await import(
        pathToFileURL(path.resolve(process.env.COPILOT_SDK_PATH, 'index.js')).href
      );
      const { CopilotClient, RuntimeConnection } = sdkModule;
      const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({
          path: path.resolve(process.env.COPILOT_CLI_PATH),
        }),
      });

      return async ({ prompt, tier, reasoningEffort }) => {
        const session = await client.createSession({
          model: model || (tier === 'heavy' ? 'claude-3.7-sonnet' : 'gpt-4o'),
          reasoningEffort,
          workingDirectory: cwd,
        });
        try {
          const response = await session.send(prompt);
          return response?.text || '';
        } finally {
          await session.close();
        }
      };
    } catch {
      // Fallback to CLI
    }
  }

  // Direct Copilot CLI invocation fallback
  return async ({ prompt, tier, reasoningEffort }) => {
    const cliArgs = ['-s', '-p', prompt, '--no-color'];
    if (model) {
      cliArgs.push('--model', model);
    }

    try {
      const { stdout } = await execFileAsync('copilot', cliArgs, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      console.error(`Copilot CLI execution warning: ${err.message}`);
      return '';
    }
  };
}

const MOCK_DIFF = `diff --git a/src/index.js b/src/index.js
index 1111111..2222222 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,4 @@
 function main() {
+  console.log("hello mock");
   return 0;
 }
`;

async function main() {
  const { prNumber, mode, dryRun, publish, repo, model, mock, showHelp } = parseCliArgs(
    process.argv.slice(2)
  );

  if (showHelp) {
    printUsage();
    process.exit(0);
  }

  if (!prNumber) {
    printUsage(console.error);
    process.exit(1);
  }

  const cwd = process.cwd();
  console.log(`\n🔍 Starting Copilot PR Review on PR #${prNumber}...`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Action: ${dryRun ? 'Dry-run (inspect only)' : publish ? 'Publish host-gated review' : 'Dry-run (default)'}`);

  const runnerFn = await createRunner({ model, mock, cwd });

  // Wrapper for gh CLI execution
  const execGhFn = (args, options = {}) => {
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

  const shouldPublish = publish && !dryRun;

  try {
    const result = await runReview({
      prNumber,
      mode,
      repo,
      diffText: mock ? MOCK_DIFF : undefined,
      runnerFn,
      execGhFn,
      cwd,
      dryRun: !shouldPublish,
      publish: shouldPublish,
    });

    console.log('\n────────────────────────────────────────────────────────');
    console.log(result.summary);
    console.log('────────────────────────────────────────────────────────\n');

    if (result.classification) {
      const { inlineComments, demotedFindings } = result.classification;
      console.log(`📍 Inline comments generated: ${inlineComments.length}`);
      console.log(`📋 Demoted findings (summary): ${demotedFindings.length}`);

      if (inlineComments.length > 0) {
        console.log('\nInline Comments:');
        for (const c of inlineComments) {
          console.log(`  - [${c.severity}] ${c.filePath}:${c.line} (${Math.round((c.confidence ?? 1) * 100)}% conf) ${c.title}`);
        }
      }
    }

    if (result.published) {
      console.log(`\n✅ Review successfully posted to GitHub for PR #${prNumber}!`);
    } else {
      console.log('\nDry-run complete: no review published to GitHub.');
    }
  } catch (err) {
    console.error(`\n❌ Review failed: ${err.message}`);
    process.exit(1);
  }
}

// Only execute main when called directly
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/dogfood-review.mjs');
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
