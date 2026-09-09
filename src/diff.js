import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Strips optional leading 'a/' or 'b/' git prefix and enclosing quotes.
 *
 * @param {string | null | undefined} rawPath
 * @returns {string | null}
 */
function cleanGitPath(rawPath) {
  if (!rawPath || rawPath === '/dev/null') {
    return null;
  }

  let cleaned = rawPath.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (cleaned.startsWith('a/') || cleaned.startsWith('b/')) {
    cleaned = cleaned.slice(2);
  }

  return cleaned || null;
}

/**
 * Parses the file paths from a `diff --git` header line.
 * Handles both unquoted and quoted path pairs.
 *
 * @param {string} line
 * @returns {{ oldPath: string | null, newPath: string | null }}
 */
function parseGitDiffHeader(line) {
  const rest = line.slice('diff --git '.length).trim();
  let oldTarget = '';
  let newTarget = '';

  const quotedMatch = rest.match(/^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/);
  if (quotedMatch) {
    oldTarget = quotedMatch[1];
    newTarget = quotedMatch[2];
  } else {
    const bIndex = rest.lastIndexOf(' b/');
    if (bIndex !== -1) {
      oldTarget = rest.slice(0, bIndex);
      newTarget = rest.slice(bIndex + 1);
    } else {
      const parts = rest.split(/\s+/);
      oldTarget = parts[0] || '';
      newTarget = parts[1] || '';
    }
  }

  return {
    oldPath: cleanGitPath(oldTarget),
    newPath: cleanGitPath(newTarget),
  };
}

/**
 * Finalizes file diff attributes prior to collection.
 *
 * @param {object} file
 * @returns {object}
 */
function finalizeFile(file) {
  if (!file) return null;

  file.path = file.newPath || file.oldPath || '';

  if (!file.status) {
    if (file.isBinary) {
      file.status = 'binary';
    } else {
      file.status = 'modified';
    }
  }

  return file;
}

/**
 * Parses unified diff text into structured file diffs with hunk boundaries.
 *
 * @param {string} diffText
 * @returns {Array<object>} Array of parsed file diff objects
 */
