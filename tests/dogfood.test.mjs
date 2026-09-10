import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve('scripts/dogfood-review.mjs');

describe('Dogfood Review Script CLI', () => {
  it('displays usage information when invoked with --help', async () => {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--help']);
    assert.match(stdout, /Usage: node scripts\/dogfood-review\.mjs <PR_NUMBER>/);
    assert.match(stdout, /--quick/);
    assert.match(stdout, /--balanced/);
    assert.match(stdout, /--deep/);
    assert.match(stdout, /--incremental/);
    assert.match(stdout, /--dry-run/);
    assert.match(stdout, /--publish-cached/);
    assert.match(stdout, /--all/);
    assert.match(stdout, /--interactive/);
  });

  it('fails with helpful message when PR number is missing', async () => {
    try {
      await execFileAsync(process.execPath, [scriptPath]);
      assert.fail('Should have failed without PR number');
    } catch (err) {
      assert.match(err.stderr || err.stdout, /Usage: node scripts\/dogfood-review\.mjs/);
    }
  });

  it('runs dry-run review using synthetic/mock diff without posting to GitHub', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, '1', '--dry-run', '--mode=quick', '--mock'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    assert.match(stdout, /PR Review Summary/);
    assert.match(stdout, /Mode: `quick`/);
    assert.match(stdout, /Dry-run complete: no review published to GitHub/);
  });

  it('runs dry-run incremental review using synthetic/mock diff', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, '1', '--dry-run', '--incremental', '--mock'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    assert.match(stdout, /PR Review Summary/);
    assert.match(stdout, /\[Incremental\]/i);
    assert.match(stdout, /Dry-run complete: no review published to GitHub/);
  });

  it('fails gracefully when --publish-cached is called without existing cache', async () => {
    try {
      await execFileAsync(
        process.execPath,
        [scriptPath, '9999', '--publish-cached', '--mock'],
        { env: { ...process.env, NODE_ENV: 'test' } }
      );
      assert.fail('Should fail when cache is missing');
    } catch (err) {
      assert.match(err.stderr || err.stdout, /No cached review found/i);
    }
  });

  it('parses CLI arguments correctly including --publish-cached, --all, and --select', async () => {
    const { parseCliArgs } = await import('../scripts/dogfood-review.mjs');
    const parsed = parseCliArgs([
      '42',
      '--publish-cached',
      '--all',
      '--select=p0,p1',
      '--cache-dir=/tmp/test-cache',
      '--repo=owner/repo',
    ]);

    assert.equal(parsed.prNumber, 42);
    assert.equal(parsed.publishCached, true);
    assert.equal(parsed.all, true);
    assert.equal(parsed.select, 'p0,p1');
    assert.equal(parsed.cacheDir, '/tmp/test-cache');
    assert.equal(parsed.repo, 'owner/repo');
  });

  it('parses --role and --replace-standard-roles CLI flags in dogfood-review.mjs and self-review.mjs', async () => {
    const { parseCliArgs: parseDogfoodArgs } = await import('../scripts/dogfood-review.mjs');
    const parsedDogfood = parseDogfoodArgs([
      '12',
      '--role',
      'accessibility',
      '--role=migrations',
      '--replace-standard-roles',
    ]);

    assert.equal(parsedDogfood.prNumber, 12);
    assert.deepEqual(parsedDogfood.roles, ['accessibility', 'migrations']);
    assert.equal(parsedDogfood.replaceStandardRoles, true);

    const { parseCliArgs: parseSelfArgs } = await import('../scripts/self-review.mjs');
    const parsedSelf = parseSelfArgs([
      '--role=a11y,perf',
      '--replace-standard-roles',
    ]);

    assert.deepEqual(parsedSelf.roles, ['a11y', 'perf']);
    assert.equal(parsedSelf.replaceStandardRoles, true);
  });

  it('publishes cached review findings when cache is present', async () => {
    const { saveReviewCache } = await import('../src/cache.js');
    const os = await import('node:os');
    const fs = await import('node:fs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-dogfood-cache-'));

    try {
      await saveReviewCache(
        {
          prNumber: 88,
          headSha: 'abc8888',
          findings: [
            {
              title: 'Mock finding',
              severity: 'P1',
              file: 'src/index.js',
              line: 2,
              side: 'RIGHT',
              confidence: 0.95,
              body: 'Mock issue explanation',
            },
          ],
          summary: 'Cached review summary for PR 88',
        },
        { cacheDir: tempDir }
      );

      const { stdout } = await execFileAsync(
        process.execPath,
        [scriptPath, '88', '--publish-cached', '--all', '--mock', '--mock-gh', `--cache-dir=${tempDir}`],
        { env: { ...process.env, NODE_ENV: 'test' } }
      );

      assert.match(stdout, /Publishing cached review for PR #88/);
      assert.match(stdout, /Retrieved 1 cached findings/);
      assert.match(stdout, /Cached review successfully posted/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs self-review via dogfood-review.mjs --self --mock without requiring PR number', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, '--self', '--mock', '--quick'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    assert.match(stdout, /SELF-REVIEW PASSED \(PASS\)/);
    assert.match(stdout, /\*\*Status\*\*:\s*`passed`/);
  });

  it('runs dedicated scripts/self-review.mjs CLI runner with --mock', async () => {
    const selfReviewScriptPath = path.resolve('scripts/self-review.mjs');
    const { stdout } = await execFileAsync(
      process.execPath,
      [selfReviewScriptPath, '--mock', '--quick', '--json'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    const data = JSON.parse(stdout);
    assert.equal(data.status, 'passed');
    assert.equal(data.verdict, 'PASS');
    assert.equal(data.blockingCount, 0);
  });
});

