/**
 * src/cli.js — Centralized CLI Entrypoint Infrastructure
 *
 * Consolidates common CLI patterns across sibling scripts:
 * - Direct execution detection (isDirectRun)
 * - Safe top-level runner with error trapping (runIfDirect)
 * - Standardized common flag dispatch (-v/--version, -h/--help) (handleCommonFlags)
 * - Uniform terminal error presentation (formatCliError)
 * - Git pre-commit hook installation and verification
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printVersionBanner, VERSION } from './version.js';

/**
 * Robustly detects whether a script module is being executed directly via CLI
 * (as opposed to being imported by another module or test runner).
 *
 * @param {string} importMetaUrl - Typically `import.meta.url` of the caller
 * @param {string[]} [argv=process.argv] - Command line arguments
 * @returns {boolean}
 */
export function isDirectRun(importMetaUrl, argv = process.argv) {
  if (!argv || !argv[1] || typeof importMetaUrl !== 'string' || !importMetaUrl) {
    return false;
  }

  const targetPath = importMetaUrl.startsWith('file:')
    ? fileURLToPath(importMetaUrl)
    : importMetaUrl;

  const resolvedTarget = path.resolve(targetPath);
  const resolvedArg = path.resolve(argv[1]);

  // Direct exact match
  if (resolvedTarget === resolvedArg) {
    return true;
  }

  // Handle invocation omitting extension (e.g. `node scripts/self-review`)
  const targetExt = path.extname(resolvedTarget);
  if (targetExt && resolvedTarget.slice(0, -targetExt.length) === resolvedArg) {
    return true;
  }

  // Handle symlinks if both paths exist on filesystem
  try {
    if (fs.existsSync(resolvedTarget) && fs.existsSync(resolvedArg)) {
      if (fs.realpathSync(resolvedTarget) === fs.realpathSync(resolvedArg)) {
        return true;
      }
    }
  } catch {
    // Ignore filesystem errors during resolution
  }

  return false;
}

/**
 * Resolves whether debug/verbose mode is enabled from caller options or environment.
 * Explicit options (`debug`, `stack`, `verbose`) take precedence over `env.DEBUG` or `--debug`/`--verbose` flags.
 * Defaults to false to prevent unintentional exposure of internal paths or stack traces.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.debug]
 * @param {boolean} [options.stack]
 * @param {boolean} [options.verbose]
 * @param {object} [options.env]
 * @param {string[]} [options.argv]
 * @returns {boolean}
 */
export function resolveDebugFlag(options = {}) {
  if (options.debug !== undefined) {
    return Boolean(options.debug);
  }
  if (options.stack !== undefined) {
    return Boolean(options.stack);
  }
  if (options.verbose !== undefined) {
    return Boolean(options.verbose);
  }
  if (options.env?.DEBUG) {
    return true;
  }
  const argv = Array.isArray(options.argv) ? options.argv : [];
  if (argv.includes('--debug') || argv.includes('--verbose')) {
    return true;
  }
  return false;
}

/**
 * Formats an error object or string into a clean terminal presentation.
 *
 * @param {Error|string|any} err
 * @param {object} [options={}]
 * @param {string|boolean} [options.prefix='❌ ']
 * @param {boolean} [options.verbose=false]
 * @returns {string}
 */
export function formatCliError(err, options = {}) {
  let prefix = '❌ ';
  if (options.prefix === false || options.prefix === null) {
    prefix = '';
  } else if (typeof options.prefix === 'string') {
    prefix = options.prefix;
  }

  if (err == null || err === '') {
    return `${prefix}Unknown error occurred.`;
  }

  if (typeof err === 'string') {
    if (prefix === '❌ ' && (err.startsWith('❌ ') || err.startsWith('❌'))) {
      return err;
    }
    return `${prefix}${err}`;
  }

  const isDebug = resolveDebugFlag(options);

  if (err instanceof Error) {
    if (isDebug) {
      return `${prefix}${err.stack || err.message}`;
    }
    const msg = err.message || String(err);
    if (prefix === '❌ ' && (msg.startsWith('❌ ') || msg.startsWith('❌'))) {
      return msg;
    }
    return `${prefix}${msg}`;
  }

  return `${prefix}${String(err)}`;
}

/**
 * Handles common top-level CLI flags (-v / --version and -h / --help).
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @param {object} [options={}]
 * @param {Function} [options.printUsage] - Caller's usage output function
 * @param {Function} [options.printVersionBanner] - Version banner function
 * @param {object} [options.io=console] - Logger object
 * @param {Function|boolean} [options.exit=process.exit] - Exit handler (false to suppress exit)
 * @param {string} [options.version=VERSION] - Version string
 * @returns {{ handled: boolean, action?: 'version'|'help', exitCode?: number }}
 */