export function parseUnifiedDiff(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) {
    return [];
  }

  const lines = diffText.split(/\r?\n/);
  const files = [];

  let currentFile = null;
  let currentHunk = null;
  let currentOldLine = 0;
  let currentNewLine = 0;

  const commitCurrentFile = () => {
    if (currentFile) {
      files.push(finalizeFile(currentFile));
      currentFile = null;
      currentHunk = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect git diff header: starts a new file diff
    if (line.startsWith('diff --git ')) {
      commitCurrentFile();
      const { oldPath, newPath } = parseGitDiffHeader(line);
      currentFile = {
        oldPath,
        newPath,
        path: newPath || oldPath || '',
        status: null,
        isBinary: false,
        hunks: [],
      };
      continue;
    }

    // Support standard diffs without `diff --git`
    if (line.startsWith('--- ') && !currentFile) {
      currentFile = {
        oldPath: null,
        newPath: null,
        path: '',
        status: null,
        isBinary: false,
        hunks: [],
      };
    }

    if (!currentFile) {
      continue;
    }

    // Metadata lines
    if (line.startsWith('old mode ')) {
      currentFile.oldMode = line.slice('old mode '.length).trim();
      continue;
    }

    if (line.startsWith('new mode ')) {
      currentFile.newMode = line.slice('new mode '.length).trim();
      continue;
    }

    if (line.startsWith('new file mode ')) {
      currentFile.status = 'added';
      currentFile.oldPath = null;
      currentFile.newMode = line.slice('new file mode '.length).trim();
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      currentFile.status = 'deleted';
      currentFile.newPath = null;
      currentFile.oldMode = line.slice('deleted file mode '.length).trim();
      continue;
    }

    if (line.startsWith('similarity index ')) {
      const match = line.match(/^similarity index (\d+)%/);
      if (match) {
        currentFile.similarity = parseInt(match[1], 10);
      }
      continue;
    }

    if (line.startsWith('rename from ')) {
      currentFile.status = 'renamed';
      currentFile.oldPath = cleanGitPath(line.slice('rename from '.length));
      continue;
    }

    if (line.startsWith('rename to ')) {
      currentFile.status = 'renamed';
      currentFile.newPath = cleanGitPath(line.slice('rename to '.length));
      continue;
    }

    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      currentFile.isBinary = true;
      currentFile.status = 'binary';
      if (line.includes('/dev/null and')) {
        currentFile.oldPath = null;
      }
      if (line.includes('and /dev/null')) {
        currentFile.newPath = null;
      }
      continue;
    }

    if (line.startsWith('--- ')) {
      const raw = line.slice(4).trim();
      const cleaned = cleanGitPath(raw);
      currentFile.oldPath = cleaned;
      if (raw === '/dev/null' && currentFile.status !== 'renamed') {
        currentFile.status = 'added';
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).trim();
      const cleaned = cleanGitPath(raw);
      currentFile.newPath = cleaned;
      if (raw === '/dev/null' && currentFile.status !== 'renamed') {
        currentFile.status = 'deleted';
      }
      continue;
    }

    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@ heading
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: ?(.*))?$/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] !== undefined ? parseInt(match[4], 10) : 1;
        const heading = match[5] ? match[5].trim() : '';

        currentHunk = {
          header: line.trim(),
          oldStart,
          oldLines,
          newStart,
          newLines,
          heading,
          lines: [],
          diffLines: [],
        };

        currentFile.hunks.push(currentHunk);
        currentOldLine = oldStart;
        currentNewLine = newStart;
        continue;
      }
    }

    // Hunk content lines
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push(line);
        currentHunk.diffLines.push({
          type: 'add',
          line: line.slice(1),
          raw: line,
          oldLineNumber: null,
          newLineNumber: currentNewLine++,
        });
        continue;
      }

      if (line.startsWith('-')) {
        currentHunk.lines.push(line);
        currentHunk.diffLines.push({
          type: 'delete',
          line: line.slice(1),
          raw: line,
          oldLineNumber: currentOldLine++,
          newLineNumber: null,
        });
        continue;
      }

      if (line.startsWith(' ')) {
        currentHunk.lines.push(line);
        currentHunk.diffLines.push({
          type: 'context',
          line: line.slice(1),
          raw: line,
          oldLineNumber: currentOldLine++,
          newLineNumber: currentNewLine++,
        });
        continue;
      }

      if (line.startsWith('\\')) {
        currentHunk.lines.push(line);
        currentHunk.diffLines.push({
          type: 'eof',
          line: line.slice(1).trim(),
          raw: line,
          oldLineNumber: null,
          newLineNumber: null,
        });
        continue;
      }

      // Any line not matching diff indicators ends current hunk
      currentHunk = null;
    }
  }

  commitCurrentFile();
  return files;
}

/**
 * Returns the hunk containing the given line number, or null if outside all hunks.
 *
 * @param {object | Array<object>} fileDiff - FileDiff object or array of hunks
 * @param {number | string} lineNumber - Line number to check (1-based)
 * @param {object} [options]
 * @param {'RIGHT' | 'LEFT'} [options.side='RIGHT'] - RIGHT for new file, LEFT for old file
 * @returns {object | null}
 */
export function getHunkForLine(fileDiff, lineNumber, { side = 'RIGHT' } = {}) {
  if (!fileDiff) return null;

  const hunks = Array.isArray(fileDiff) ? fileDiff : (fileDiff.hunks ?? []);
  const lineNum = Number(lineNumber);

  if (!Number.isInteger(lineNum) || lineNum <= 0) {
    return null;
  }

  for (const hunk of hunks) {
    if (side === 'RIGHT') {
      if (
        hunk.newLines > 0 &&
        lineNum >= hunk.newStart &&
        lineNum < hunk.newStart + hunk.newLines
      ) {
        return hunk;
      }
    } else if (side === 'LEFT') {
      if (
        hunk.oldLines > 0 &&
        lineNum >= hunk.oldStart &&
        lineNum < hunk.oldStart + hunk.oldLines
      ) {
        return hunk;
      }
    }
  }

  return null;
}

