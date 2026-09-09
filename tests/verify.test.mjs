import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listVerificationProfiles,
  resolveVerificationProfile,
  createDetachedWorktree,
  cleanupWorktree,
  executeSupervisedCommand,
  runVerification,
  formatVerificationSummary,
  DEFAULT_VERIFICATION_PROFILES,
} from '../src/verify.js';

describe('Detached Worktree Test Verification (pr_review_verify)', () => {
  describe('Profile Resolution & Configuration', () => {
    it('returns default profiles when no config is specified', () => {
      const profiles = listVerificationProfiles();
      assert.ok(profiles.test, 'Default "test" profile should exist');
      assert.equal(profiles.test.command, 'npm test');
      assert.ok(typeof profiles.test.timeoutMs === 'number');
    });

    it('merges user-configured profiles from config', () => {
      const config = {
        verificationProfiles: {
          cargo: {
            command: 'cargo test',
            description: 'Run Rust tests',
            timeoutMs: 120000,
          },
          test: {
            command: 'npm run test:ci',
            timeoutMs: 45000,
          },
        },
      };

      const profiles = listVerificationProfiles(config);
      assert.ok(profiles.cargo);
      assert.equal(profiles.cargo.command, 'cargo test');
      assert.equal(profiles.test.command, 'npm run test:ci');
      assert.equal(profiles.test.timeoutMs, 45000);
    });

    it('resolves named profile with default fallbacks', () => {
      const profile = resolveVerificationProfile('test');
      assert.equal(profile.name, 'test');
      assert.equal(profile.command, 'npm test');
      assert.equal(profile.timeoutMs, 60000);
    });

    it('resolves custom command string as custom profile', () => {
      const profile = resolveVerificationProfile('custom', {
        verificationProfiles: {
          custom: {
            command: 'pytest',
            timeoutMs: 30000,
          },
        },
      });
      assert.equal(profile.name, 'custom');
      assert.equal(profile.command, 'pytest');
      assert.equal(profile.timeoutMs, 30000);
    });

    it('throws error when unknown profile is requested and not configured', () => {
      assert.throws(
        () => resolveVerificationProfile('nonexistent_profile_xyz'),
        /unknown verification profile/i
      );
    });
  });

  describe('Detached Worktree Lifecycle', () => {
    it('creates detached worktree with git worktree add --detach', async () => {
      const executedCommands = [];
      const mockGit = async (args) => {
        executedCommands.push(args);
        return '';
      };

      const worktreePath = await createDetachedWorktree({
        repoPath: '/workspace/repo',
        headSha: 'abc1234567890',
        worktreeDir: '/tmp/worktree-1',
        execGitFn: mockGit,
      });

      assert.equal(worktreePath, '/tmp/worktree-1');
      assert.equal(executedCommands.length, 1);
      assert.deepEqual(executedCommands[0], [
        'worktree',
        'add',
        '--detach',
        '/tmp/worktree-1',
        'abc1234567890',
      ]);
    });

    it('cleans up worktree using git worktree remove --force and prune', async () => {
      const executedCommands = [];
      const mockGit = async (args) => {
        executedCommands.push(args);
        return '';
      };

      await cleanupWorktree({
        repoPath: '/workspace/repo',
        worktreeDir: '/tmp/worktree-1',
        execGitFn: mockGit,
      });

      assert.equal(executedCommands.length, 2);
      assert.deepEqual(executedCommands[0], [
        'worktree',
        'remove',
        '--force',
        '/tmp/worktree-1',
      ]);
      assert.deepEqual(executedCommands[1], ['worktree', 'prune']);
    });

    it('tolerates cleanup errors if worktree directory was already cleaned up', async () => {
      const mockGit = async (args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          throw new Error('fatal: not a valid path');
        }
        return '';
      };

      await assert.doesNotReject(async () => {
        await cleanupWorktree({
          repoPath: '/workspace/repo',
          worktreeDir: '/tmp/worktree-missing',
          execGitFn: mockGit,
        });
      });
    });
  });

  describe('executeSupervisedCommand', () => {
    it('executes successful command and returns status passed', async () => {
      const mockSpawn = (cmd, args, options) => {
        return {
          on(event, handler) {
            if (event === 'close') setTimeout(() => handler(0), 10);
            return this;
          },
          stdout: {
            on(event, handler) {
              if (event === 'data') handler(Buffer.from('All 12 tests passed\n'));
              return this;
            },
          },
          stderr: {
            on(event, handler) {
              return this;
            },
          },
          kill() {},
        };
      };

      const result = await executeSupervisedCommand({
        command: 'npm',
        args: ['test'],
        cwd: '/tmp/worktree',
        timeoutMs: 5000,
        spawnFn: mockSpawn,
      });

      assert.equal(result.status, 'passed');
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('All 12 tests passed'));
      assert.equal(result.timedOut, false);
      assert.ok(result.durationMs >= 0);
    });

    it('detects failed command exit code and returns status failed', async () => {
      const mockSpawn = () => {
        return {
          on(event, handler) {
            if (event === 'close') setTimeout(() => handler(1), 10);
            return this;
          },
          stdout: {
            on(event, handler) {
              return this;
            },
          },
          stderr: {
            on(event, handler) {
              if (event === 'data') handler(Buffer.from('AssertionError: expected true but got false\n'));
              return this;
            },
          },
          kill() {},
        };
      };

      const result = await executeSupervisedCommand({
        command: 'npm',
        args: ['test'],
        cwd: '/tmp/worktree',
        timeoutMs: 5000,
        spawnFn: mockSpawn,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes('AssertionError'));
    });

    it('handles process timeout and terminates process', async () => {
      let killed = false;
      let closeHandler = null;

      const mockSpawn = () => {
        return {
          pid: 99999,
          on(event, handler) {
            if (event === 'close') closeHandler = handler;
            return this;
          },
          stdout: { on() { return this; } },
          stderr: { on() { return this; } },
          kill(signal) {
            killed = true;
            if (closeHandler) setImmediate(() => closeHandler(124));
          },
        };
      };

      const result = await executeSupervisedCommand({
        command: 'sleep',
        args: ['100'],
        cwd: '/tmp/worktree',
        timeoutMs: 50,
        spawnFn: mockSpawn,
      });

      assert.equal(result.status, 'timeout');
      assert.equal(result.timedOut, true);
      assert.ok(killed, 'Process should have been killed on timeout');
    });

    it('scrubs sensitive environment variables by default', async () => {
      let capturedEnv = null;
      const mockSpawn = (cmd, args, options) => {
        capturedEnv = options.env;
        return {
          on(event, handler) {
            if (event === 'close') setTimeout(() => handler(0), 10);
            return this;
          },
          stdout: { on() { return this; } },
          stderr: { on() { return this; } },
          kill() {},
        };
      };

      await executeSupervisedCommand({
        command: 'node',
        args: ['-v'],
        cwd: '/tmp/worktree',
        env: {
          PATH: '/bin:/usr/bin',
          HOME: '/home/user',
          GITHUB_TOKEN: 'secret_gh_token_12345',
          COPILOT_API_KEY: 'secret_key_67890',
        },
        spawnFn: mockSpawn,
      });

      assert.ok(capturedEnv.PATH);
      assert.ok(capturedEnv.HOME);
      assert.equal(capturedEnv.GITHUB_TOKEN, undefined, 'GITHUB_TOKEN must be scrubbed');
      assert.equal(capturedEnv.COPILOT_API_KEY, undefined, 'COPILOT_API_KEY must be scrubbed');
    });
  });

  describe('runVerification Orchestrator', () => {
    it('creates worktree, executes test, cleans up worktree, and returns result', async () => {
      const gitCalls = [];
      const mockGit = async (args) => {
        gitCalls.push(args);
        return '';
      };

      const mockSpawn = (cmd, args, options) => {
        return {
          on(event, handler) {
            if (event === 'close') setTimeout(() => handler(0), 10);
            return this;
          },
          stdout: {
            on(event, handler) {
              if (event === 'data') handler(Buffer.from('ok 1 - tests pass\n'));
              return this;
            },
          },
          stderr: { on() { return this; } },
          kill() {},
        };
      };

      const result = await runVerification({
        prNumber: 42,
        headSha: 'headsha4242',
        profileName: 'test',
        repoPath: '/workspace/project',
        execGitFn: mockGit,
        spawnFn: mockSpawn,
      });

      assert.equal(result.status, 'passed');
      assert.equal(result.exitCode, 0);
      assert.equal(result.profile, 'test');
      assert.equal(result.headSha, 'headsha4242');
      assert.ok(result.stdout.includes('ok 1 - tests pass'));

      assert.ok(gitCalls.some((c) => c[0] === 'worktree' && c[1] === 'add'));
      assert.ok(gitCalls.some((c) => c[0] === 'worktree' && c[1] === 'remove'));
    });

    it('fetches headSha via gh if headSha is not passed', async () => {
      const mockGh = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({ headRefOid: 'fetched_sha_999' });
        }
        return '';
      };

      const mockGit = async () => '';
      const mockSpawn = () => ({
        on(event, handler) {
          if (event === 'close') setTimeout(() => handler(0), 10);
          return this;
        },
        stdout: { on() { return this; } },
        stderr: { on() { return this; } },
        kill() {},
      });

      const result = await runVerification({
        prNumber: 42,
        execGhFn: mockGh,
        execGitFn: mockGit,
        spawnFn: mockSpawn,
      });

      assert.equal(result.headSha, 'fetched_sha_999');
      assert.equal(result.status, 'passed');
    });

    it('cleans up worktree even if command execution fails or throws', async () => {
      let cleanedUp = false;
      const mockGit = async (args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          cleanedUp = true;
        }
        return '';
      };

      const mockSpawn = () => {
        throw new Error('Process spawn error');
      };

      await assert.rejects(
        async () => {
          await runVerification({
            prNumber: 42,
            headSha: 'headsha4242',
            execGitFn: mockGit,
            spawnFn: mockSpawn,
          });
        },
        /Process spawn error/
      );

      assert.ok(cleanedUp, 'Worktree must be cleaned up in finally block even on error');
    });
  });

  describe('formatVerificationSummary', () => {
    it('formats clean markdown report for passing verification', () => {
      const summary = formatVerificationSummary({
        status: 'passed',
        exitCode: 0,
        durationMs: 1420,
        headSha: '385bb74',
        profile: 'test',
        command: 'npm test',
        stdout: 'Tests: 12 passed, 12 total',
        stderr: '',
      });

      assert.ok(summary.includes('### Detached Worktree Verification (`npm test`)'));
      assert.ok(summary.includes('✅ **Passed**'));
      assert.ok(summary.includes('`385bb74`'));
      assert.ok(summary.includes('1.4s'));
    });

    it('formats clean markdown report with excerpt for failing verification', () => {
      const summary = formatVerificationSummary({
        status: 'failed',
        exitCode: 1,
        durationMs: 2500,
        headSha: '385bb74',
        profile: 'test',
        command: 'npm test',
        stdout: '',
        stderr: 'Error: test timed out\n  at Suite.<anonymous>',
      });

      assert.ok(summary.includes('❌ **Failed**'));
      assert.ok(summary.includes('exit code: 1'));
      assert.ok(summary.includes('Error: test timed out'));
    });

    it('formats report for timed out verification', () => {
      const summary = formatVerificationSummary({
        status: 'timeout',
        durationMs: 60000,
        headSha: '385bb74',
        profile: 'test',
        command: 'npm test',
        stdout: '',
        stderr: '',
      });

      assert.ok(summary.includes('⏱️ **Timed Out**'));
      assert.ok(summary.includes('60.0s'));
    });
  });
});
