#!/usr/bin/env node
/**
 * scripts/dogfood-pr.mjs — Streamlined Dogfood PR Review Helper
 *
 * Runs multi-lens AI code review on GitHub pull requests using --model auto,
 * verifies diff hunk anchoring, and outputs a formatted table of candidate findings.
 *
 * Usage:
 *   node scripts/dogfood-pr.mjs <PR_NUMBER> [options]
 *   npm run dogfood:pr <PR_NUMBER>
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printVersionBanner } from '../src/version.js';

export function printUsage(output = console.log) {
  output(`
Usage: npm run dogfood:pr <PR_NUMBER> [options]
       node scripts/dogfood-pr.mjs <PR_NUMBER> [options]

Streamlined dogfood reviewer runner with automatic model resolution (--model auto).

Options:
  --quick           Fast triage (correctness, security, conventions)
  --balanced        Default review (5 specialist lenses)
  --full            Exhaustive review (6 lenses including tests)
  --deep            Deep-focus review on correctness
  --incremental     Re-review PR incrementally against previous review
  --dry-run         Run review analysis without publishing to GitHub (default)
  --publish         Publish host-gated review to GitHub
  --interactive     Prompt for interactive finding selection before publishing
  --select <spec>   Filter findings by indices or severities (e.g. "p0,p1")
  --model <model>   Override model name (defaults to "auto")
  --mock            Use synthetic runner for testing without inference
  -v, --version     Display version information
  --help, -h        Display this help message
`);
}

export function buildDogfoodArgs(rawArgs) {
  const args = [...rawArgs];
  const hasModel = args.some((a) => a === '--model' || a.startsWith('--model='));
  if (!hasModel) {
    args.push('--model', 'auto');
  }
  return args;
}

export async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('-v') || rawArgs.includes('--version')) {
    printVersionBanner();
    process.exit(0);
  }

  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const prNumberArg = rawArgs.find((a) => /^\d+$/.test(a));
  if (!prNumberArg && !rawArgs.includes('--self')) {
    printUsage(console.error);
    process.exit(1);
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const reviewScriptPath = path.resolve(currentDir, 'dogfood-review.mjs');
  const forwardedArgs = buildDogfoodArgs(rawArgs);

  const child = spawn(process.execPath, [reviewScriptPath, ...forwardedArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`Failed to launch dogfood-review.mjs: ${err.message}`);
    process.exit(1);
  });
}

// Only execute main when called directly
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
