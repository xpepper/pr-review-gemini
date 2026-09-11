import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isDirectRun,
  formatCliError,
  handleCommonFlags,
  runIfDirect,
  installPreCommitHook,
  uninstallPreCommitHook,
  isPreCommitHookInstalled,
} from '../src/cli.js';
import { VERSION, PLUGIN_NAME } from '../src/version.js';

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

    it('respects exit: false option to prevent process termination', () => {
      let logged = '';
      const mockIo = { log: (msg) => { logged += msg; } };

      const res = handleCommonFlags(['--version'], { io: mockIo, exit: false });
      assert.equal(res.handled, true);
      assert.equal(res.action, 'version');
      assert.match(logged, new RegExp(`${PLUGIN_NAME} v${VERSION}`));
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

    it('surfaces stack trace in runIfDirect when CI environment variable or debug option is active', async () => {
      const dummyFile = path.resolve('scripts/dummy-ci-runner.mjs');
      const dummyUrl = pathToFileURL(dummyFile).href;

      let loggedError = '';
      const mockIo = { error: (msg) => { loggedError += msg; } };
      const mockExit = () => {};

      const failingMain = () => {
        throw new Error('Unexpected crash in CI');
      };

      await runIfDirect(dummyUrl, failingMain, {
        argv: ['node', dummyFile],
        io: mockIo,
        exit: mockExit,
        debug: true,
      });

      assert.match(loggedError, /Error: Unexpected crash in CI/);
      assert.match(loggedError, /at /);
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
      assert.match(res.error, /No \.git directory found/);
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

    it('installs and uninstalls pre-commit hook via self-review.mjs CLI flags', async () => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);

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
  });

  describe('Sibling CLI Entrypoints Consistency & Help Flags', () => {
    const scripts = [
      { name: 'dogfood-pr.mjs', path: path.resolve('scripts/dogfood-pr.mjs'), expectedUsage: /Usage: npm run dogfood:pr/ },
      { name: 'dogfood-review.mjs', path: path.resolve('scripts/dogfood-review.mjs'), expectedUsage: /Usage: node scripts\/dogfood-review\.mjs/ },
      { name: 'self-review.mjs', path: path.resolve('scripts/self-review.mjs'), expectedUsage: /Usage: node scripts\/self-review\.mjs/ },
      { name: 'bump-version.mjs', path: path.resolve('scripts/bump-version.mjs'), expectedUsage: /Usage: node scripts\/bump-version\.mjs/ },
    ];

    for (const script of scripts) {
      it(`${script.name} displays usage banner with --help and exits 0`, async () => {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);

        const { stdout } = await execFileAsync(process.execPath, [script.path, '--help']);
        assert.match(stdout, script.expectedUsage);
      });

      it(`${script.name} displays version banner with -v and exits 0`, async () => {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);

        const { stdout } = await execFileAsync(process.execPath, [script.path, '-v']);
        assert.match(stdout, new RegExp(`${PLUGIN_NAME} v${VERSION}`));
      });
    }
  });
});

