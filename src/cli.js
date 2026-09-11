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
    env?.DEBUG === 'gem-pr-review' ||
    env?.DEBUG === 'gem-pr-review:*'
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
 * @param {string} [options.version] - Version string (defaults to canonical plugin version)
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

/**
 * Safely extracts an argument value following a CLI option flag.
 * Throws an informative Error if the argument is missing or is another option flag.
 *
 * @param {string[]} args - Argument list
 * @param {number} index - Index of option flag
 * @param {string} optionName - Option name for error messages (e.g. '--mode')
 * @returns {{ value: string, nextIndex: number }}
 */
export function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (!next || next.startsWith('-')) {
    throw new Error(`Option ${optionName} requires an argument value`);
  }
  return { value: next, nextIndex: index + 1 };
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

// Re-export pre-commit hook constants and lifecycle management
export * from './pre-commit-hook.js';