export function handleCommonFlags(argv = process.argv.slice(2), options = {}) {
  if (!Array.isArray(argv)) {
    return { handled: false };
  }

  const io = options.io || console;
  const exitFn =
    options.exit === false
      ? null
      : typeof options.exit === 'function'
      ? options.exit
      : (code) => process.exit(code);

  if (argv.includes('-v') || argv.includes('--version')) {
    const bannerFn = options.printVersionBanner || printVersionBanner;
    bannerFn(io, options.version);
    if (exitFn) {
      exitFn(0);
      return { handled: true, action: 'version', exitCode: 0 };
    }
    return { handled: true, action: 'version' };
  }

  if (argv.includes('-h') || argv.includes('--help')) {
    if (typeof options.printUsage === 'function') {
      options.printUsage(io.log || console.log);
    }
    if (exitFn) {
      exitFn(0);
      return { handled: true, action: 'help', exitCode: 0 };
    }
    return { handled: true, action: 'help' };
  }

  return { handled: false };
}

export const PRE_COMMIT_HOOK_MARKER = '# gem-pr-review self-review pre-commit hook';

/**
 * Standardized direct execution runner. If invoked directly, executes mainFn,
 * traps unhandled rejections, prints formatted error, and terminates with code 1.
 *
 * @param {string} importMetaUrl - Caller's `import.meta.url`
 * @param {Function} mainFn - Main execution function
 * @param {object} [options={}]
 * @param {string[]} [options.argv=process.argv]
 * @param {object} [options.io=console]
 * @param {Function} [options.exit=process.exit]
 * @param {Function} [options.formatError=formatCliError]
 * @returns {Promise<any>|null}
 */
export function runIfDirect(importMetaUrl, mainFn, options = {}) {
  const argv = options.argv || process.argv;
  if (!isDirectRun(importMetaUrl, argv)) {
    return null;
  }

  const io = options.io || console;
  const exitFn =
    typeof options.exit === 'function'
      ? options.exit
      : (code) => process.exit(code);
  const formatErrorFn = options.formatError || formatCliError;

  const isDebug = resolveDebugFlag({ argv, ...options });

  const printAndExit = (err) => {
    const msg = formatErrorFn(err, { ...options, debug: isDebug });
    (io.error || console.error)(msg);
    const code = typeof err?.exitCode === 'number' ? err.exitCode : 1;
    exitFn(code);
    return { error: err, exitCode: code };
  };

  try {
    const result = mainFn();
    if (result && typeof result.then === 'function') {
      return result.catch(printAndExit);
    }
    return Promise.resolve(result);
  } catch (err) {
    return Promise.resolve(printAndExit(err));
  }
}

/**
 * Resolves the git hooks directory for a standard git repository or linked worktree.
 *
 * @param {string} [rootDir=process.cwd()]
 * @returns {string|null} Absolute path to hooks directory, or null if not a git repository
 */
export function resolveGitHooksDir(rootDir = process.cwd()) {
  const gitPath = path.join(rootDir, '.git');
  if (!fs.existsSync(gitPath)) {
    return null;
  }

  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return path.join(gitPath, 'hooks');
    }

    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (!match) {
        return null;
      }
      let gitDir = match[1].trim();
      if (!path.isAbsolute(gitDir)) {
        gitDir = path.resolve(rootDir, gitDir);
      }

      // In linked worktrees, hooks are shared in the common git directory
      const commonDirFile = path.join(gitDir, 'commondir');
      if (fs.existsSync(commonDirFile)) {
        const relCommon = fs.readFileSync(commonDirFile, 'utf8').trim();
        const commonDir = path.resolve(gitDir, relCommon);
        return path.join(commonDir, 'hooks');
      }

      return path.join(gitDir, 'hooks');
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Checks whether content has an active (non-comment) shell command line executing the target command.
 *
 * @param {string} content - Hook file content
 * @param {string} [command='npm run self-review'] - Command to look for
 * @returns {boolean}
 */
export function hasActiveHookCommand(content, command = 'npm run self-review') {
  if (typeof content !== 'string') {
    return false;
  }
  const lines = content.split(/\r?\n/);
  return lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return false;
    }
    return (
      trimmed === command ||
      trimmed.startsWith(command + ' ') ||
      trimmed.startsWith(command + ';') ||
      trimmed.startsWith(command + '&')
    );
  });
}

/**
 * Checks whether pre-commit hook content contains the gem-pr-review hook or managed command.
 *
 * @param {string} content - Pre-commit hook file content
 * @param {string} [command='npm run self-review'] - Expected command invocation
 * @returns {boolean}
 */
