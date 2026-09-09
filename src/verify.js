/**
 * src/verify.js — Detached Worktree Test Verification
 *
 * Implements isolated test and build verification against exact PR head commits
 * in a temporary detached git worktree, with process group timeout supervision
 * and environment scrubbing.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_VERIFICATION_PROFILES = {
  test: {
    name: 'test',
    command: 'npm test',
    description: 'Run standard test suite',
    timeoutMs: 60000,
  },
  build: {
    name: 'build',
    command: 'npm run build',
    description: 'Run build compilation',
    timeoutMs: 60000,
  },
  lint: {
    name: 'lint',
    command: 'npm run lint',
    description: 'Run linter checks',
    timeoutMs: 30000,
  },
};

const SAFE_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'NODE_ENV',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'CI',
]);

/**
 * Lists available verification profiles merging defaults with user configuration.
 *
 * @param {Object} [config]
 * @returns {Record<string, Object>}
 */
export function listVerificationProfiles(config = {}) {
  const custom = config?.verificationProfiles || {};
  return {
    ...DEFAULT_VERIFICATION_PROFILES,
    ...custom,
  };
}

/**
 * Resolves a verification profile by name.
 *
 * @param {string} profileName
 * @param {Object} [config]
 * @returns {Object}
 */
export function resolveVerificationProfile(profileName = 'test', config = {}) {
  const profiles = listVerificationProfiles(config);
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown verification profile: "${profileName}". Configured: ${Object.keys(profiles).join(', ')}`);
  }
  return {
    name: profileName,
    command: profile.command,
    description: profile.description || '',
    timeoutMs: profile.timeoutMs ?? 60000,
  };
}

/**
 * Default git runner via execFile.
 */
async function defaultExecGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, options, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && stderr.trim()) || err.message;
        reject(new Error(`git ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Default gh runner via execFile.
 */
async function defaultExecGh(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, options, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && stderr.trim()) || err.message;
        reject(new Error(`gh ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Creates a detached worktree at the specified commit SHA.
 *
 * @param {Object} options
 * @param {string} options.repoPath
 * @param {string} options.headSha
 * @param {string} [options.worktreeDir]
 * @param {Function} [options.execGitFn]
 * @returns {Promise<string>} Worktree directory path
 */
export async function createDetachedWorktree({
  repoPath = process.cwd(),
  headSha,
  worktreeDir,
  execGitFn = defaultExecGit,
}) {
  if (!headSha) {
    throw new Error('headSha is required to create a detached worktree');
  }

  const targetDir = worktreeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pr-verify-'));
  await execGitFn(['worktree', 'add', '--detach', targetDir, headSha], { cwd: repoPath });
  return targetDir;
}

/**
 * Cleans up a temporary worktree and prunes git worktree metadata.
 *
 * @param {Object} options
 * @param {string} options.repoPath
 * @param {string} options.worktreeDir
 * @param {Function} [options.execGitFn]
 */
export async function cleanupWorktree({
  repoPath = process.cwd(),
  worktreeDir,
  execGitFn = defaultExecGit,
}) {
  if (!worktreeDir) return;

  try {
    await execGitFn(['worktree', 'remove', '--force', worktreeDir], { cwd: repoPath });
  } catch {
    // Ignore cleanup error if already removed
  }

  try {
    await execGitFn(['worktree', 'prune'], { cwd: repoPath });
  } catch {
    // Ignore prune error
  }

  try {
    if (fs.existsSync(worktreeDir)) {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore rm error
  }
}

/**
 * Scrubs sensitive environment variables to prevent secret leakage into test environments.
 *
 * @param {Record<string, string>} [sourceEnv]
 * @returns {Record<string, string>}
 */
export function scrubEnvironment(sourceEnv = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (SAFE_ENV_VARS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Executes a command with process supervision, timeout handling, and environment scrubbing.
 *
 * @param {Object} options
 * @param {string} options.command
 * @param {string[]} [options.args]
 * @param {string} options.cwd
 * @param {number} [options.timeoutMs]
 * @param {Record<string, string>} [options.env]
 * @param {Function} [options.spawnFn]
 * @returns {Promise<Object>}
 */
export async function executeSupervisedCommand({
  command,
  args = [],
  cwd,
  timeoutMs = 60000,
  env,
  spawnFn = spawn,
}) {
  const startTime = Date.now();
  const cleanEnv = scrubEnvironment(env || process.env);

  let cmd = command;
  let finalArgs = args;

  // Split command if passed as a single string without args
  if ((!args || args.length === 0) && command.includes(' ')) {
    const parts = command.trim().split(/\s+/);
    cmd = parts[0];
    finalArgs = parts.slice(1);
  }

  return new Promise((resolve) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let resolved = false;
    let timer = null;
    let killTimer = null;
    let forceTimer = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve(result);
    };

    const child = spawnFn(cmd, finalArgs, {
      cwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
          forceTimer = setTimeout(() => {
            finish({
              status: 'timeout',
              exitCode: 124,
              stdout: stdoutBuffer,
              stderr: stderrBuffer,
              timedOut: true,
              durationMs: Date.now() - startTime,
            });
          }, 200);
        }, 500);
      }, timeoutMs);
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });
    }

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const status = timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed';

      finish({
        status,
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        timedOut,
        durationMs,
      });
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;

      finish({
        status: 'failed',
        exitCode: 1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer ? `${stderrBuffer}\n${err.message}` : err.message,
        timedOut: false,
        durationMs,
      });
    });
  });
}

/**
 * Runs end-to-end verification against a PR head commit in an isolated detached worktree.
 *
 * @param {Object} options
 * @param {number} options.prNumber
 * @param {string} [options.headSha]
 * @param {string} [options.profileName]
 * @param {Object} [options.config]
 * @param {string} [options.repoPath]
 * @param {Function} [options.execGitFn]
 * @param {Function} [options.execGhFn]
 * @param {Function} [options.spawnFn]
 * @returns {Promise<Object>}
 */
export async function runVerification({
  prNumber,
  headSha,
  profileName = 'test',
  config = {},
  repoPath = process.cwd(),
  execGitFn = defaultExecGit,
  execGhFn = defaultExecGh,
  spawnFn = spawn,
}) {
  const profile = resolveVerificationProfile(profileName, config);

  let targetHeadSha = headSha;
  if (!targetHeadSha && prNumber) {
    const stdout = await execGhFn(['pr', 'view', String(prNumber), '--json', 'headRefOid'], { cwd: repoPath });
    const parsed = JSON.parse(stdout);
    targetHeadSha = parsed.headRefOid;
  }

  if (!targetHeadSha) {
    throw new Error(`Unable to determine head commit SHA for PR #${prNumber}`);
  }

  const worktreeDir = await createDetachedWorktree({
    repoPath,
    headSha: targetHeadSha,
    execGitFn,
  });

  try {
    const result = await executeSupervisedCommand({
      command: profile.command,
      cwd: worktreeDir,
      timeoutMs: profile.timeoutMs,
      spawnFn,
    });

    return {
      ...result,
      headSha: targetHeadSha,
      profile: profile.name,
      command: profile.command,
    };
  } finally {
    await cleanupWorktree({
      repoPath,
      worktreeDir,
      execGitFn,
    });
  }
}

/**
 * Formats verification outcome into a markdown report.
 *
 * @param {Object} result
 * @returns {string}
 */
export function formatVerificationSummary(result) {
  if (!result) return '';

  const { status, exitCode, durationMs, headSha, profile, command, stdout, stderr } = result;
  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : '0.0';
  const shortSha = headSha ? headSha.slice(0, 7) : 'unknown';

  let statusBadge = '❓ **Unknown**';
  if (status === 'passed') {
    statusBadge = '✅ **Passed**';
  } else if (status === 'failed') {
    statusBadge = `❌ **Failed** (exit code: ${exitCode})`;
  } else if (status === 'timeout') {
    statusBadge = '⏱️ **Timed Out**';
  }

  let text = `### Detached Worktree Verification (\`${command || profile}\`)\n\n`;
  text += `- **Profile**: \`${profile || 'custom'}\` (\`${command}\`)\n`;
  text += `- **Status**: ${statusBadge}\n`;
  text += `- **Duration**: ${durationSec}s\n`;
  text += `- **Commit**: \`${shortSha}\` (detached worktree)\n`;

  if (status === 'failed' || status === 'timeout') {
    const errorOutput = (stderr && stderr.trim()) || (stdout && stdout.trim()) || 'No output recorded.';
    const lines = errorOutput.split('\n');
    const snippet = lines.slice(-25).join('\n');
    text += `\n**Failure Details:**\n\`\`\`\n${snippet}\n\`\`\`\n`;
  }

  return text;
}
