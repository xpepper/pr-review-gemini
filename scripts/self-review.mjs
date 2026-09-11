#!/usr/bin/env node
/**
 * scripts/self-review.mjs — One-Shot Coding-Task Self-Review CLI Runner
 *
 * Evaluates uncommitted git worktree changes through specialist review lenses
 * and enforces a fail-closed safety gate before finishing tasks or committing.
 */
import path from 'node:path';
import { runSelfReview } from '../src/self-review.js';
import { createSubagentRunner } from '../src/subagents.js';
import { handleCommonFlags, runIfDirect, readOptionValue } from '../src/cli.js';
import {
  installPreCommitHook,
  uninstallPreCommitHook,
} from '../src/pre-commit-hook.js';

export function printUsage(output = console.log) {
  output(`
Usage: node scripts/self-review.mjs [options]

Options:
  --quick             Fast triage (correctness, security, conventions)
  --balanced          Default review (5 specialist lenses)
  --full              Exhaustive review (6 lenses including tests)
  --deep              Deep-focus review on correctness
  --mode <mode>       Review mode name (quick, balanced, full, deep)
  --all               Review all uncommitted changes (staged + unstaged + untracked) [default]
  --staged            Review only staged changes (git diff --cached)
  --unstaged          Review only unstaged changes (git diff)
  --head              Review all changes against HEAD (git diff HEAD)
  --no-untracked      Exclude untracked files from the review
  --fail-on <level>   Severity threshold that triggers exit 1 (P0, P1, P2, P3) [default: P1]
  --role <id>         Run specific review role(s) (can be repeated or comma-separated)
  --replace-standard-roles Run only custom/specified roles and skip standard lenses
  --install-hook      Install git pre-commit hook to run self-review before commits
  --uninstall-hook    Remove self-review git pre-commit hook
  --command <cmd>     Custom command for pre-commit hook [default: 'npm run self-review']
  --json              Output machine-readable JSON result
  --mock              Use synthetic runner for testing without LLM inference
  -v, --version       Display version information
  --help, -h          Display this help message
`);
}

export function parseCliArgs(args) {
  let mode = 'balanced';
  let scope = 'all';
  let includeUntracked = true;
  let failOn = 'P1';
  let json = false;
  let mock = false;
  let showHelp = false;
  let showVersion = false;
  let installHook = false;
  let uninstallHook = false;
  let command;
  const roles = [];
  let replaceStandardRoles = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else if (arg === '--install-hook') {
      installHook = true;
    } else if (arg === '--uninstall-hook') {
      uninstallHook = true;
    } else if (arg.startsWith('--command=')) {
      const val = arg.slice('--command='.length).trim();
      if (!val) {
        throw new Error('Option --command requires a non-empty command string');
      }
      command = val;
    } else if (arg === '--command') {
      const { value, nextIndex } = readOptionValue(args, i, '--command');
      command = value.trim();
      i = nextIndex;
    } else if (arg === '--quick' || arg === '--balanced' || arg === '--full' || arg === '--deep') {
      mode = arg.slice(2);
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg === '--mode') {
      const { value, nextIndex } = readOptionValue(args, i, '--mode');
      mode = value;
      i = nextIndex;
    } else if (arg === '--staged') {
      scope = 'staged';
    } else if (arg === '--unstaged') {
      scope = 'unstaged';
    } else if (arg === '--all') {
      scope = 'all';
    } else if (arg === '--head') {
      scope = 'head';
    } else if (arg === '--no-untracked') {
      includeUntracked = false;
    } else if (arg.startsWith('--fail-on=')) {
      failOn = arg.slice('--fail-on='.length);
    } else if (arg === '--fail-on') {
      const { value, nextIndex } = readOptionValue(args, i, '--fail-on');
      failOn = value;
      i = nextIndex;
    } else if (arg.startsWith('--role=')) {
      const val = arg.slice('--role='.length);
      roles.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--role') {
      const { value, nextIndex } = readOptionValue(args, i, '--role');
      roles.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
      i = nextIndex;
    } else if (arg === '--replace-standard-roles') {
      replaceStandardRoles = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--mock') {
      mock = true;
    }
  }

  return {
    mode,
    scope,
    includeUntracked,
    failOn,
    json,
    mock,
    showHelp,
    showVersion,
    installHook,
    uninstallHook,
    command,
    roles: roles.length > 0 ? roles : undefined,
    replaceStandardRoles,
  };
}

export async function main() {
  const rawArgs = process.argv.slice(2);
  handleCommonFlags(rawArgs, { printUsage });

  const parsed = parseCliArgs(rawArgs);

  if (parsed.installHook) {
    const res = installPreCommitHook({
      rootDir: process.cwd(),
      command: parsed.command,
    });
    if (!res.success) {
      throw new Error(`Failed to install pre-commit hook: ${res.error}`);
    }
    const displayPath = res.hookPath
      ? path.relative(process.cwd(), res.hookPath) || res.hookPath
      : '.git/hooks/pre-commit';
    if (res.alreadyInstalled) {
      console.log(`ℹ️ Pre-commit hook is already installed in ${displayPath}.`);
    } else {
      console.log(`✅ Successfully installed pre-commit hook to ${displayPath}.`);
    }
    return;
  }

  if (parsed.uninstallHook) {
    const res = uninstallPreCommitHook({
      rootDir: process.cwd(),
      command: parsed.command,
    });
    if (!res.success) {
      throw new Error(`Failed to uninstall pre-commit hook: ${res.error}`);
    }
    if (res.removed || res.cleaned) {
      console.log('✅ Successfully removed self-review pre-commit hook.');
    } else {
      console.log('ℹ️ Pre-commit hook was not installed.');
    }
    return;
  }

  const cwd = process.cwd();
  const runnerFn = parsed.mock
    ? async () => '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>'
    : await createSubagentRunner({ cwd });

  try {
    const result = await runSelfReview({
      cwd,
      scope: parsed.scope,
      mode: parsed.mode,
      includeUntracked: parsed.includeUntracked,
      failOn: parsed.failOn,
      runnerFn,
      roles: parsed.roles,
      replaceStandardRoles: parsed.replaceStandardRoles,
    });

    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.summary);
    }

    if (result.status === 'failed') {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error(`Self-review execution error: ${err.message}`);
    process.exit(1);
  }
}

runIfDirect(import.meta.url, main);
