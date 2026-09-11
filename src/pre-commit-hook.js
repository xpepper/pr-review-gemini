/**
 * src/pre-commit-hook.js — Git Pre-Commit Hook Management for gem-pr-review
 *
 * Provides repository discovery, worktree detection, atomic hook file lifecycle
 * management, concurrency serialization, and robust shell structure scanning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PRE_COMMIT_HOOK_MARKER = '# gem-pr-review self-review pre-commit hook';
export const PRE_COMMIT_HOOK_END_MARKER = '# end gem-pr-review self-review pre-commit hook';
export const PRE_COMMIT_HOOK_MANAGED_FILE_MARKER = '# gem-pr-review managed-file (auto-created)';

function sleepSync(ms = 25) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const waitTill = Date.now() + ms;
    while (Date.now() < waitTill) {}
  }
}

/**
 * Executes a function with an exclusive file lock on the target hook path.
 * Protects concurrent install/uninstall operations from race conditions.
 *
 * @param {string} hookPath
 * @param {() => any} fn
 * @returns {any}
 */
export function withHookLock(hookPath, fn) {
  const dir = path.dirname(hookPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore mkdir error
  }
  const lockPath = `${hookPath}.lock`;
  const maxWaitMs = 2000;
  const startTime = Date.now();
  let acquired = false;

  while (!acquired && Date.now() - startTime < maxWaitMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      acquired = true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          // If lock is older than 10 seconds, assume stale from crashed process and recover
          if (Date.now() - stat.mtimeMs > 10000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Ignore stat/unlink race error
        }
        // Yield execution without spinning CPU
        sleepSync(25);
      } else {
        throw err;
      }
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire exclusive hook lock on ${hookPath} within ${maxWaitMs}ms`);
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore unlink error
    }
  }
}

/**
 * Atomically writes content to a target file by writing to a unique temporary file
 * in the same directory and renaming it over the destination.
 *
 * @param {string} filePath
 * @param {string} content
 * @param {object} [options={}]
 */
export function atomicWriteFile(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(tmpPath, content, options);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

/**
 * Locates the root directory containing .git, starting at startDir and traversing upward.
 *
 * @param {string} [startDir=process.cwd()]
 * @returns {string|null} Absolute path to git root directory, or null if not found
 */
export function findGitRootDir(startDir = process.cwd()) {
  let curr = path.resolve(startDir);
  while (true) {
    const gitCandidate = path.join(curr, '.git');
    try {
      if (fs.existsSync(gitCandidate)) {
        return curr;
      }
    } catch {
      // Ignore access error and continue upward
    }
    const parent = path.dirname(curr);
    if (parent === curr) {
      break;
    }
    curr = parent;
  }
  return null;
}

/**
 * Resolves the git hooks directory for a standard git repository, custom core.hooksPath, or linked worktree.
 * Searches upward from rootDir if rootDir is a subdirectory within a git repository.
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {object} [options={}]
 * @param {string} [options.hooksDir] - Explicit custom hooks directory override
 * @returns {string|null} Absolute path to hooks directory, or null if not a git repository
 */
export function resolveGitHooksDir(rootDir = process.cwd(), options = {}) {
  if (options?.hooksDir) {
    return path.resolve(options.hooksDir);
  }

  const resolvedRoot = findGitRootDir(rootDir);
  if (!resolvedRoot) {
    return null;
  }

  // 1. Check if git config core.hooksPath is set
  try {
    const configHooks = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: resolvedRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (configHooks) {
      return path.isAbsolute(configHooks)
        ? configHooks
        : path.resolve(resolvedRoot, configHooks);
    }
  } catch {
    // Ignore git command error (e.g. core.hooksPath unset or mock test repo)
  }

  // Fallback inspect .git/config directly if git binary was unavailable
  try {
    const cfgPath = path.join(resolvedRoot, '.git', 'config');
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const match = cfg.match(/^\s*hooksPath\s*=\s*(.+)$/m);
      if (match) {
        const raw = match[1].trim();
        return path.isAbsolute(raw) ? raw : path.resolve(resolvedRoot, raw);
      }
    }
  } catch {
    // Ignore config read error
  }

  // 2. Standard .git directory or linked worktree resolution
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

      // Validate resolved git directory exists, is a directory, and contains git metadata
      if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
        return null;
      }
      const hasGitMetadata =
        fs.existsSync(path.join(gitDir, 'commondir')) ||
        fs.existsSync(path.join(gitDir, 'HEAD')) ||
        fs.existsSync(path.join(gitDir, 'config')) ||
        fs.existsSync(path.join(gitDir, 'gitdir')) ||
        fs.existsSync(path.join(gitDir, 'hooks'));
      if (!hasGitMetadata) {
        return null;
      }

      // In linked worktrees, hooks are shared in the common git directory
      const commonDirFile = path.join(gitDir, 'commondir');
      if (fs.existsSync(commonDirFile)) {
        const relCommon = fs.readFileSync(commonDirFile, 'utf8').trim();
        const commonDir = path.resolve(gitDir, relCommon);
        if (
          fs.existsSync(commonDir) &&
          fs.statSync(commonDir).isDirectory() &&
          (fs.existsSync(path.join(commonDir, 'config')) ||
            fs.existsSync(path.join(commonDir, 'HEAD')) ||
            fs.existsSync(path.join(commonDir, 'hooks')) ||
            fs.existsSync(path.join(commonDir, 'objects')))
        ) {
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
 * Checks whether an array of lines contains an active (non-comment) fail-closed execution of the command.
 *
 * @param {string[]} lines
 * @param {string} [command='npm run self-review']
 * @returns {boolean}
 */
export function hasActiveFailClosedHookCommandInLines(lines, command = 'npm run self-review') {
  if (!Array.isArray(lines)) {
    return false;
  }
  return lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return false;
    }
    const hasCmd =
      trimmed === command ||
      trimmed.startsWith(command + ' ') ||
      trimmed.startsWith(command + ';') ||
      trimmed.startsWith(command + '&') ||
      trimmed.startsWith(command + '|');
    if (!hasCmd) {
      return false;
    }
    return /\|\|\s*exit(\s+[0-9]+|\s+\$[a-zA-Z0-9_]+)?/.test(trimmed);
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
 * Generates the canonical fail-closed pre-commit hook snippet lines.
 *
 * @param {string} [command='npm run self-review']
 * @returns {string[]}
 */
export function generatePreCommitHookSnippet(command = 'npm run self-review') {
  return [
    PRE_COMMIT_HOOK_MARKER,
    '__gem_prev=$?',
    'if [ $__gem_prev -ne 0 ]; then',
    '  exit $__gem_prev',
    'fi',
    `${command} || exit 1`,
    PRE_COMMIT_HOOK_END_MARKER,
  ];
}

/**
 * Checks whether a hook script line belongs to the managed pre-commit hook block.
 *
 * @param {string} line
 * @param {string} [command='npm run self-review']
 * @returns {boolean}
 */
export function isManagedHookSnippetLine(line, command = 'npm run self-review') {
  if (typeof line !== 'string') {
    return false;
  }
  const t = line.trim();
  return (
    t === PRE_COMMIT_HOOK_MARKER ||
    t === PRE_COMMIT_HOOK_END_MARKER ||
    t === PRE_COMMIT_HOOK_MANAGED_FILE_MARKER ||
    t === '__gem_prev=$?' ||
    t === 'if [ $__gem_prev -ne 0 ]; then' ||
    t === 'exit $__gem_prev' ||
    t === 'fi' ||
    t === command ||
    t === `${command} || exit 1` ||
    /\|\|\s*exit(\s+[0-9]+)?$/.test(t)
  );
}

/**
 * Resolves the default pre-commit hook command, inspecting root package.json if available.
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {string} [requestedCommand]
 * @returns {string}
 */
export function resolveDefaultHookCommand(rootDir = process.cwd(), requestedCommand) {
  if (typeof requestedCommand === 'string' && requestedCommand.trim()) {
    return requestedCommand.trim();
  }
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg?.scripts?.['self-review']) {
        return 'npm run self-review';
      }
      if (pkg?.scripts?.['pr-review:self']) {
        return 'npm run pr-review:self';
      }
    }
  } catch {
    // Ignore read/parse error
  }
  return 'npm run self-review';
}

/**
 * Checks if git pre-commit hook is installed and contains self-review.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command]
 * @returns {{ installed: boolean, containsSelfReview: boolean, hookPath: string }}
 */
export function isPreCommitHookInstalled(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir, options);
  const command = resolveDefaultHookCommand(rootDir, options.command);

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
 * Scans shell script content for a top-level terminal exit statement.
 * Tracks heredocs, quoted strings, comments, function bodies (brace depth > 0),
 * and control structures (if/fi, case/esac, while/for/done).
 *
 * @param {string} content
 * @returns {number} 0-based line index of the terminal exit statement, or -1 if none found
 */
export function findTopLevelTerminalExitLine(content) {
  if (typeof content !== 'string') {
    return -1;
  }

  const lines = content.split(/\r?\n/);
  let exitIdx = -1;
  let inHeredoc = false;
  let heredocDelim = '';
  let braceDepth = 0;
  let controlBlockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inHeredoc) {
      if (trimmed === heredocDelim) {
        inHeredoc = false;
        heredocDelim = '';
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    // Check for heredoc start, excluding arithmetic shifts like $((1 << 2))
    const isArithmeticShift = /\$\(\(.*<<|\(\(.*<<|\b[0-9]+\s*<<\s*[0-9]+/.test(line);
    if (!isArithmeticShift) {
      const heredocMatch = line.match(/(?<!<|\$|\()(?:\s|^)<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?(?!\S)/);
      if (heredocMatch) {
        inHeredoc = true;
        heredocDelim = heredocMatch[1];
        continue;
      }
    }

    // Strip comments and strings outside heredoc to analyze tokens safely
    let sanitized = line.replace(/\\./g, ' ');
    sanitized = sanitized.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    sanitized = sanitized.replace(/#.*$/, '');
    sanitized = sanitized.replace(/\$\{[^}]*\}/g, '');

    // Tokenize control keywords, braces, and exit statements
    const tokens = sanitized.match(/(?:(?<!\$)\b(?:if|fi|case|esac|while|for|done|exit)\b)|[{}]/g) || [];

    for (const token of tokens) {
      if (token === '{') {
        braceDepth++;
      } else if (token === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (token === 'if' || token === 'case' || token === 'while' || token === 'for') {
        controlBlockDepth++;
      } else if (token === 'fi' || token === 'esac' || token === 'done') {
        controlBlockDepth = Math.max(0, controlBlockDepth - 1);
      } else if (token === 'exit') {
        if (braceDepth === 0 && controlBlockDepth === 0) {
          exitIdx = i;
        }
      }
    }
  }

  return exitIdx;
}

/**
 * Installs self-review pre-commit hook into git hooks directory.
 * Serializes mutations with a hook lock and writes atomically.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command]
 * @returns {{ success: boolean, hookPath?: string, alreadyInstalled?: boolean, appended?: boolean, error?: string }}
 */
export function installPreCommitHook(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir, options);

  if (!hooksDir) {
    return {
      success: false,
      error: 'No .git repository or worktree found. Ensure you are running inside a git repository.',
    };
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  const command = resolveDefaultHookCommand(rootDir, options.command);

  try {
    return withHookLock(hookPath, () => {
      try {
        fs.mkdirSync(hooksDir, { recursive: true });
        if (fs.existsSync(hookPath)) {
          const existing = fs.readFileSync(hookPath, 'utf8');
          const lines = existing.split(/\r?\n/);

          // Only treat as already installed if an active fail-closed invocation is present
          const isAlreadyFailClosed = hasActiveFailClosedHookCommandInLines(lines, command);

          if (isAlreadyFailClosed) {
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

          const exitIdx = findTopLevelTerminalExitLine(existing);
          const hookBlock = generatePreCommitHookSnippet(command);

          if (exitIdx !== -1) {
            lines.splice(exitIdx, 0, ...hookBlock, '');
            atomicWriteFile(hookPath, lines.join('\n'), { mode: 0o755 });
          } else {
            const separator = existing.endsWith('\n') ? '' : '\n';
            const addition = `\n${hookBlock.join('\n')}\n`;
            atomicWriteFile(hookPath, existing + separator + addition, { mode: 0o755 });
          }
          return {
            success: true,
            appended: true,
            hookPath,
          };
        }

        const content = `#!/bin/sh\n${PRE_COMMIT_HOOK_MANAGED_FILE_MARKER}\n${generatePreCommitHookSnippet(command).join('\n')}\n`;
        atomicWriteFile(hookPath, content, { mode: 0o755 });
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
    });
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
 * Serializes mutations with a hook lock and writes atomically.
 *
 * @param {object} [options={}]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.command]
 * @returns {{ success: boolean, removed?: boolean, cleaned?: boolean, hookPath?: string, error?: string }}
 */
