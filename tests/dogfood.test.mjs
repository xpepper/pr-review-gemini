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
});