/**
 * Checks whether a line number falls within any hunk in the file diff.
 *
 * @param {object | Array<object>} fileDiff
 * @param {number | string} lineNumber
 * @param {object} [options]
 * @param {'RIGHT' | 'LEFT'} [options.side='RIGHT']
 * @returns {boolean}
 */
export function isLineInHunk(fileDiff, lineNumber, options = {}) {
  return getHunkForLine(fileDiff, lineNumber, options) !== null;
}

/**
 * Determines if a line can receive an inline comment under GitHub PR review rules.
 * Enforces safety gates: binary files, deleted files on RIGHT side, and added files
 * on LEFT side cannot be commented on inline.
 *
 * @param {object} fileDiff
 * @param {number | string} lineNumber
 * @param {object} [options]
 * @param {'RIGHT' | 'LEFT'} [options.side='RIGHT']
 * @returns {boolean}
 */
export function isLineCommentable(fileDiff, lineNumber, { side = 'RIGHT' } = {}) {
  if (!fileDiff) return false;

  if (fileDiff.isBinary || fileDiff.status === 'binary') {
    return false;
  }

  if (side === 'RIGHT' && fileDiff.status === 'deleted') {
    return false;
  }

  if (side === 'LEFT' && fileDiff.status === 'added') {
    return false;
  }

  return isLineInHunk(fileDiff, lineNumber, { side });
}

/**
 * Finds a FileDiff from a list of files matching a given file path.
 *
 * @param {Array<object>} diffs - List of parsed file diffs
 * @param {string} filePath - Path to search for
 * @returns {object | null}
 */
export function getFileDiff(diffs, filePath) {
  if (!Array.isArray(diffs) || typeof filePath !== 'string' || !filePath.trim()) {
    return null;
  }

  const normalize = (p) => {
    if (!p) return '';
    if (p.startsWith('a/') || p.startsWith('b/')) {
      return p.slice(2);
    }
    return p;
  };

  const target = normalize(filePath.trim());

  for (const file of diffs) {
    if (
      normalize(file.path) === target ||
      normalize(file.newPath) === target ||
      normalize(file.oldPath) === target
    ) {
      return file;
    }
  }

  return null;
}

/**
 * Fetches the raw unified diff for a GitHub PR using `gh pr diff`.
 *
 * @param {number | string} prNumber - Pull request number
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @param {Function} [options.execFileFn] - Custom execFile function for testing/injection
 * @returns {Promise<string>} Raw unified diff output
 */
export async function getPrDiff(prNumberOrOptions, maybeOptions = {}) {
  const isObject = typeof prNumberOrOptions === 'object' && prNumberOrOptions !== null;
  const rawPrNumber = isObject ? prNumberOrOptions.prNumber : prNumberOrOptions;
  const options = isObject ? prNumberOrOptions : maybeOptions;
  const { cwd = process.cwd(), execFileFn = null, repo = null } = options;

  const prNum = Number(rawPrNumber);
  if (!Number.isInteger(prNum) || prNum <= 0) {
    throw new TypeError(`Invalid PR number: "${rawPrNumber}". Expected a positive integer.`);
  }

  const args = ['pr', 'diff', String(prNum)];
  if (repo) {
    args.push('--repo', repo);
  }

  if (execFileFn) {
    return new Promise((resolve, reject) => {
      execFileFn('gh', args, { cwd }, (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr && stderr.trim()) || err.message;
          reject(new Error(`Failed to fetch diff for PR #${prNum}: ${detail}`));
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? '');
      });
    });
  }

  try {
    const { stdout } = await execFileAsync('gh', args, { cwd });
    return stdout;
  } catch (err) {
    const detail = (err.stderr && err.stderr.trim()) || err.message;
    throw new Error(`Failed to fetch diff for PR #${prNum}: ${detail}`);
  }
}