export function uninstallPreCommitHook(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const hooksDir = resolveGitHooksDir(rootDir, options);

  if (!hooksDir) {
    return { success: true, removed: false };
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  const command = resolveDefaultHookCommand(rootDir, options.command);

  if (!fs.existsSync(hookPath)) {
    return { success: true, removed: false, hookPath };
  }

  try {
    return withHookLock(hookPath, () => {
      try {
        const statBefore = fs.statSync(hookPath);
        const content = fs.readFileSync(hookPath, 'utf8');
        // Only uninstall if it contains our managed marker
        if (!content.includes(PRE_COMMIT_HOOK_MARKER)) {
          return { success: true, removed: false, hookPath };
        }

        const lines = content.split(/\r?\n/);
        const hasManagedFileMarker = content.includes(PRE_COMMIT_HOOK_MANAGED_FILE_MARKER);

        // Clean managed lines (bounded by start/end markers or legacy snippet lines)
        const cleaned = [];
        let insideManagedBlock = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          if (trimmed === PRE_COMMIT_HOOK_MARKER) {
            insideManagedBlock = true;
            continue;
          }

          if (insideManagedBlock) {
            if (trimmed === PRE_COMMIT_HOOK_END_MARKER) {
              insideManagedBlock = false;
              continue;
            }
            // Legacy support: if no end marker, stop skipping when reaching non-managed line
            if (!isManagedHookSnippetLine(line, command) && !/\|\|\s*exit/.test(line)) {
              insideManagedBlock = false;
              cleaned.push(line);
            }
            continue;
          }

          if (trimmed === PRE_COMMIT_HOOK_MANAGED_FILE_MARKER) {
            continue;
          }

          cleaned.push(line);
        }

        // Check if cleaned content contains third-party commands
        const thirdPartyLines = cleaned
          .map((l) => l.trim())
          .filter((l) => Boolean(l) && !l.startsWith('#'));

        // If file was auto-created by us AND contains no third-party commands, delete it completely
        if (hasManagedFileMarker && thirdPartyLines.length === 0) {
          fs.unlinkSync(hookPath);
          return { success: true, removed: true, hookPath };
        }

        atomicWriteFile(hookPath, cleaned.join('\n'), { mode: statBefore.mode & 0o777 });
        return { success: true, cleaned: true, hookPath };
      } catch (err) {
        return { success: false, error: err.message, hookPath };
      }
    });
  } catch (err) {
    return { success: false, error: err.message, hookPath };
  }
}