export function containsPreCommitHook(content, command = 'npm run self-review') {
  if (typeof content !== 'string') {
    return false;
  }
  const lines = content.split(/\r?\n/);
  const hasMarker = lines.some((l) => l.trim() === PRE_COMMIT_HOOK_MARKER);
  const hasCmd = hasActiveHookCommand(content, command);
  return hasMarker && hasCmd;
}

/**
 * Checks if git pre-commit hook is installed and contains self-review.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command='npm run self-review']
 * @returns {{ installed: boolean, containsSelfReview: boolean, hookPath: string }}
 */
export function isPreCommitHookInstalled(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir);
  const command = options.command || 'npm run self-review';

  if (!hooksDir) {
    return {
      installed: false,
      containsSelfReview: false,
      hookPath: path.join(rootDir, '.git', 'hooks', 'pre-commit'),
    };
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  if (!fs.existsSync(hookPath)) {
    return { installed: false, containsSelfReview: false, hookPath };
  }

  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    const containsSelfReview = containsPreCommitHook(content, command);
    return { installed: true, containsSelfReview, hookPath };
  } catch {
    return { installed: true, containsSelfReview: false, hookPath };
  }
}

/**
 * Installs or updates git pre-commit hook to execute self-review before commits.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command='npm run self-review']
 * @returns {{ success: boolean, hookPath?: string, created?: boolean, appended?: boolean, alreadyInstalled?: boolean, error?: string }}
 */
export function installPreCommitHook(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir);

  if (!hooksDir) {
    return {
      success: false,
      error: 'No .git repository or worktree found. Ensure you are running inside a git repository.',
    };
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  const command = options.command || 'npm run self-review';

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (containsPreCommitHook(existing, command)) {
        try {
          fs.chmodSync(hookPath, 0o755);
        } catch {
          // Ignore chmod error if not permitted
        }
        return {
          success: true,
          alreadyInstalled: true,
          hookPath,
        };
      }

      // If an existing hook ends with or contains an exit statement,
      // insert before it so self-review is guaranteed to run
      const lines = existing.split(/\r?\n/);
      const exitIdx = lines.findIndex((l) => /^\s*exit\b/.test(l));

      if (exitIdx !== -1) {
        lines.splice(exitIdx, 0, PRE_COMMIT_HOOK_MARKER, command, '');
        fs.writeFileSync(hookPath, lines.join('\n'));
      } else {
        const separator = existing.endsWith('\n') ? '' : '\n';
        const addition = `\n${PRE_COMMIT_HOOK_MARKER}\n${command}\n`;
        fs.writeFileSync(hookPath, existing + separator + addition);
      }
      fs.chmodSync(hookPath, 0o755);
      return {
        success: true,
        appended: true,
        hookPath,
      };
    }

    const content = `#!/bin/sh\n${PRE_COMMIT_HOOK_MARKER}\n${command}\n`;
    fs.writeFileSync(hookPath, content, { mode: 0o755 });
    return {
      success: true,
      created: true,
      hookPath,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      hookPath,
    };
  }
}

/**
 * Uninstalls self-review from git pre-commit hook.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command='npm run self-review']
 * @returns {{ success: boolean, removed?: boolean, cleaned?: boolean, hookPath?: string, error?: string }}
 */
export function uninstallPreCommitHook(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir);

  if (!hooksDir) {
    return { success: true, removed: false };
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  const command = options.command || 'npm run self-review';

  if (!fs.existsSync(hookPath)) {
    return { success: true, removed: false, hookPath };
  }

  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    // Only uninstall if it contains our managed marker
    if (!content.includes(PRE_COMMIT_HOOK_MARKER)) {
      return { success: true, removed: false, hookPath };
    }

    const lines = content.split(/\r?\n/);
    // Check if the file only contains comments/shebang and our exact command
    const nonCommentLines = lines
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !l.startsWith('#'));

    if (
      nonCommentLines.length <= 1 &&
      nonCommentLines.every((l) => l === command)
    ) {
      fs.unlinkSync(hookPath);
      return { success: true, removed: true, hookPath };
    }

    // If file contains other commands, strip only marker and managed command line
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === PRE_COMMIT_HOOK_MARKER) {
        if (i + 1 < lines.length && lines[i + 1].trim() === command) {
          i++; // Skip the managed command line as well
        }
        continue;
      }
      cleaned.push(lines[i]);
    }

    fs.writeFileSync(hookPath, cleaned.join('\n'));
    fs.chmodSync(hookPath, 0o755);
    return { success: true, cleaned: true, hookPath };
  } catch (err) {
    return { success: false, error: err.message, hookPath };
  }
}
