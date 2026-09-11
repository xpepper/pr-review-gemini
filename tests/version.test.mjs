import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  VERSION,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  isValidSemVer,
  parseSemVer,
  getManifestVersions,
  checkManifestSync,
} from '../src/version.js';
import {
  parseConventionalCommit,
  determineSemverBump,
  calculateNextVersion,
  generateChangelog,
  bumpManifestVersions,
} from '../src/semver.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('Increment 15: Central Version Module & Manifest Synchronization', () => {
  describe('src/version.js — Canonical Version Module', () => {
    it('exports canonical VERSION matching package.json', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
      assert.equal(typeof VERSION, 'string');
      assert.equal(VERSION, pkg.version);
    });

    it('exports PLUGIN_NAME and PLUGIN_VERSION alias', () => {
      assert.equal(PLUGIN_NAME, 'gem-pr-review');
      assert.equal(PLUGIN_VERSION, VERSION);
    });

    it('validates SemVer format with isValidSemVer', () => {
      assert.equal(isValidSemVer('0.1.0'), true);
      assert.equal(isValidSemVer('1.0.0'), true);
      assert.equal(isValidSemVer('1.2.3-alpha.1'), true);
      assert.equal(isValidSemVer('2.0.0-beta+exp.sha.5114f85'), true);

      assert.equal(isValidSemVer('v1.0.0'), false);
      assert.equal(isValidSemVer('1.0'), false);
      assert.equal(isValidSemVer('1'), false);
      assert.equal(isValidSemVer('invalid'), false);
      assert.equal(isValidSemVer(' 0.1.0 '), false);
      assert.equal(isValidSemVer('0.1.0\n'), false);
      assert.equal(isValidSemVer(''), false);
      assert.equal(isValidSemVer(null), false);
    });

    it('parses SemVer components with parseSemVer', () => {
      const parsed = parseSemVer('1.2.3-beta.1+build.123');
      assert.deepEqual(parsed, {
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'beta.1',
        build: 'build.123',
      });

      const simple = parseSemVer('0.1.0');
      assert.deepEqual(simple, {
        major: 0,
        minor: 1,
        patch: 0,
        prerelease: null,
        build: null,
      });

      assert.equal(parseSemVer('not-a-version'), null);
    });

    it('current VERSION adheres to SemVer specification', () => {
      assert.equal(isValidSemVer(VERSION), true, `VERSION "${VERSION}" must be valid SemVer`);
    });
  });

  describe('Manifest Synchronization Verification', () => {
    it('reads versions from all four manifest files', () => {
      const manifests = getManifestVersions(ROOT_DIR);
      assert.ok(manifests.packageJson, 'package.json version should exist');
      assert.ok(manifests.pluginJson, 'plugin.json version should exist');
      assert.ok(manifests.mcpJson, 'mcp.json version should exist');
      assert.ok(manifests.skillMd, 'SKILL.md version should exist');
    });

    it('all manifest files are strictly synchronized to the same SemVer version', () => {
      const syncResult = checkManifestSync(ROOT_DIR);
      assert.equal(
        syncResult.inSync,
        true,
        `Manifests must be in sync. Found versions: ${JSON.stringify(syncResult.versions)}`
      );
      assert.equal(syncResult.version, VERSION);
      assert.equal(syncResult.versions.packageJson, VERSION);
      assert.equal(syncResult.versions.pluginJson, VERSION);
      assert.equal(syncResult.versions.mcpJson, VERSION);
      assert.equal(syncResult.versions.skillMd, VERSION);
    });

    it('detects manifest drift when a file has a mismatched version', () => {
      // Mock manifest versions object
      const driftResult = checkManifestSync(ROOT_DIR, {
        mockVersions: {
          packageJson: '0.1.0',
          pluginJson: '0.2.0',
          mcpJson: '0.1.0',
          skillMd: '0.1.0',
        },
      });

      assert.equal(driftResult.inSync, false);
      assert.ok(driftResult.driftDetails.length > 0);
      assert.match(driftResult.error, /Manifest version drift detected/);
    });
  });

  describe('Integration: MCP Server & Review Summary Headers', () => {
    it('MCP server reports canonical VERSION on initialize', async () => {
      const { createMcpHandler } = await import('../server/index.js');
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
        },
      });

      assert.equal(response.result.serverInfo.name, 'gem-pr-review');
      assert.equal(response.result.serverInfo.version, VERSION);
    });

    it('Review summary header includes canonical version', async () => {
      const { runReview } = await import('../src/reviewer.js');
      const mockRunner = async () => '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>';
      const mockDiff = `diff --git a/test.js b/test.js
index 1111111..2222222 100644
--- a/test.js
+++ b/test.js
@@ -1,2 +1,3 @@
+const x = 1;
`;
      const result = await runReview({
        prNumber: 999,
        diffText: mockDiff,
        runnerFn: mockRunner,
        dryRun: true,
      });

      assert.ok(result.summary.includes(`gem-pr-review v${VERSION}`));
    });
  });

  describe('CLI Version Flags Support (-v and --version)', () => {
    const dogfoodScript = path.join(ROOT_DIR, 'scripts', 'dogfood-review.mjs');
    const selfReviewScript = path.join(ROOT_DIR, 'scripts', 'self-review.mjs');
    const ciScript = path.join(ROOT_DIR, 'scripts', 'ci-action.mjs');

    it('dogfood-review.mjs prints version with --version', async () => {
      const { stdout } = await execFileAsync(process.execPath, [dogfoodScript, '--version']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('dogfood-review.mjs prints version with -v', async () => {
      const { stdout } = await execFileAsync(process.execPath, [dogfoodScript, '-v']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('self-review.mjs prints version with --version', async () => {
      const { stdout } = await execFileAsync(process.execPath, [selfReviewScript, '--version']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('self-review.mjs prints version with -v', async () => {
      const { stdout } = await execFileAsync(process.execPath, [selfReviewScript, '-v']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('ci-action.mjs prints version with --version', async () => {
      const { stdout } = await execFileAsync(process.execPath, [ciScript, '--version']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('ci-action.mjs prints version with -v', async () => {
      const { stdout } = await execFileAsync(process.execPath, [ciScript, '-v']);
      assert.match(stdout, new RegExp(`gem-pr-review v${VERSION}`));
    });
  });

  describe('Conventional Commit Parsing & SemVer Determination', () => {
    it('parses standard conventional commits', () => {
      const parsedFeat = parseConventionalCommit('feat: add custom specialist review roles (#24)');
      assert.equal(parsedFeat.type, 'feat');
      assert.equal(parsedFeat.scope, null);
      assert.equal(parsedFeat.isBreaking, false);
      assert.equal(parsedFeat.description, 'add custom specialist review roles (#24)');
      assert.equal(parsedFeat.prNumber, 24);

      const parsedScopedFix = parseConventionalCommit('fix(diff): prevent off-by-one in hunk anchor boundary');
      assert.equal(parsedScopedFix.type, 'fix');
      assert.equal(parsedScopedFix.scope, 'diff');
      assert.equal(parsedScopedFix.isBreaking, false);
      assert.equal(parsedScopedFix.description, 'prevent off-by-one in hunk anchor boundary');
    });

    it('detects breaking changes via exclamation mark in subject', () => {
      const parsed = parseConventionalCommit('feat(api)!: overhaul reviewer orchestrator interface');
      assert.equal(parsed.type, 'feat');
      assert.equal(parsed.scope, 'api');
      assert.equal(parsed.isBreaking, true);
    });

    it('detects breaking changes via BREAKING CHANGE footer', () => {
      const message = `refactor(config): restructure tier format

BREAKING CHANGE: tiers configuration now requires an object with light, medium, heavy keys.`;
      const parsed = parseConventionalCommit(message);
      assert.equal(parsed.type, 'refactor');
      assert.equal(parsed.isBreaking, true);
      assert.match(parsed.breakingDescription, /tiers configuration now requires/);
    });

    it('determines SemVer bump priority: major > minor > patch', () => {
      const commitsWithBreaking = [
        { type: 'feat', isBreaking: false },
        { type: 'fix', isBreaking: false },
        { type: 'chore', isBreaking: true },
      ];
      assert.equal(determineSemverBump(commitsWithBreaking).bump, 'major');

      const commitsWithFeat = [
        { type: 'fix', isBreaking: false },
        { type: 'feat', isBreaking: false },
        { type: 'docs', isBreaking: false },
      ];
      assert.equal(determineSemverBump(commitsWithFeat).bump, 'minor');

      const commitsWithFix = [
        { type: 'fix', isBreaking: false },
        { type: 'docs', isBreaking: false },
      ];
      assert.equal(determineSemverBump(commitsWithFix).bump, 'patch');

      const commitsWithChoreOnly = [
        { type: 'chore', isBreaking: false },
        { type: 'docs', isBreaking: false },
      ];
      assert.equal(determineSemverBump(commitsWithChoreOnly).bump, 'patch');

      assert.equal(determineSemverBump([]).bump, null);
    });

    it('calculates next SemVer version correctly', () => {
      assert.equal(calculateNextVersion('0.1.0', 'patch'), '0.1.1');
      assert.equal(calculateNextVersion('0.1.0', 'minor'), '0.2.0');
      assert.equal(calculateNextVersion('0.1.0', 'major'), '1.0.0');
      assert.equal(calculateNextVersion('1.2.3', 'patch'), '1.2.4');
      assert.equal(calculateNextVersion('1.2.3', 'minor'), '1.3.0');
      assert.equal(calculateNextVersion('1.2.3', 'major'), '2.0.0');
      assert.equal(calculateNextVersion('0.1.0', '0.5.0'), '0.5.0');

      assert.throws(() => calculateNextVersion('0.1.0', 'invalid'), /Invalid bump type or version/);
    });

    it('generates categorized changelog entries', () => {
      const commits = [
        parseConventionalCommit('feat(subagents): support custom reviewer roles (#24)'),
        parseConventionalCommit('fix(publish): normalize double-escaped newlines'),
        parseConventionalCommit('docs: update usage documentation'),
        parseConventionalCommit('feat(api)!: remove deprecated method\n\nBREAKING CHANGE: removed old method'),
      ];

      const changelog = generateChangelog({
        version: '0.2.0',
        previousVersion: '0.1.0',
        commits,
        date: '2026-09-11',
      });

      assert.match(changelog, /## \[0\.2\.0\] - 2026-09-11/);
      assert.match(changelog, /### ⚠️ Breaking Changes/);
      assert.match(changelog, /### 🚀 Features/);
      assert.match(changelog, /### 🐛 Bug Fixes/);
      assert.match(changelog, /### 📝 Documentation/);
      assert.match(changelog, /support custom reviewer roles/);
      assert.match(changelog, /normalize double-escaped newlines/);
    });
  });

  describe('Atomic Manifest Bump Utility', () => {
    it('synchronizes and updates all 4 manifest files atomically', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-manifest-'));
      try {
        // Copy 4 manifest files to tempDir
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-pkg', version: '0.1.0' }, null, 2));
        fs.writeFileSync(path.join(tempDir, 'plugin.json'), JSON.stringify({ name: 'gem-pr-review', version: '0.1.0' }, null, 2));
        fs.writeFileSync(path.join(tempDir, 'mcp.json'), JSON.stringify({ name: 'gem-pr-review', version: '0.1.0' }, null, 2));
        fs.mkdirSync(path.join(tempDir, 'skills', 'gem-pr-review'), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, 'skills', 'gem-pr-review', 'SKILL.md'),
          '---\nname: gem-pr-review\nmetadata:\n  version: "0.1.0"\n---\n# Skill'
        );

        // Perform bump to 0.2.0
        const result = bumpManifestVersions({
          newVersion: '0.2.0',
          rootDir: tempDir,
        });

        assert.equal(result.success, true);
        assert.equal(result.newVersion, '0.2.0');
        assert.equal(result.previousVersion, '0.1.0');

        // Verify all 4 files were updated
        const updatedPackage = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
        const updatedPlugin = JSON.parse(fs.readFileSync(path.join(tempDir, 'plugin.json'), 'utf8'));
        const updatedMcp = JSON.parse(fs.readFileSync(path.join(tempDir, 'mcp.json'), 'utf8'));
        const updatedSkill = fs.readFileSync(path.join(tempDir, 'skills', 'gem-pr-review', 'SKILL.md'), 'utf8');

        assert.equal(updatedPackage.version, '0.2.0');
        assert.equal(updatedPlugin.version, '0.2.0');
        assert.equal(updatedMcp.version, '0.2.0');
        assert.match(updatedSkill, /version:\s*"0\.2\.0"/);

        // Verify manifest sync passes
        const syncCheck = checkManifestSync(tempDir);
        assert.equal(syncCheck.inSync, true);
        assert.equal(syncCheck.version, '0.2.0');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('supports dry-run without writing files', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-manifest-dry-'));
      try {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ version: '0.1.0' }, null, 2));
        fs.writeFileSync(path.join(tempDir, 'plugin.json'), JSON.stringify({ version: '0.1.0' }, null, 2));
        fs.writeFileSync(path.join(tempDir, 'mcp.json'), JSON.stringify({ version: '0.1.0' }, null, 2));
        fs.mkdirSync(path.join(tempDir, 'skills', 'gem-pr-review'), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, 'skills', 'gem-pr-review', 'SKILL.md'),
          '---\nmetadata:\n  version: "0.1.0"\n---\n'
        );

        const result = bumpManifestVersions({
          newVersion: '0.3.0',
          rootDir: tempDir,
          dryRun: true,
        });

        assert.equal(result.success, true);
        assert.equal(result.dryRun, true);

        // Verify files were not modified
        const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
        assert.equal(pkg.version, '0.1.0');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects invalid SemVer version strings', () => {
      assert.throws(
        () => bumpManifestVersions({ newVersion: 'invalid-semver', rootDir: ROOT_DIR }),
        /Invalid SemVer version string/
      );
    });
  });

  describe('scripts/bump-version.mjs CLI Utility', () => {
    const bumpScript = path.join(ROOT_DIR, 'scripts', 'bump-version.mjs');

    it('prints version with --version and -v', async () => {
      const { stdout: stdoutLong } = await execFileAsync(process.execPath, [bumpScript, '--version']);
      assert.match(stdoutLong, new RegExp(`gem-pr-review v${VERSION}`));

      const { stdout: stdoutShort } = await execFileAsync(process.execPath, [bumpScript, '-v']);
      assert.match(stdoutShort, new RegExp(`gem-pr-review v${VERSION}`));
    });

    it('displays usage instructions with --help', async () => {
      const { stdout } = await execFileAsync(process.execPath, [bumpScript, '--help']);
      assert.match(stdout, /Usage: node scripts\/bump-version\.mjs/);
      assert.match(stdout, /--check/);
      assert.match(stdout, /--dry-run/);
      assert.match(stdout, /--changelog/);
    });

    it('--check verifies repository manifests and exits 0 when synced', async () => {
      const { stdout } = await execFileAsync(process.execPath, [bumpScript, '--check']);
      assert.match(stdout, /All manifests are synchronized at version/);
    });

    it('supports dry-run bump without altering repository manifests', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        bumpScript,
        'patch',
        '--dry-run',
        '--changelog',
      ]);
      assert.match(stdout, /Bumping version: 0\.1\.0 -> 0\.1\.1 \(DRY-RUN\)/);
      assert.match(stdout, /Dry-run completed\. No files modified\./);

      // Verify canonical package.json was not modified
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
      assert.equal(pkg.version, '0.1.0');
    });

    it('supports auto SemVer calculation with --dry-run', async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        bumpScript,
        'auto',
        '--dry-run',
      ]);
      assert.match(stdout, /Analyzed \d+ commit\(s\)/);
      assert.match(stdout, /Determined bump:/);
      assert.match(stdout, /Dry-run completed/);
    });
  });
});
