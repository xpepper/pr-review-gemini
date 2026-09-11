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
import { printVersionBanner, formatVersionBanner, VERSION, PLUGIN_NAME } from './version.js';

export { printVersionBanner, formatVersionBanner, VERSION, PLUGIN_NAME };

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
  if (
    resolvedArg + '.mjs' === resolvedTarget ||
    resolvedArg + '.js' === resolvedTarget
  ) {
    return true;
  }

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

  const env = options.env || process.env;
  const isDebug =
    options.debug !== undefined
      ? Boolean(options.debug)
      : Boolean(options.verbose || options.stack || env?.DEBUG);

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
    }
    return { handled: true, action: 'version', exitCode: 0 };
  }

  if (argv.includes('-h') || argv.includes('--help')) {
    if (typeof options.printUsage === 'function') {
      options.printUsage(io.log || console.log);
    }
    if (exitFn) {
      exitFn(0);
    }
    return { handled: true, action: 'help', exitCode: 0 };
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

  const isDebug =
    options.debug !== undefined
      ? Boolean(options.debug)
      : Boolean(
          options.verbose ||
            options.stack ||
            process.env.DEBUG ||
            process.env.CI ||
            argv.includes('--debug') ||
            argv.includes('--verbose')
        );

  const printAndExit = (err) => {
    const msg = formatErrorFn(err, { debug: isDebug, ...options });
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
 * Checks if git pre-commit hook is installed and contains self-review.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command='npm run self-review']
 * @returns {{ installed: boolean, containsSelfReview: boolean, hookPath: string }}
 */
export function isPreCommitHookInstalled(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hookPath = path.join(rootDir, '.git', 'hooks', 'pre-commit');
  const command = options.command || 'npm run self-review';

  if (!fs.existsSync(hookPath)) {
    return { installed: false, containsSelfReview: false, hookPath };
  }

  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    const containsSelfReview =
      content.includes(PRE_COMMIT_HOOK_MARKER) || content.includes(command);
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
  const gitDir = path.join(rootDir, '.git');

  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
    return {
      success: false,
      error: 'No .git directory found. Ensure you are running inside a git repository.',
    };
  }

  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');
  const command = options.command || 'npm run self-review';

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (existing.includes(PRE_COMMIT_HOOK_MARKER) || existing.includes(command)) {
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

      const separator = existing.endsWith('\n') ? '' : '\n';
      const addition = `\n${PRE_COMMIT_HOOK_MARKER}\n${command}\n`;
      fs.writeFileSync(hookPath, existing + separator + addition);
      fs.chmodSync(hookPath, 0o755);
      return {
        success: true,
        appended: true,
        hookPath,
      };
    }

    const content = `#!/bin/sh\n${PRE_COMMIT_HOOK_MARKER}\n${command}\n`;
    fs.writeFileSync(hookPath, content, { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);
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
  const hookPath = path.join(rootDir, '.git', 'hooks', 'pre-commit');
  const command = options.command || 'npm run self-review';

  if (!fs.existsSync(hookPath)) {
    return { success: true, removed: false, hookPath };
  }

  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (!content.includes(PRE_COMMIT_HOOK_MARKER) && !content.includes(command)) {
      return { success: true, removed: false, hookPath };
    }

    // If file only contains our auto-generated hook or comment lines, delete file
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const nonCommentLines = lines.filter((l) => !l.startsWith('#'));

    if (
      nonCommentLines.length <= 1 &&
      nonCommentLines.every((l) => l.includes(command) || l.includes('self-review'))
    ) {
      fs.unlinkSync(hookPath);
      return { success: true, removed: true, hookPath };
    }

    // If file contains other commands, strip marker and managed command lines
    const cleaned = content
      .split(/\r?\n/)
      .filter((l) => {
        const trimmed = l.trim();
        return trimmed !== PRE_COMMIT_HOOK_MARKER && trimmed !== command;
      })
      .join('\n');

    fs.writeFileSync(hookPath, cleaned);
    fs.chmodSync(hookPath, 0o755);
    return { success: true, cleaned: true, hookPath };
  } catch (err) {
    return { success: false, error: err.message, hookPath };
  }
}
