import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnifiedDiff,
  isLineInHunk,
  getHunkForLine,
  isLineCommentable,
  getFileDiff,
  getPrDiff,
  LARGE_DIFF_THRESHOLD_BYTES,
  MAX_SUPERVISED_READS,
  DEFAULT_SUPERVISED_BUDGET_BYTES,
  MAX_SUPERVISED_BUDGET_BYTES,
  isLargeDiff,
  generateDiffManifest,
  formatDiffManifest,
} from '../src/diff.js';

describe('Unified Diff Parser & Hunk Anchoring', () => {
  // --------------------------------------------------------------------------
  // Fixtures
  // --------------------------------------------------------------------------
  const SINGLE_FILE_MODIFIED_DIFF = `diff --git a/src/calc.js b/src/calc.js
index 1234567..89abcdef 100644
--- a/src/calc.js
+++ b/src/calc.js
@@ -10,6 +10,7 @@ function calculate(a, b) {
   const sum = a + b;
-  const diff = a - b;
+  const diff = Math.abs(a - b);
+  const product = a * b;
   return sum + diff;
 }
`;

  const MULTI_HUNK_DIFF = `diff --git a/src/index.js b/src/index.js
index 0000001..0000002 100644
--- a/src/index.js
+++ b/src/index.js
@@ -5,4 +5,5 @@ import os from 'node:os';
 export function a() {
+  console.log('alpha');
   return 1;
 }
@@ -25,5 +26,6 @@ export function b() {
   const val = 2;
-  return val;
+  return val * 2;
 }
+export function c() { return 3; }
`;

  const ADDED_FILE_DIFF = `diff --git a/src/utils/logger.js b/src/utils/logger.js
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/utils/logger.js
@@ -0,0 +1,5 @@
+export function log(msg) {
+  console.log('[LOG]:', msg);
+}
+
+export default log;
`;

  const DELETED_FILE_DIFF = `diff --git a/src/legacy.js b/src/legacy.js
deleted file mode 100644
index abcdef1..0000000
--- a/src/legacy.js
+++ /dev/null
@@ -1,4 +0,0 @@
-export function old() {
-  return 'deprecated';
-}
`;

  const PURE_RENAME_DIFF = `diff --git a/src/old-name.js b/src/new-name.js
similarity index 100%
rename from src/old-name.js
rename to src/new-name.js
`;

  const RENAME_WITH_CHANGES_DIFF = `diff --git a/src/foo.js b/src/bar.js
similarity index 80%
rename from src/foo.js
rename to src/bar.js
index 1234567..89abcdef 100644
--- a/src/foo.js
+++ b/src/bar.js
@@ -1,3 +1,4 @@
 export function greet() {
-  return 'hello';
+  return 'hello world';
 }
`;

  const BINARY_DIFF = `diff --git a/assets/logo.png b/assets/logo.png
index 1234567..89abcdef 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

  const BINARY_NEW_FILE_DIFF = `diff --git a/assets/icon.png b/assets/icon.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/assets/icon.png differ
`;

  const GIT_BINARY_PATCH_DIFF = `diff --git a/assets/badge.bin b/assets/badge.bin
index 0000000..1234567 100644
GIT binary patch
literal 24
zc$@*x00001000000000000000
`;

  const SINGLE_LINE_NO_COUNT_DIFF = `diff --git a/src/one.js b/src/one.js
index 1111111..2222222 100644
--- a/src/one.js
+++ b/src/one.js
@@ -42 +42 @@
-const x = 1;
+const x = 2;
`;

  const DIFF_WITH_SPACES_IN_PATHS = `diff --git "a/path with spaces/file one.js" "b/path with spaces/file one.js"
index 1234567..89abcdef 100644
--- "a/path with spaces/file one.js"
+++ "b/path with spaces/file one.js"
@@ -1,3 +1,3 @@
-console.log('old');
+console.log('new');
`;

  const DIFF_WITH_ESCAPED_QUOTES = `diff --git "a/path \\"quoted\\"/file.js" "b/path \\"quoted\\"/file.js"
index 1234567..89abcdef 100644
--- "a/path \\"quoted\\"/file.js"
+++ "b/path \\"quoted\\"/file.js"
@@ -1,2 +1,2 @@
-old
+new
`;

  const NO_NEWLINE_DIFF = `diff --git a/src/file.txt b/src/file.txt
index 1234567..89abcdef 100644
--- a/src/file.txt
+++ b/src/file.txt
@@ -1,2 +1,2 @@
 first
-second
\\ No newline at end of file
+second modified
\\ No newline at end of file
`;

  const MULTI_FILE_COMBINED_DIFF = [
    SINGLE_FILE_MODIFIED_DIFF,
    ADDED_FILE_DIFF,
    DELETED_FILE_DIFF,
    PURE_RENAME_DIFF,
    BINARY_DIFF,
  ].join('\n');

  // --------------------------------------------------------------------------
  // Tests: parseUnifiedDiff
  // --------------------------------------------------------------------------
  describe('parseUnifiedDiff', () => {
    it('returns empty array when diff text is empty, whitespace, or invalid', () => {
      assert.deepEqual(parseUnifiedDiff(''), []);
      assert.deepEqual(parseUnifiedDiff('   \n  \t  \n'), []);
      assert.deepEqual(parseUnifiedDiff(null), []);
      assert.deepEqual(parseUnifiedDiff(undefined), []);
    });

    it('parses a single-file modified diff with accurate hunks and line ranges', () => {
      const files = parseUnifiedDiff(SINGLE_FILE_MODIFIED_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.oldPath, 'src/calc.js');
      assert.equal(file.newPath, 'src/calc.js');
      assert.equal(file.path, 'src/calc.js');
      assert.equal(file.status, 'modified');
      assert.equal(file.isBinary, false);
      assert.equal(file.hunks.length, 1);

      const hunk = file.hunks[0];
      assert.equal(hunk.header, '@@ -10,6 +10,7 @@ function calculate(a, b) {');
      assert.equal(hunk.oldStart, 10);
      assert.equal(hunk.oldLines, 6);
      assert.equal(hunk.newStart, 10);
      assert.equal(hunk.newLines, 7);
      assert.equal(hunk.heading, 'function calculate(a, b) {');

      // Verify diffLines mapping
      assert.ok(Array.isArray(hunk.diffLines));
      assert.equal(hunk.diffLines.length, 6);

      // Context line: line 10
      assert.deepEqual(hunk.diffLines[0], {
        type: 'context',
        line: '  const sum = a + b;',
        raw: '   const sum = a + b;',
        oldLineNumber: 10,
        newLineNumber: 10,
      });

      // Added line: line 11
      const addedLine = hunk.diffLines.find((l) => l.type === 'add' && l.line.includes('Math.abs'));
      assert.ok(addedLine);
      assert.equal(addedLine.oldLineNumber, null);
      assert.equal(addedLine.newLineNumber, 11);
    });

    it('parses multi-hunk diffs within a single file', () => {
      const files = parseUnifiedDiff(MULTI_HUNK_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.path, 'src/index.js');
      assert.equal(file.hunks.length, 2);

      const [hunk1, hunk2] = file.hunks;
      assert.equal(hunk1.oldStart, 5);
      assert.equal(hunk1.oldLines, 4);
      assert.equal(hunk1.newStart, 5);
      assert.equal(hunk1.newLines, 5);

      assert.equal(hunk2.oldStart, 25);
      assert.equal(hunk2.oldLines, 5);
      assert.equal(hunk2.newStart, 26);
      assert.equal(hunk2.newLines, 6);
    });

    it('parses newly added files (new file mode, /dev/null pre-image)', () => {
      const files = parseUnifiedDiff(ADDED_FILE_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.oldPath, null);
      assert.equal(file.newPath, 'src/utils/logger.js');
      assert.equal(file.path, 'src/utils/logger.js');
      assert.equal(file.status, 'added');
      assert.equal(file.isBinary, false);
      assert.equal(file.hunks.length, 1);

      const hunk = file.hunks[0];
      assert.equal(hunk.oldStart, 0);
      assert.equal(hunk.oldLines, 0);
      assert.equal(hunk.newStart, 1);
      assert.equal(hunk.newLines, 5);
    });

    it('parses deleted files (deleted file mode, /dev/null post-image)', () => {
      const files = parseUnifiedDiff(DELETED_FILE_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.oldPath, 'src/legacy.js');
      assert.equal(file.newPath, null);
      assert.equal(file.path, 'src/legacy.js');
      assert.equal(file.status, 'deleted');
      assert.equal(file.isBinary, false);
      assert.equal(file.hunks.length, 1);

      const hunk = file.hunks[0];
      assert.equal(hunk.oldStart, 1);
      assert.equal(hunk.oldLines, 4);
      assert.equal(hunk.newLines, 0);
    });

    it('parses pure renamed files without hunks', () => {
      const files = parseUnifiedDiff(PURE_RENAME_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.oldPath, 'src/old-name.js');
      assert.equal(file.newPath, 'src/new-name.js');
      assert.equal(file.path, 'src/new-name.js');
      assert.equal(file.status, 'renamed');
      assert.equal(file.similarity, 100);
      assert.equal(file.hunks.length, 0);
    });

    it('parses renamed files with code modifications', () => {
      const files = parseUnifiedDiff(RENAME_WITH_CHANGES_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.oldPath, 'src/foo.js');
      assert.equal(file.newPath, 'src/bar.js');
      assert.equal(file.path, 'src/bar.js');
      assert.equal(file.status, 'renamed');
      assert.equal(file.similarity, 80);
      assert.equal(file.hunks.length, 1);
      assert.equal(file.hunks[0].newLines, 4);
    });

    it('parses binary file differences (standard binary line)', () => {
      const files = parseUnifiedDiff(BINARY_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.path, 'assets/logo.png');
      assert.equal(file.status, 'binary');
      assert.equal(file.isBinary, true);
      assert.equal(file.hunks.length, 0);
    });

    it('parses newly added binary files', () => {
      const files = parseUnifiedDiff(BINARY_NEW_FILE_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.newPath, 'assets/icon.png');
      assert.equal(file.status, 'binary');
      assert.equal(file.isBinary, true);
      assert.equal(file.hunks.length, 0);
    });

    it('parses git binary patches without breaking', () => {
      const files = parseUnifiedDiff(GIT_BINARY_PATCH_DIFF);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.path, 'assets/badge.bin');
      assert.equal(file.status, 'binary');
      assert.equal(file.isBinary, true);
    });

    it('parses hunks where line counts default to 1 (omitted count)', () => {
      const files = parseUnifiedDiff(SINGLE_LINE_NO_COUNT_DIFF);
      assert.equal(files.length, 1);

      const hunk = files[0].hunks[0];
      assert.equal(hunk.oldStart, 42);
      assert.equal(hunk.oldLines, 1);
      assert.equal(hunk.newStart, 42);
      assert.equal(hunk.newLines, 1);
    });

    it('parses file paths enclosed in quotes containing spaces', () => {
      const files = parseUnifiedDiff(DIFF_WITH_SPACES_IN_PATHS);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.path, 'path with spaces/file one.js');
      assert.equal(file.oldPath, 'path with spaces/file one.js');
      assert.equal(file.newPath, 'path with spaces/file one.js');
      assert.equal(file.hunks.length, 1);
    });

    it('parses file paths with escaped double quotes', () => {
      const files = parseUnifiedDiff(DIFF_WITH_ESCAPED_QUOTES);
      assert.equal(files.length, 1);

      const file = files[0];
      assert.equal(file.path, 'path "quoted"/file.js');
      assert.equal(file.oldPath, 'path "quoted"/file.js');
      assert.equal(file.newPath, 'path "quoted"/file.js');
      assert.equal(file.hunks.length, 1);
    });

    it('handles files with "\\ No newline at end of file"', () => {
      const files = parseUnifiedDiff(NO_NEWLINE_DIFF);
      assert.equal(files.length, 1);

      const hunk = files[0].hunks[0];
      assert.equal(hunk.lines.some((l) => l.startsWith('\\')), true);
    });

    it('parses multiple files combined in a single unified diff stream', () => {
      const files = parseUnifiedDiff(MULTI_FILE_COMBINED_DIFF);
      assert.equal(files.length, 5);

      assert.equal(files[0].path, 'src/calc.js');
      assert.equal(files[0].status, 'modified');

      assert.equal(files[1].path, 'src/utils/logger.js');
      assert.equal(files[1].status, 'added');

      assert.equal(files[2].path, 'src/legacy.js');
      assert.equal(files[2].status, 'deleted');

      assert.equal(files[3].path, 'src/new-name.js');
      assert.equal(files[3].status, 'renamed');

      assert.equal(files[4].path, 'assets/logo.png');
      assert.equal(files[4].status, 'binary');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: isLineInHunk & getHunkForLine
  // --------------------------------------------------------------------------
  describe('Hunk Anchoring: isLineInHunk & getHunkForLine', () => {
    const multiHunkFiles = parseUnifiedDiff(MULTI_HUNK_DIFF);
    const file = multiHunkFiles[0]; // hunk 1: new 5..9 (newLines=5), hunk 2: new 26..31 (newLines=6)

    it('returns hunk when line falls strictly inside the hunk on RIGHT side (default)', () => {
      // Hunk 1 covers lines 5 through 9
      assert.equal(isLineInHunk(file, 5), true);
      assert.equal(isLineInHunk(file, 7), true);
      assert.equal(isLineInHunk(file, 9), true);

      const hunk = getHunkForLine(file, 7);
      assert.ok(hunk);
      assert.equal(hunk.newStart, 5);
      assert.equal(hunk.newLines, 5);
    });

    it('returns hunk when line falls inside hunk 2', () => {
      // Hunk 2 covers lines 26 through 31
      assert.equal(isLineInHunk(file, 26), true);
      assert.equal(isLineInHunk(file, 30), true);
      assert.equal(isLineInHunk(file, 31), true);

      const hunk = getHunkForLine(file, 30);
      assert.ok(hunk);
      assert.equal(hunk.newStart, 26);
    });

    it('returns false and null when line is outside any hunk range', () => {
      // Before hunk 1
      assert.equal(isLineInHunk(file, 1), false);
      assert.equal(isLineInHunk(file, 4), false);
      assert.equal(getHunkForLine(file, 4), null);

      // Between hunk 1 and hunk 2 (lines 10 through 25)
      assert.equal(isLineInHunk(file, 10), false);
      assert.equal(isLineInHunk(file, 20), false);
      assert.equal(isLineInHunk(file, 25), false);
      assert.equal(getHunkForLine(file, 20), null);

      // After hunk 2
      assert.equal(isLineInHunk(file, 32), false);
      assert.equal(isLineInHunk(file, 100), false);
      assert.equal(getHunkForLine(file, 32), null);
    });

    it('supports checking lines on LEFT side (old pre-image lines)', () => {
      // Hunk 1 old covers lines 5 through 8 (oldStart=5, oldLines=4)
      assert.equal(isLineInHunk(file, 5, { side: 'LEFT' }), true);
      assert.equal(isLineInHunk(file, 8, { side: 'LEFT' }), true);
      assert.equal(isLineInHunk(file, 9, { side: 'LEFT' }), false);

      const hunk = getHunkForLine(file, 8, { side: 'LEFT' });
      assert.ok(hunk);
      assert.equal(hunk.oldStart, 5);
    });

    it('works when passed an array of hunks directly instead of fileDiff object', () => {
      assert.equal(isLineInHunk(file.hunks, 7), true);
      assert.equal(isLineInHunk(file.hunks, 20), false);
    });

    it('gracefully handles empty hunks or invalid line numbers', () => {
      assert.equal(isLineInHunk(null, 5), false);
      assert.equal(isLineInHunk(file, null), false);
      assert.equal(isLineInHunk(file, -1), false);
      assert.equal(isLineInHunk(file, 0), false);
      assert.equal(isLineInHunk(file, 'invalid'), false);
      assert.equal(getHunkForLine(null, 5), null);
      assert.equal(getHunkForLine(file, 0), null);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: isLineCommentable
  // --------------------------------------------------------------------------
  describe('Commentability Safety Gate: isLineCommentable', () => {
    it('returns true for commentable lines inside hunks in modified or added files', () => {
      const modifiedFiles = parseUnifiedDiff(SINGLE_FILE_MODIFIED_DIFF);
      const addedFiles = parseUnifiedDiff(ADDED_FILE_DIFF);

      // Line 11 is inside calc.js hunk (10..16)
      assert.equal(isLineCommentable(modifiedFiles[0], 11), true);

      // Line 3 is inside logger.js hunk (1..5)
      assert.equal(isLineCommentable(addedFiles[0], 3), true);
    });

    it('returns false for lines outside diff hunks', () => {
      const modifiedFiles = parseUnifiedDiff(SINGLE_FILE_MODIFIED_DIFF);
      assert.equal(isLineCommentable(modifiedFiles[0], 1), false);
      assert.equal(isLineCommentable(modifiedFiles[0], 99), false);
    });

    it('returns false for binary files', () => {
      const binaryFiles = parseUnifiedDiff(BINARY_DIFF);
      assert.equal(isLineCommentable(binaryFiles[0], 1), false);
    });

    it('returns false on RIGHT side for deleted files', () => {
      const deletedFiles = parseUnifiedDiff(DELETED_FILE_DIFF);
      // In deleted file, no lines exist on RIGHT side in new tree
      assert.equal(isLineCommentable(deletedFiles[0], 1, { side: 'RIGHT' }), false);
      // But on LEFT side (old code), line 1 was in deleted hunk
      assert.equal(isLineCommentable(deletedFiles[0], 1, { side: 'LEFT' }), true);
    });

    it('returns false on LEFT side for newly added files', () => {
      const addedFiles = parseUnifiedDiff(ADDED_FILE_DIFF);
      // In newly added file, no lines exist in pre-image (LEFT side)
      assert.equal(isLineCommentable(addedFiles[0], 1, { side: 'LEFT' }), false);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: getFileDiff
  // --------------------------------------------------------------------------
  describe('getFileDiff', () => {
    const files = parseUnifiedDiff(MULTI_FILE_COMBINED_DIFF);

    it('finds file by exact path', () => {
      const file = getFileDiff(files, 'src/calc.js');
      assert.ok(file);
      assert.equal(file.path, 'src/calc.js');
    });

    it('finds file when path has leading "a/" or "b/"', () => {
      const fileA = getFileDiff(files, 'a/src/calc.js');
      assert.ok(fileA);
      assert.equal(fileA.path, 'src/calc.js');

      const fileB = getFileDiff(files, 'b/src/calc.js');
      assert.ok(fileB);
      assert.equal(fileB.path, 'src/calc.js');
    });

    it('finds renamed file by either oldPath or newPath', () => {
      const byOld = getFileDiff(files, 'src/old-name.js');
      assert.ok(byOld);
      assert.equal(byOld.path, 'src/new-name.js');

      const byNew = getFileDiff(files, 'src/new-name.js');
      assert.ok(byNew);
      assert.equal(byNew.path, 'src/new-name.js');
    });

    it('returns null if file is not found in diff list', () => {
      assert.equal(getFileDiff(files, 'non/existent.js'), null);
      assert.equal(getFileDiff([], 'src/calc.js'), null);
      assert.equal(getFileDiff(null, 'src/calc.js'), null);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: getPrDiff
  // --------------------------------------------------------------------------
  describe('getPrDiff', () => {
    it('executes "gh pr diff <prNumber>" using provided exec function', async () => {
      let executedCommand = null;
      let executedArgs = null;
      let executedOpts = null;

      const mockExecFile = (cmd, args, opts, callback) => {
        executedCommand = cmd;
        executedArgs = args;
        executedOpts = opts;
        callback(null, SINGLE_FILE_MODIFIED_DIFF, '');
      };

      const diff = await getPrDiff(42, {
        execFileFn: mockExecFile,
        cwd: '/fake/dir',
      });

      assert.equal(executedCommand, 'gh');
      assert.deepEqual(executedArgs, ['pr', 'diff', '42']);
      assert.equal(executedOpts.cwd, '/fake/dir');
      assert.equal(diff, SINGLE_FILE_MODIFIED_DIFF);
    });

    it('rejects with descriptive error if gh command fails', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        const err = new Error('gh: pull request not found');
        err.code = 1;
        callback(err, '', 'pull request not found');
      };

      await assert.rejects(
        async () => {
          await getPrDiff(999, { execFileFn: mockExecFile });
        },
        {
          name: 'Error',
          message: /failed to fetch diff for PR #999/i,
        }
      );
    });

    it('validates PR number argument', async () => {
      await assert.rejects(
        async () => {
          await getPrDiff('invalid');
        },
        {
          name: 'TypeError',
          message: /invalid pr number/i,
        }
      );

      await assert.rejects(
        async () => {
          await getPrDiff(0);
        },
        {
          name: 'TypeError',
          message: /invalid pr number/i,
        }
      );

      await assert.rejects(
        async () => {
          await getPrDiff(-5);
        },
        {
          name: 'TypeError',
          message: /invalid pr number/i,
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // Tests: Threshold Detection & Manifest Generation
  // --------------------------------------------------------------------------
  describe('Large Diff Threshold Detection & Manifest Generation', () => {
    it('defines standard threshold constants', () => {
      assert.equal(LARGE_DIFF_THRESHOLD_BYTES, 200 * 1024, '200 KB threshold');
      assert.equal(MAX_SUPERVISED_READS, 16, '16 reads maximum');
      assert.equal(DEFAULT_SUPERVISED_BUDGET_BYTES, 640 * 1024, '640 KB default access budget');
      assert.equal(MAX_SUPERVISED_BUDGET_BYTES, 1024 * 1024, '1 MB maximum access budget');
    });

    it('isLargeDiff returns false for small diffs and empty inputs', () => {
      assert.equal(isLargeDiff(''), false);
      assert.equal(isLargeDiff(null), false);
      assert.equal(isLargeDiff(undefined), false);
      assert.equal(isLargeDiff(SINGLE_FILE_MODIFIED_DIFF), false);

      // Boundary: exactly 200 KB is not large (> 200 KB)
      const exactly200KB = 'x'.repeat(200 * 1024);
      assert.equal(isLargeDiff(exactly200KB), false);
    });

    it('isLargeDiff returns true when diff exceeds 200 KB', () => {
      const over200KB = 'x'.repeat(200 * 1024 + 1);
      assert.equal(isLargeDiff(over200KB), true);

      // Respects custom threshold
      assert.equal(isLargeDiff('12345', 4), true);
      assert.equal(isLargeDiff('12345', 5), false);
    });

    it('generateDiffManifest produces structured summary for changed files', () => {
      const manifest = generateDiffManifest(MULTI_FILE_COMBINED_DIFF);

      assert.ok(manifest);
      assert.equal(manifest.totalFiles, 5);
      assert.ok(manifest.totalAdditions > 0);
      assert.ok(manifest.totalDeletions > 0);
      assert.ok(manifest.totalBytes > 0);
      assert.equal(manifest.isLarge, false);
      assert.equal(Array.isArray(manifest.files), true);
      assert.equal(manifest.files.length, 5);

      const calcFile = manifest.files.find((f) => f.path === 'src/calc.js');
      assert.ok(calcFile);
      assert.equal(calcFile.status, 'modified');
      assert.equal(calcFile.hunksCount, 1);
      assert.equal(calcFile.additions, 2);
      assert.equal(calcFile.deletions, 1);
      assert.ok(calcFile.byteSize > 0);
      assert.equal(calcFile.isBinary, false);

      const addedFile = manifest.files.find((f) => f.path === 'src/utils/logger.js');
      assert.ok(addedFile);
      assert.equal(addedFile.status, 'added');
      assert.equal(addedFile.additions, 5);
      assert.equal(addedFile.deletions, 0);

      const deletedFile = manifest.files.find((f) => f.path === 'src/legacy.js');
      assert.ok(deletedFile);
      assert.equal(deletedFile.status, 'deleted');
      assert.equal(deletedFile.additions, 0);
      assert.equal(deletedFile.deletions, 3);

      const binaryFile = manifest.files.find((f) => f.path === 'assets/logo.png');
      assert.ok(binaryFile);
      assert.equal(binaryFile.isBinary, true);
      assert.equal(binaryFile.status, 'binary');
    });

    it('generateDiffManifest detects large diff flag when exceeding threshold', () => {
      const largeDummyDiff = `diff --git a/big.txt b/big.txt
new file mode 100644
--- /dev/null
+++ b/big.txt
@@ -0,0 +1,5000 @@
` + '+line\n'.repeat(35000);

      const manifest = generateDiffManifest(largeDummyDiff);
      assert.ok(manifest.totalBytes > LARGE_DIFF_THRESHOLD_BYTES);
      assert.equal(manifest.isLarge, true);
    });

    it('formatDiffManifest creates a readable markdown summary table', () => {
      const manifest = generateDiffManifest(MULTI_FILE_COMBINED_DIFF);
      const formatted = formatDiffManifest(manifest);

      assert.ok(typeof formatted === 'string');
      assert.match(formatted, /\| Status \| File \| \+\/- Lines \| Diff Size \| Hunks \|/);
      assert.match(formatted, /src\/calc\.js/);
      assert.match(formatted, /\+2 \/ -1/);
      assert.match(formatted, /\*\*Total Files\*\*: 5/);
      assert.match(formatted, /\*\*Total Additions\*\*: \+7/);
      assert.match(formatted, /\*\*Total Deletions\*\*: -4/);
    });
  });
});
