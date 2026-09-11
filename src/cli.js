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
import { printVersionBanner } from './version.js';

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
    if (fs.realpathSync(resolvedTarget) === fs.realpathSync(resolvedArg)) {
      return true;
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
  const env = options.env !== undefined ? options.env : process.env;
  if (
    env?.GEM_PR_REVIEW_DEBUG === '1' ||
    env?.GEM_PR_REVIEW_DEBUG === 'true' ||
    env?.DEBUG === '1' ||
    env?.DEBUG === 'true'
  ) {
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
    if (prefix === '❌ ' && err.startsWith('❌')) {
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
    if (prefix === '❌ ' && msg.startsWith('❌')) {
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
      const printFn = typeof io.log === 'function' ? io.log.bind(io) : console.log;
      options.printUsage(printFn);
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
export const PRE_COMMIT_HOOK_MANAGED_FILE_MARKER = '# gem-pr-review managed-file (auto-created)';

/**
 * Searches upward from startDir for the nearest directory containing a .git directory or file.
 *
 * @param {string} [startDir=process.cwd()]
 * @returns {string|null} Directory containing .git, or null if filesystem root reached without match
 */
export function findGitRootDir(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const gitCandidate = path.join(current, '.git');
    try {
      if (fs.existsSync(gitCandidate)) {
        return current;
      }
    } catch {
      // Ignore filesystem read errors
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

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
    const code =
      typeof err?.exitCode === 'number' && err.exitCode > 0
        ? err.exitCode
        : 1;
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
 * Searches upward from rootDir if rootDir is a subdirectory within a git repository.
 *
 * @param {string} [rootDir=process.cwd()]
 * @returns {string|null} Absolute path to hooks directory, or null if not a git repository
 */
export function resolveGitHooksDir(rootDir = process.cwd()) {
  const resolvedRoot = findGitRootDir(rootDir);
  if (!resolvedRoot) {
    return null;
  }

  const gitPath = path.join(resolvedRoot, '.git');
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
        gitDir = path.resolve(resolvedRoot, gitDir);
      }

      // Validate resolved git directory exists and is a directory
      if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
        return null;
      }

      // In linked worktrees, hooks are shared in the common git directory
      const commonDirFile = path.join(gitDir, 'commondir');
      if (fs.existsSync(commonDirFile)) {
        const relCommon = fs.readFileSync(commonDirFile, 'utf8').trim();
        const commonDir = path.resolve(gitDir, relCommon);
        if (fs.existsSync(commonDir) && fs.statSync(commonDir).isDirectory()) {
          return path.join(commonDir, 'hooks');
        }
      }

      return path.join(gitDir, 'hooks');
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Checks whether an array of lines contains an active (non-comment) execution of the command.
 *
 * @param {string[]} lines
 * @param {string} [command='npm run self-review']
 * @returns {boolean}
 */
export function hasActiveHookCommandInLines(lines, command = 'npm run self-review') {
  if (!Array.isArray(lines)) {
    return false;
  }
  return lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return false;
    }
    return (
      trimmed === command ||
      trimmed.startsWith(command + ' ') ||
      trimmed.startsWith(command + ';') ||
      trimmed.startsWith(command + '&') ||
      trimmed.startsWith(command + '|')
    );
  });
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
  return hasActiveHookCommandInLines(content.split(/\r?\n/), command);
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
  const hasCmd = hasActiveHookCommandInLines(lines, command);
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
      if (containsPreCommitHook(existing, command) || hasActiveHookCommand(existing, command)) {
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

      // If an existing hook ends with a top-level terminal exit statement,
      // insert before it so self-review is guaranteed to run.
      // Top-level exit statements are unindented (column 0) and outside heredocs,
      // avoiding nested exits inside if/then/fi branches, case blocks, or heredocs.
      const lines = existing.split(/\r?\n/);
      let exitIdx = -1;
      let inHeredoc = false;
      let heredocDelim = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!inHeredoc) {
          if (trimmed.startsWith('#')) {
            continue;
          }
          const match = line.match(/(?<!<)<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
          if (match) {
            inHeredoc = true;
            heredocDelim = match[1];
          } else if (/^exit\b/.test(line.trimEnd())) {
            exitIdx = i;
          }
        } else if (trimmed === heredocDelim) {
          inHeredoc = false;
          heredocDelim = '';
        }
      }

      const hookBlock = [
        PRE_COMMIT_HOOK_MARKER,
        '__gem_prev=$?',
        'if [ $__gem_prev -ne 0 ]; then',
        '  exit $__gem_prev',
        'fi',
        `${command} || exit 1`,
      ];

      if (exitIdx !== -1) {
        lines.splice(exitIdx, 0, ...hookBlock, '');
        fs.writeFileSync(hookPath, lines.join('\n'));
      } else {
        const separator = existing.endsWith('\n') ? '' : '\n';
        const addition = `\n${hookBlock.join('\n')}\n`;
        fs.writeFileSync(hookPath, existing + separator + addition);
      }
      fs.chmodSync(hookPath, 0o755);
      return {
        success: true,
        appended: true,
        hookPath,
      };
    }

    const content = `#!/bin/sh\n${PRE_COMMIT_HOOK_MANAGED_FILE_MARKER}\n${PRE_COMMIT_HOOK_MARKER}\n${command} || exit 1\n`;
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
    const hasManagedFileMarker = content.includes(PRE_COMMIT_HOOK_MANAGED_FILE_MARKER);

    const isManagedSnippetLine = (l) => {
      const t = l.trim();
      return (
        t === PRE_COMMIT_HOOK_MARKER ||
        t === PRE_COMMIT_HOOK_MANAGED_FILE_MARKER ||
        t === '__gem_prev=$?' ||
        t === 'if [ $__gem_prev -ne 0 ]; then' ||
        t === 'exit $__gem_prev' ||
        t === 'fi' ||
        t === command ||
        t === `${command} || exit 1`
      );
    };

    // Check if the file only contains comments/shebang and our managed lines
    const thirdPartyLines = lines
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !l.startsWith('#') && !isManagedSnippetLine(l));

    // If file was auto-created by us AND contains no third-party commands, delete it completely
    if (hasManagedFileMarker && thirdPartyLines.length === 0) {
      fs.unlinkSync(hookPath);
      return { success: true, removed: true, hookPath };
    }

    // Otherwise, clean only our managed lines, preserving user content
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === PRE_COMMIT_HOOK_MARKER) {
        // Strip marker and any consecutive managed snippet lines
        while (i + 1 < lines.length && isManagedSnippetLine(lines[i + 1])) {
          i++;
        }
        continue;
      }
      if (trimmed === PRE_COMMIT_HOOK_MANAGED_FILE_MARKER) {
        continue;
      }
      cleaned.push(line);
    }

    fs.writeFileSync(hookPath, cleaned.join('\n'));
    fs.chmodSync(hookPath, 0o755);
    return { success: true, cleaned: true, hookPath };
  } catch (err) {
    return { success: false, error: err.message, hookPath };
  }
}
