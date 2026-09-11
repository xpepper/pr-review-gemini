import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  isDirectRun,
  resolveDebugFlag,
  formatCliError,
  handleCommonFlags,
  runIfDirect,
  findGitRootDir,
  resolveGitHooksDir,
  hasActiveHookCommandInLines,
  hasActiveHookCommand,
  containsPreCommitHook,
  installPreCommitHook,
  uninstallPreCommitHook,
  isPreCommitHookInstalled,
  PRE_COMMIT_HOOK_MARKER,
  PRE_COMMIT_HOOK_MANAGED_FILE_MARKER,
} from '../src/cli.js';
import { VERSION, PLUGIN_NAME } from '../src/version.js';

const execFileAsync = promisify(execFile);

describe('Centralized CLI Infrastructure (src/cli.js)', () => {
  describe('isDirectRun', () => {
    it('returns true when process.argv[1] matches importMetaUrl file path', () => {
      const dummyFile = path.resolve('scripts/dummy-script.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      assert.equal(isDirectRun(dummyUrl, ['node', dummyFile]), true);
      assert.equal(isDirectRun(dummyFile, ['node', dummyFile]), true);
    });

    it('returns true when process.argv[1] is a relative path to importMetaUrl', () => {
      const dummyFile = path.resolve('scripts/dummy-script.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      const relativeArg = path.relative(process.cwd(), dummyFile);

      assert.equal(isDirectRun(dummyUrl, ['node', relativeArg]), true);
    });

    it('returns true when argv[1] omits .mjs or .js extension', () => {
      const dummyFile = path.resolve('scripts/dummy-script.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      const withoutExt = path.resolve('scripts/dummy-script');

      assert.equal(isDirectRun(dummyUrl, ['node', withoutExt]), true);
    });

    it('returns false when argv[1] points to a different script', () => {
      const dummyFile1 = path.resolve('scripts/script-one.mjs');
      const dummyFile2 = path.resolve('scripts/script-two.mjs');
      const dummyUrl1 = pathToFileURL(dummyFile1).href;

      assert.equal(isDirectRun(dummyUrl1, ['node', dummyFile2]), false);
    });

    it('returns false when argv or argv[1] is missing or undefined', () => {
      const dummyFile = path.resolve('scripts/dummy-script.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      assert.equal(isDirectRun(dummyUrl, null), false);
      assert.equal(isDirectRun(dummyUrl, []), false);
      assert.equal(isDirectRun(dummyUrl, ['node']), false);
    });
  });

  describe('resolveDebugFlag', () => {
    it('returns false by default for safe user-facing error formatting', () => {
      assert.equal(resolveDebugFlag(), false);
      assert.equal(resolveDebugFlag({}), false);
    });

    it('returns true when explicit debug, stack, or verbose option is true', () => {
      assert.equal(resolveDebugFlag({ debug: true }), true);
      assert.equal(resolveDebugFlag({ stack: true }), true);
      assert.equal(resolveDebugFlag({ verbose: true }), true);
    });

    it('returns false when explicit debug is false even if other flags or env are present', () => {
      assert.equal(resolveDebugFlag({ debug: false, verbose: true, env: { DEBUG: '1' } }), false);
      assert.equal(resolveDebugFlag({ debug: false, argv: ['--debug'] }), false);
    });

    it('returns true when options.env.DEBUG is set', () => {
      assert.equal(resolveDebugFlag({ env: { DEBUG: '1' } }), true);
      assert.equal(resolveDebugFlag({ env: { DEBUG: '' } }), false);
    });

    it('returns true when argv includes --debug or --verbose', () => {
      assert.equal(resolveDebugFlag({ argv: ['node', 'script.mjs', '--debug'] }), true);
      assert.equal(resolveDebugFlag({ argv: ['node', 'script.mjs', '--verbose'] }), true);
      assert.equal(resolveDebugFlag({ argv: ['node', 'script.mjs', '--quick'] }), false);
    });

    it('defaults to ambient process.env when options.env is omitted', () => {
      const originalDebug = process.env.DEBUG;
      try {
        process.env.DEBUG = '1';
        assert.equal(resolveDebugFlag(), true);
        process.env.DEBUG = '';
        assert.equal(resolveDebugFlag(), false);
      } finally {
        if (originalDebug !== undefined) {
          process.env.DEBUG = originalDebug;
        } else {
          delete process.env.DEBUG;
        }
      }
    });
  });

  describe('formatCliError', () => {
    it('formats string errors with prefix', () => {
      assert.equal(formatCliError('Something went wrong'), '❌ Something went wrong');
    });

    it('does not duplicate error emoji prefix if already present', () => {
      assert.equal(formatCliError('❌ Already prefixed error'), '❌ Already prefixed error');
    });

    it('formats Error instance extracting message', () => {
      const err = new Error('Disk full');
      assert.equal(formatCliError(err), '❌ Disk full');
    });

    it('supports custom prefix or disabling prefix', () => {
      const err = new Error('Network timeout');
      assert.equal(formatCliError(err, { prefix: '[ERROR] ' }), '[ERROR] Network timeout');
      assert.equal(formatCliError(err, { prefix: '' }), 'Network timeout');
      assert.equal(formatCliError(err, { prefix: false }), 'Network timeout');
    });

    it('handles null, undefined, or empty errors gracefully', () => {
      assert.equal(formatCliError(null), '❌ Unknown error occurred.');
      assert.equal(formatCliError(undefined), '❌ Unknown error occurred.');
      assert.equal(formatCliError(''), '❌ Unknown error occurred.');
    });

    it('includes stack trace when verbose option is set', () => {
      const err = new Error('Debug error');
      const formatted = formatCliError(err, { verbose: true });
      assert.match(formatted, /Error: Debug error/);
      assert.match(formatted, /at /);
    });

    it('supports explicit debug option without reading ambient process.env.DEBUG', () => {
      const err = new Error('Explicit debug error');
      const withDebug = formatCliError(err, { debug: true, env: {} });
      assert.match(withDebug, /Error: Explicit debug error/);
      assert.match(withDebug, /at /);

      const withoutDebug = formatCliError(err, { debug: false, env: { DEBUG: '1' } });
      assert.equal(withoutDebug, '❌ Explicit debug error');
    });
  });

  describe('handleCommonFlags', () => {
    it('handles -v and --version by calling printVersionBanner and exiting 0', () => {
      let logged = '';
      let exitCode = null;
      const mockIo = { log: (msg) => { logged += msg; } };
      const mockExit = (code) => { exitCode = code; };

      const res1 = handleCommonFlags(['--version'], { io: mockIo, exit: mockExit });
      assert.equal(res1.handled, true);
      assert.equal(res1.action, 'version');
      assert.equal(exitCode, 0);
      assert.match(logged, new RegExp(`${PLUGIN_NAME} v${VERSION}`));

      logged = '';
      exitCode = null;
      const res2 = handleCommonFlags(['-v'], { io: mockIo, exit: mockExit });
      assert.equal(res2.handled, true);
      assert.equal(res2.action, 'version');
      assert.equal(exitCode, 0);
      assert.match(logged, new RegExp(`${PLUGIN_NAME} v${VERSION}`));
    });

    it('handles -h and --help by calling caller-provided printUsage and exiting 0', () => {
      let usageCalled = false;
      let exitCode = null;
      const mockUsage = (out) => { usageCalled = true; };
      const mockExit = (code) => { exitCode = code; };

      const res = handleCommonFlags(['--help'], { printUsage: mockUsage, exit: mockExit });
      assert.equal(res.handled, true);
      assert.equal(res.action, 'help');
      assert.equal(usageCalled, true);
      assert.equal(exitCode, 0);
    });

    it('returns handled: false when neither version nor help flag is present', () => {
      let exitCalled = false;
      const mockExit = () => { exitCalled = true; };

      const res = handleCommonFlags(['42', '--quick', '--mock'], { exit: mockExit });
      assert.equal(res.handled, false);
      assert.equal(exitCalled, false);
    });

    it('respects exit: false option to prevent process termination and omits exitCode', () => {
      let logged = '';
      const mockIo = { log: (msg) => { logged += msg; } };

      const res = handleCommonFlags(['--version'], { io: mockIo, exit: false });
      assert.equal(res.handled, true);
      assert.equal(res.action, 'version');
      assert.equal(res.exitCode, undefined);
      assert.match(logged, new RegExp(`${PLUGIN_NAME} v${VERSION}`));
    });

    it('binds io.log to io instance when invoking printUsage', () => {
      const customIo = {
        name: 'custom-logger',
        messages: [],
        log(msg) {
          this.messages.push(`[${this.name}] ${msg}`);
        },
      };

      const printUsage = (logger) => {
        logger('Usage line 1');
      };

      const res = handleCommonFlags(['--help'], {
        io: customIo,
        printUsage,
        exit: false,
      });

      assert.equal(res.handled, true);
      assert.equal(res.action, 'help');
      assert.deepEqual(customIo.messages, ['[custom-logger] Usage line 1']);
    });
  });

  describe('runIfDirect', () => {
    it('executes mainFn when invoked directly and resolves', async () => {
      const dummyFile = path.resolve('scripts/direct-test.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      let executed = false;

      const mainFn = async () => {
        executed = true;
        return 'done';
      };

      const result = await runIfDirect(dummyUrl, mainFn, {
        argv: ['node', dummyFile],
      });

      assert.equal(executed, true);
      assert.equal(result, 'done');
    });

    it('does not execute mainFn when not invoked directly', async () => {
      const dummyFile = path.resolve('scripts/direct-test.mjs');
      const otherFile = path.resolve('scripts/other-script.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      let executed = false;

      const mainFn = async () => {
        executed = true;
      };

      const result = await runIfDirect(dummyUrl, mainFn, {
        argv: ['node', otherFile],
      });

      assert.equal(executed, false);
      assert.equal(result, null);
    });

    it('catches async errors in mainFn, prints formatted error, and exits 1', async () => {
      const dummyFile = path.resolve('scripts/direct-test.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      let loggedError = '';
      let exitCode = null;

      const mockIo = {
        error: (msg) => { loggedError += msg; },
        log: () => {},
      };
      const mockExit = (code) => { exitCode = code; };

      const failingMain = async () => {
        throw new Error('Async failure during execution');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
      });

      assert.match(loggedError, /Async failure during execution/);
      assert.equal(exitCode, 1);
    });

    it('catches sync errors in mainFn, prints formatted error, and exits 1', async () => {
      const dummyFile = path.resolve('scripts/direct-test.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      let loggedError = '';
      let exitCode = null;

      const mockIo = {
        error: (msg) => { loggedError += msg; },
        log: () => {},
      };
      const mockExit = (code) => { exitCode = code; };

      const syncFailingMain = () => {
        throw new Error('Sync throw during setup');
      };

      const res = await runIfDirect(dummyUrl, syncFailingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
      });

      assert.match(loggedError, /Sync throw during setup/);
      assert.equal(exitCode, 1);
      assert.ok(res && res.error);
      assert.equal(res.exitCode, 1);
    });

    it('clamps exit code to 1 if error has exitCode 0 or negative', async () => {
      const dummyFile = path.resolve('scripts/direct-test.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;
      let exitCode = null;

      const mockIo = { error: () => {}, log: () => {} };
      const mockExit = (code) => { exitCode = code; };

      const errorWithZeroExit = Object.assign(new Error('Supposedly zero exit code error'), {
        exitCode: 0,
      });

      const res = await runIfDirect(dummyUrl, async () => {
        throw errorWithZeroExit;
      }, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
      });

      assert.equal(exitCode, 1);
      assert.equal(res.exitCode, 1);
    });

    it('formats clean error message by default without exposing stack trace', async () => {
      const dummyFile = path.resolve('scripts/dummy-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Clean failure without stack leak');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
      });

      assert.equal(loggedError, '❌ Clean failure without stack leak');
    });

    it('surfaces stack trace in runIfDirect when debug, verbose, or stack option is true', async () => {
      const dummyFile = path.resolve('scripts/dummy-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Debug error with stack');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
        debug: true,
      });

      assert.match(loggedError, /Error: Debug error with stack/);
      assert.match(loggedError, /at /);
    });

    it('surfaces stack trace in runIfDirect when --debug or --verbose is passed in argv', async () => {
      const dummyFile = path.resolve('scripts/dummy-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Argv debug error');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile, '--debug'],
        io: mockIo,
        exit: mockExit,
      });

      assert.match(loggedError, /Error: Argv debug error/);
      assert.match(loggedError, /at /);
    });

    it('surfaces stack trace in runIfDirect when options.env.DEBUG is set', async () => {
      const dummyFile = path.resolve('scripts/dummy-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Env debug error');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
        env: { DEBUG: '1' },
      });

      assert.match(loggedError, /Error: Env debug error/);
      assert.match(loggedError, /at /);
    });

    it('suppresses stack trace in runIfDirect when debug: false is explicitly requested', async () => {
      const dummyFile = path.resolve('scripts/dummy-clean-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Clean message failure');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile, '--debug'],
        io: mockIo,
        exit: mockExit,
        debug: false,
      });

      assert.equal(loggedError, '❌ Clean message failure');
    });
  });

  describe('findGitRootDir', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-cli-find-root-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns root dir when called with root directory containing .git', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const found = findGitRootDir(tempDir);
      assert.equal(found, tempDir);
    });

    it('finds root dir when traversing up from deeply nested subdirectories', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      const deepSub = path.join(tempDir, 'packages', 'core', 'src', 'utils');
      fs.mkdirSync(deepSub, { recursive: true });

      const found = findGitRootDir(deepSub);
      assert.equal(found, tempDir);
    });

    it('returns null when no .git exists in ancestry', () => {
      // In isolated temp dir with no .git
      const sub = path.join(tempDir, 'nested');
      fs.mkdirSync(sub, { recursive: true });

      const found = findGitRootDir(sub);
      // Unless the parent machine root has a .git (which it shouldn't under tmp), this is null
      assert.equal(found, null);
    });
  });

  describe('hasActiveHookCommand and hasActiveHookCommandInLines', () => {
    it('detects active command lines and ignores comments', () => {
      assert.equal(hasActiveHookCommand('#!/bin/sh\nnpm run self-review\n'), true);
      assert.equal(hasActiveHookCommand('#!/bin/sh\n# npm run self-review\n'), false);
      assert.equal(hasActiveHookCommand('#!/bin/sh\n# check npm run self-review for docs\n'), false);
      assert.equal(hasActiveHookCommand('#!/bin/sh\nnpm run self-review --staged\n'), true);
      assert.equal(hasActiveHookCommand('#!/bin/sh\nnpm run self-review || exit 1\n'), true);
      assert.equal(hasActiveHookCommand('#!/bin/sh\nnpm run self-review | cat\n'), true);
      assert.equal(hasActiveHookCommand('#!/bin/sh\nnpm run self-review; echo done\n'), true);
    });

    it('hasActiveHookCommandInLines evaluates line arrays and handles invalid inputs', () => {
      assert.equal(hasActiveHookCommandInLines(['# comment', 'npm run self-review || exit 1']), true);
      assert.equal(hasActiveHookCommandInLines(['# comment', '# npm run self-review']), false);
      assert.equal(hasActiveHookCommandInLines(null), false);
      assert.equal(hasActiveHookCommandInLines(undefined), false);
    });
  });

  describe('containsPreCommitHook', () => {
    it('returns true when content includes both marker and active command', () => {
      assert.equal(
        containsPreCommitHook(
          '#!/bin/sh\n# gem-pr-review self-review pre-commit hook\nnpm run self-review\n'
        ),
        true
      );
      assert.equal(
        containsPreCommitHook(
          '#!/bin/sh\n# gem-pr-review self-review pre-commit hook\ncustom-command\n',
          'custom-command'
        ),
        true
      );
    });

    it('returns false if command is commented out or marker is missing', () => {
      // Missing marker
      assert.equal(containsPreCommitHook('#!/bin/sh\nnpm run self-review\n'), false);
      // Commented command
      assert.equal(
        containsPreCommitHook(
          '#!/bin/sh\n# gem-pr-review self-review pre-commit hook\n# npm run self-review\n'
        ),
        false
      );
      // Unrelated content or non-string
      assert.equal(containsPreCommitHook('#!/bin/sh\necho "hello"\n'), false);
      assert.equal(containsPreCommitHook(null), false);
      assert.equal(containsPreCommitHook(undefined), false);
    });
  });

  describe('Pre-Commit Hook Integration', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-cli-hook-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('fails gracefully when rootDir is not a git repository', () => {
      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, false);
      assert.match(res.error, /No \.git/);
    });

    it('handles filesystem errors during installation adhering to return contract', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      // Create hooks as a file instead of a directory to force an error
      fs.writeFileSync(path.join(gitDir, 'hooks'), 'blocking file');

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, false);
      assert.ok(res.error);
    });

    it('installs pre-commit hook in a git repository and sets executable permission', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);
      assert.equal(res.created, true);

      const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
      assert.ok(fs.existsSync(hookFile));

      const content = fs.readFileSync(hookFile, 'utf8');
      assert.match(content, /npm run self-review/);

      const stat = fs.statSync(hookFile);
      // Check executable bit (mode & 0o111)
      assert.ok((stat.mode & 0o111) !== 0, 'Hook file must be executable');

      // Check isPreCommitHookInstalled
      const status = isPreCommitHookInstalled({ rootDir: tempDir });
      assert.equal(status.installed, true);
      assert.equal(status.containsSelfReview, true);
    });

    it('detects when hook is already installed and does not duplicate', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const firstInstall = installPreCommitHook({ rootDir: tempDir });
      assert.equal(firstInstall.success, true);
      assert.equal(firstInstall.created, true);

      const secondInstall = installPreCommitHook({ rootDir: tempDir });
      assert.equal(secondInstall.success, true);
      assert.equal(secondInstall.alreadyInstalled, true);
    });

    it('appends self-review to existing pre-commit hook without overwriting other hooks', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      fs.writeFileSync(hookFile, '#!/bin/sh\necho "running other linter"\n', { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);
      assert.equal(res.appended, true);

      const updated = fs.readFileSync(hookFile, 'utf8');
      assert.match(updated, /running other linter/);
      assert.match(updated, /npm run self-review/);
    });

    it('ensures existing non-executable hook becomes executable after appending', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      // Create non-executable hook file (0o644)
      fs.writeFileSync(hookFile, '#!/bin/sh\necho "existing test"\n', { mode: 0o644 });
      fs.chmodSync(hookFile, 0o644);

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);

      const stat = fs.statSync(hookFile);
      assert.ok((stat.mode & 0o111) !== 0, 'Hook must be made executable (0o755)');
    });

    it('does not falsely detect installation when file mentions self-review in unrelated scripts', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      // Contains 'self-review' in unrelated comment or filename
      fs.writeFileSync(hookFile, '#!/bin/sh\n# run-self-review-check.sh\n./custom-script.sh\n', { mode: 0o755 });

      const statusBefore = isPreCommitHookInstalled({ rootDir: tempDir });
      assert.equal(statusBefore.containsSelfReview, false);

      const installRes = installPreCommitHook({ rootDir: tempDir });
      assert.equal(installRes.success, true);
      assert.equal(installRes.appended, true);

      const updated = fs.readFileSync(hookFile, 'utf8');
      assert.match(updated, /npm run self-review/);
    });

    it('uninstalls pre-commit hook cleanly when installed alone', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      installPreCommitHook({ rootDir: tempDir });
      const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
      assert.ok(fs.existsSync(hookFile));

      const uninstRes = uninstallPreCommitHook({ rootDir: tempDir });
      assert.equal(uninstRes.success, true);
      assert.equal(uninstRes.removed, true);
      assert.equal(fs.existsSync(hookFile), false);
    });

    it('removes only self-review line from existing pre-commit hook with other commands', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      fs.writeFileSync(hookFile, '#!/bin/sh\n# other hook\nnpm test\n', { mode: 0o755 });

      installPreCommitHook({ rootDir: tempDir });
      assert.ok(fs.readFileSync(hookFile, 'utf8').includes('npm run self-review'));

      const uninstRes = uninstallPreCommitHook({ rootDir: tempDir });
      assert.equal(uninstRes.success, true);
      assert.equal(uninstRes.cleaned, true);
      assert.ok(fs.existsSync(hookFile));

      const remaining = fs.readFileSync(hookFile, 'utf8');
      assert.match(remaining, /npm test/);
      assert.doesNotMatch(remaining, /npm run self-review/);
    });

    it('resolves git hooks directory and installs hook in a linked git worktree', () => {
      // Simulate main repo
      const mainGitDir = path.join(tempDir, 'main-repo', '.git');
      const mainHooksDir = path.join(mainGitDir, 'hooks');
      const worktreeGitDir = path.join(mainGitDir, 'worktrees', 'feature-branch');
      fs.mkdirSync(mainHooksDir, { recursive: true });
      fs.mkdirSync(worktreeGitDir, { recursive: true });
      fs.writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..\n');

      // Simulate linked worktree checkout
      const worktreeDir = path.join(tempDir, 'worktree-checkout');
      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.writeFileSync(path.join(worktreeDir, '.git'), `gitdir: ${worktreeGitDir}\n`);

      const resolvedHooks = resolveGitHooksDir(worktreeDir);
      assert.equal(resolvedHooks, mainHooksDir);

      const installRes = installPreCommitHook({ rootDir: worktreeDir });
      assert.equal(installRes.success, true);
      assert.ok(fs.existsSync(path.join(mainHooksDir, 'pre-commit')));

      const status = isPreCommitHookInstalled({ rootDir: worktreeDir });
      assert.equal(status.installed, true);
      assert.equal(status.containsSelfReview, true);
    });

    it('inserts self-review hook before terminal exit statement in existing hook across shell idioms', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const testCases = [
        '#!/bin/sh\necho "check"\nexit 0\n',
        '#!/bin/sh\necho "check"\nexit $?\n',
        '#!/bin/sh\necho "check"\nexit $!\n',
        '#!/bin/sh\necho "check"\nexit 1;\n',
        '#!/bin/sh\necho "check"\nexit $status\n',
      ];

      for (let i = 0; i < testCases.length; i++) {
        const subTemp = path.join(tempDir, `sub-${i}`);
        const subHooks = path.join(subTemp, '.git', 'hooks');
        fs.mkdirSync(subHooks, { recursive: true });
        const hookFile = path.join(subHooks, 'pre-commit');
        fs.writeFileSync(hookFile, testCases[i], { mode: 0o755 });

        const res = installPreCommitHook({ rootDir: subTemp });
        assert.equal(res.success, true);
        assert.equal(res.appended, true);

        const content = fs.readFileSync(hookFile, 'utf8');
        const selfReviewIdx = content.indexOf('npm run self-review');
        const expectedExit = testCases[i].trim().split('\n').pop().trim();
        const terminalExitIdx = content.lastIndexOf(expectedExit);
        assert.ok(selfReviewIdx !== -1, `Must contain self-review for test case ${i}`);
        assert.ok(terminalExitIdx !== -1, `Must contain exit for test case ${i}`);
        assert.ok(selfReviewIdx < terminalExitIdx, `self-review must precede terminal exit statement in case ${i}`);
        assert.ok(content.includes('npm run self-review || exit 1'), `Must include fail-closed || exit 1 in case ${i}`);
        assert.ok(content.includes('__gem_prev=$?'), `Must include prior status guard in case ${i}`);
      }
    });

    it('preserves conditional block structure and does not insert before nested or indented early exits', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      const complexHook = `#!/bin/sh
if [ -z "$STAGED_FILES" ]; then
  echo "No files staged"
  exit 0
fi

run_tests() {
  npm test || exit 1
}

run_tests
exit $?
`;
      fs.writeFileSync(hookFile, complexHook, { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);
      assert.equal(res.appended, true);

      const content = fs.readFileSync(hookFile, 'utf8');
      const selfReviewIdx = content.indexOf('npm run self-review');
      const conditionalExitIdx = content.indexOf('  exit 0');
      const terminalExitIdx = content.indexOf('exit $?');

      assert.ok(selfReviewIdx !== -1, 'Must contain self-review');
      assert.ok(selfReviewIdx > conditionalExitIdx, 'self-review must be placed after conditional early exit');
      assert.ok(selfReviewIdx < terminalExitIdx, 'self-review must precede terminal exit $?');
    });

    it('appends at end of file when hook has only conditional exits and no terminal exit', () => {
      const subTemp = path.join(tempDir, 'sub-guard-only');
      const subHooks = path.join(subTemp, '.git', 'hooks');
      fs.mkdirSync(subHooks, { recursive: true });
      const hookFile = path.join(subHooks, 'pre-commit');
      const guardOnlyHook = `#!/bin/sh
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "Running checks"
npm test
`;
      fs.writeFileSync(hookFile, guardOnlyHook, { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: subTemp });
      assert.equal(res.success, true);
      assert.equal(res.appended, true);

      const content = fs.readFileSync(hookFile, 'utf8');
      const selfReviewIdx = content.indexOf('npm run self-review');
      const npmTestIdx = content.indexOf('npm test');
      assert.ok(selfReviewIdx > npmTestIdx, 'self-review must be appended at end of script after npm test');
    });

    it('ignores exit statements inside heredoc blocks', () => {
      const subTemp = path.join(tempDir, 'sub-heredoc');
      const subHooks = path.join(subTemp, '.git', 'hooks');
      fs.mkdirSync(subHooks, { recursive: true });
      const hookFile = path.join(subHooks, 'pre-commit');
      const heredocHook = `#!/bin/sh
cat << 'EOF'
Usage info:
exit 0 to quit
EOF

npm test
exit 0
`;
      fs.writeFileSync(hookFile, heredocHook, { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: subTemp });
      assert.equal(res.success, true);
      assert.equal(res.appended, true);

      const content = fs.readFileSync(hookFile, 'utf8');
      const selfReviewIdx = content.indexOf('npm run self-review');
      const heredocExitIdx = content.indexOf('exit 0 to quit');
      const terminalExitIdx = content.lastIndexOf('exit 0');

      assert.ok(selfReviewIdx > heredocExitIdx, 'Must not insert inside heredoc');
      assert.ok(selfReviewIdx < terminalExitIdx, 'Must insert before terminal exit');
    });

    it('does not touch or uninstall unmanaged hooks without PRE_COMMIT_HOOK_MARKER', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookFile = path.join(hooksDir, 'pre-commit');
      // User manually added hook without our marker
      const originalContent = '#!/bin/sh\nnpm run self-review && npm test\n';
      fs.writeFileSync(hookFile, originalContent, { mode: 0o755 });

      const uninstRes = uninstallPreCommitHook({ rootDir: tempDir });
      assert.equal(uninstRes.success, true);
      assert.equal(uninstRes.removed, false);
      assert.equal(fs.readFileSync(hookFile, 'utf8'), originalContent);
    });

    it('installs and uninstalls pre-commit hook via self-review.mjs CLI flags', async () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const selfReviewScript = path.resolve('scripts/self-review.mjs');

      // Install hook via CLI
      const { stdout: installOut } = await execFileAsync(
        process.execPath,
        [selfReviewScript, '--install-hook'],
        { cwd: tempDir }
      );
      assert.match(installOut, /Successfully installed pre-commit hook/);

      const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
      assert.ok(fs.existsSync(hookFile));

      // Re-install hook via CLI (idempotency check)
      const { stdout: reinstallOut } = await execFileAsync(
        process.execPath,
        [selfReviewScript, '--install-hook'],
        { cwd: tempDir }
      );
      assert.match(reinstallOut, /Pre-commit hook is already installed/);

      // Uninstall hook via CLI
      const { stdout: uninstallOut } = await execFileAsync(
        process.execPath,
        [selfReviewScript, '--uninstall-hook'],
        { cwd: tempDir }
      );
      assert.match(uninstallOut, /Successfully removed self-review pre-commit hook/);
      assert.equal(fs.existsSync(hookFile), false);
    });

    it('resolves git hooks directory and installs hook when executed from a nested subdirectory', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });

      const nestedSubdir = path.join(tempDir, 'src', 'features', 'deep');
      fs.mkdirSync(nestedSubdir, { recursive: true });

      const resolvedHooks = resolveGitHooksDir(nestedSubdir);
      assert.equal(resolvedHooks, path.join(gitDir, 'hooks'));

      const res = installPreCommitHook({ rootDir: nestedSubdir });
      assert.equal(res.success, true);
      assert.equal(res.created, true);

      const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
      assert.ok(fs.existsSync(hookFile));
    });

    it('rejects path traversal or invalid targets in .git gitdir pointer files', () => {
      // 1. Target directory does not exist
      const fakeDir = path.join(tempDir, 'nonexistent-git-dir');
      const gitFile = path.join(tempDir, '.git');
      fs.writeFileSync(gitFile, `gitdir: ${fakeDir}\n`);

      assert.equal(resolveGitHooksDir(tempDir), null);

      // 2. Target points to a regular file, not a directory
      const blockingFile = path.join(tempDir, 'regular-file');
      fs.writeFileSync(blockingFile, 'not a directory');
      fs.writeFileSync(gitFile, `gitdir: ${blockingFile}\n`);

      assert.equal(resolveGitHooksDir(tempDir), null);
    });

    it('does not trigger heredoc mode on comments with << or here-strings <<<', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookFile = path.join(hooksDir, 'pre-commit');

      const hookContent = `#!/bin/sh
# Comment mentioning <<- EOF
echo "test"
exit 0
`;
      fs.writeFileSync(hookFile, hookContent, { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);
      assert.equal(res.appended, true);

      const content = fs.readFileSync(hookFile, 'utf8');
      const selfReviewIdx = content.indexOf('npm run self-review');
      const exitIdx = content.lastIndexOf('exit 0');
      assert.ok(selfReviewIdx !== -1);
      assert.ok(selfReviewIdx < exitIdx, 'self-review must be inserted before exit 0 despite comments with <<');
    });

    it('does not duplicate command if active command is already present without marker', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookFile = path.join(hooksDir, 'pre-commit');

      const original = '#!/bin/sh\nnpm run self-review\nexit 0\n';
      fs.writeFileSync(hookFile, original, { mode: 0o755 });

      const res = installPreCommitHook({ rootDir: tempDir });
      assert.equal(res.success, true);
      assert.equal(res.alreadyInstalled, true);
      assert.equal(fs.readFileSync(hookFile, 'utf8'), original);
    });

    it('preserves user-authored files on uninstall and only unlinks auto-created hooks', () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookFile = path.join(hooksDir, 'pre-commit');

      // 1. User had a pre-existing hook without managed marker
      const userHook = '#!/bin/sh\necho "user pre-commit check"\n';
      fs.writeFileSync(hookFile, userHook, { mode: 0o755 });

      // Install appends
      const installRes = installPreCommitHook({ rootDir: tempDir });
      assert.equal(installRes.appended, true);

      // Uninstall cleans managed lines but NEVER deletes user hook file
      const uninstRes = uninstallPreCommitHook({ rootDir: tempDir });
      assert.equal(uninstRes.success, true);
      assert.equal(uninstRes.cleaned, true);
      assert.ok(fs.existsSync(hookFile), 'User-authored hook file must NOT be unlinked');
      assert.match(fs.readFileSync(hookFile, 'utf8'), /user pre-commit check/);

      // 2. Auto-created hook where user subsequently added their own custom command
      fs.unlinkSync(hookFile);
      installPreCommitHook({ rootDir: tempDir });
      assert.ok(fs.readFileSync(hookFile, 'utf8').includes(PRE_COMMIT_HOOK_MANAGED_FILE_MARKER));

      // User adds a command
      fs.appendFileSync(hookFile, 'npm test\n');

      // Uninstall should clean managed lines but NOT unlink the file
      const uninstModified = uninstallPreCommitHook({ rootDir: tempDir });
      assert.equal(uninstModified.success, true);
      assert.equal(uninstModified.cleaned, true);
      assert.ok(fs.existsSync(hookFile), 'File with third-party commands must NOT be unlinked');
      assert.match(fs.readFileSync(hookFile, 'utf8'), /npm test/);
    });

    it('enforces fail-closed execution in shell when hook command fails or previous command fails', async () => {
      const gitDir = path.join(tempDir, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookFile = path.join(hooksDir, 'pre-commit');

      // Case A: Existing hook ends with exit 0, but review command fails (returns exit 1)
      const existingHook = '#!/bin/sh\necho "running prior checks"\nexit 0\n';
      fs.writeFileSync(hookFile, existingHook, { mode: 0o755 });

      installPreCommitHook({ rootDir: tempDir, command: 'sh -c "exit 1"' });

      // Execute hook with sh
      try {
        await execFileAsync('/bin/sh', [hookFile]);
        assert.fail('Hook execution should have failed with exit 1');
      } catch (err) {
        assert.equal(err.code, 1, 'Hook must fail-closed with exit code 1');
      }

      // Case B: Prior command in hook fails (exit 2); hook should terminate with prior code 2
      const failingPriorHook = '#!/bin/sh\nsh -c "exit 2"\nexit 0\n';
      fs.writeFileSync(hookFile, failingPriorHook, { mode: 0o755 });

      installPreCommitHook({ rootDir: tempDir, command: 'sh -c "exit 0"' });

      try {
        await execFileAsync('/bin/sh', [hookFile]);
        assert.fail('Hook execution should have failed with exit 2');
      } catch (err) {
        assert.equal(err.code, 2, 'Hook must propagate prior failure code');
      }
    });
  });

  describe('Sibling CLI Entrypoints Consistency & Help Flags', () => {
    const scripts = [
      { name: 'dogfood-pr.mjs', path: path.resolve('scripts/dogfood-pr.mjs'), expectedUsage: /Usage: npm run dogfood:pr/ },
      { name: 'dogfood-review.mjs', path: path.resolve('scripts/dogfood-review.mjs'), expectedUsage: /Usage: node scripts\/dogfood-review\.mjs/ },
      { name: 'self-review.mjs', path: path.resolve('scripts/self-review.mjs'), expectedUsage: /Usage: node scripts\/self-review\.mjs/ },
      { name: 'ci-action.mjs', path: path.resolve('scripts/ci-action.mjs'), expectedUsage: /Usage: node scripts\/ci-action\.mjs/ },
      { name: 'bump-version.mjs', path: path.resolve('scripts/bump-version.mjs'), expectedUsage: /Usage: node scripts\/bump-version\.mjs/ },
    ];

    for (const script of scripts) {
      it(`${script.name} displays usage banner with --help and exits 0`, async () => {
        const { stdout } = await execFileAsync(process.execPath, [script.path, '--help']);
        assert.match(stdout, script.expectedUsage);
      });

      it(`${script.name} displays version banner with -v and exits 0`, async () => {
        const { stdout } = await execFileAsync(process.execPath, [script.path, '-v']);
        assert.match(stdout, new RegExp(`${PLUGIN_NAME} v${VERSION}`));
      });
    }
  });
});

