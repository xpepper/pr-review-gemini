import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_GUIDELINE_FILENAMES,
  MAX_GUIDELINES_BYTES,
  discoverGuidelinesFile,
  readGuidelinesFile,
  parseGuidelines,
  resolveGuidelinesForLens,
  loadGuidelines,
} from '../src/guidelines.js';

describe('Repository Review Guidelines & Project Memory (Increment 19)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-guidelines-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Discovery & Path Resolution', () => {
    it('defines default filenames in priority order', () => {
      assert.deepEqual(DEFAULT_GUIDELINE_FILENAMES, [
        '.github/gem-pr-review.md',
        '.github/review-instructions.md',
      ]);
    });

    it('discovers .github/gem-pr-review.md when present in repository root', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      fs.writeFileSync(path.join(githubDir, 'gem-pr-review.md'), '# Repo Rules\n- Rule 1');

      const found = discoverGuidelinesFile({ cwd: tmpDir });
      assert.ok(found);
      assert.equal(found, path.join(githubDir, 'gem-pr-review.md'));
    });

    it('falls back to .github/review-instructions.md if gem-pr-review.md is absent', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      fs.writeFileSync(path.join(githubDir, 'review-instructions.md'), '# Copilot Review Rules');

      const found = discoverGuidelinesFile({ cwd: tmpDir });
      assert.ok(found);
      assert.equal(found, path.join(githubDir, 'review-instructions.md'));
    });

    it('prefers .github/gem-pr-review.md over review-instructions.md if both exist', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      fs.writeFileSync(path.join(githubDir, 'gem-pr-review.md'), '# Canonical Rules');
      fs.writeFileSync(path.join(githubDir, 'review-instructions.md'), '# Secondary Rules');

      const found = discoverGuidelinesFile({ cwd: tmpDir });
      assert.equal(found, path.join(githubDir, 'gem-pr-review.md'));
    });

    it('resolves configured custom path (relative or absolute)', () => {
      const customDir = path.join(tmpDir, 'docs');
      fs.mkdirSync(customDir, { recursive: true });
      const customFile = path.join(customDir, 'arch-rules.md');
      fs.writeFileSync(customFile, '# Architecture Rules');

      // Relative path
      const foundRel = discoverGuidelinesFile({ cwd: tmpDir, customPath: 'docs/arch-rules.md' });
      assert.equal(foundRel, customFile);

      // Absolute path
      const foundAbs = discoverGuidelinesFile({ cwd: tmpDir, customPath: customFile });
      assert.equal(foundAbs, customFile);
    });

    it('returns null if guidelines file does not exist', () => {
      const found = discoverGuidelinesFile({ cwd: tmpDir });
      assert.equal(found, null);

      const foundCustom = discoverGuidelinesFile({ cwd: tmpDir, customPath: 'non-existent.md' });
      assert.equal(foundCustom, null);
    });
  });

  describe('Reading & Size Bounding', () => {
    it('reads guideline file content and calculates size and relative path', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      const filePath = path.join(githubDir, 'gem-pr-review.md');
      const content = '# Project Review Guidelines\n- Always validate untrusted input.';
      fs.writeFileSync(filePath, content, 'utf8');

      const result = readGuidelinesFile(filePath, { cwd: tmpDir });
      assert.equal(result.content, content);
      assert.equal(result.byteSize, Buffer.byteLength(content, 'utf8'));
      assert.equal(result.truncated, false);
      assert.equal(result.relativePath, '.github/gem-pr-review.md');
    });

    it('truncates guidelines when exceeding maxBytes and appends warning note', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      const filePath = path.join(githubDir, 'gem-pr-review.md');
      const largeContent = 'A'.repeat(500);
      fs.writeFileSync(filePath, largeContent, 'utf8');

      const result = readGuidelinesFile(filePath, { maxBytes: 100, cwd: tmpDir });
      assert.equal(result.truncated, true);
      assert.equal(result.byteSize, 500);
      assert.match(result.content, /^A{100}/);
      assert.match(result.content, /Guidelines truncated: file size \(500 bytes\) exceeded maximum allowed limit of 100 bytes/);
    });

    it('handles non-existent or unreadable file gracefully', () => {
      const result = readGuidelinesFile(path.join(tmpDir, 'does-not-exist.md'), { cwd: tmpDir });
      assert.equal(result.content, '');
      assert.equal(result.byteSize, 0);
      assert.equal(result.truncated, false);
      assert.equal(result.found, false);
    });
  });

  describe('Markdown Section-Based Parsing & Lens Resolution', () => {
    const sampleMarkdown = `# Repository Review Guidelines

General codebase rules:
- Invariant 1: All public APIs must validate parameters.
- Invariant 2: No raw console.log in production code.

## Lens: Security
- Review for OWASP Top 10 vulnerabilities.
- Ensure all route handlers have authentication middleware.

## Role: Performance
- Ensure cache keys have appropriate TTLs.
- Avoid N+1 queries.

## Conventions
- Follow conventional commits for all git messages.
- Clean code and DRY abstractions.
`;

    it('parses global and lens-specific sections', () => {
      const parsed = parseGuidelines(sampleMarkdown);

      assert.ok(parsed.global.includes('General codebase rules:'));
      assert.ok(parsed.global.includes('Invariant 1: All public APIs must validate parameters.'));

      assert.ok(parsed.lenses.security);
      assert.ok(parsed.lenses.security.includes('OWASP Top 10'));

      assert.ok(parsed.lenses.performance);
      assert.ok(parsed.lenses.performance.includes('cache keys have appropriate TTLs'));

      assert.ok(parsed.lenses.conventions);
      assert.ok(parsed.lenses.conventions.includes('conventional commits'));
    });

    it('resolves guidelines for specific lens including global rules + lens-specific instructions', () => {
      const parsed = parseGuidelines(sampleMarkdown);

      const securityGuidance = resolveGuidelinesForLens({
        parsed,
        lensId: 'security',
        lensName: 'Security & Trust Boundaries',
      });

      // Contains global rules
      assert.ok(securityGuidance.includes('General codebase rules:'));
      assert.ok(securityGuidance.includes('Invariant 1: All public APIs must validate parameters.'));

      // Contains security-specific instructions
      assert.ok(securityGuidance.includes('Specific Instructions for Security & Trust Boundaries'));
      assert.ok(securityGuidance.includes('OWASP Top 10'));

      // Does NOT contain performance-specific instructions
      assert.ok(!securityGuidance.includes('cache keys have appropriate TTLs'));
    });

    it('returns only global rules when a lens has no specific section', () => {
      const parsed = parseGuidelines(sampleMarkdown);

      const correctnessGuidance = resolveGuidelinesForLens({
        parsed,
        lensId: 'correctness',
        lensName: 'Correctness & Concurrency',
      });

      assert.ok(correctnessGuidance.includes('General codebase rules:'));
      assert.ok(!correctnessGuidance.includes('Specific Instructions for'));
    });

    it('treats entire document as global if no lens-specific headings exist', () => {
      const plainMarkdown = `### Coding Standards
- Standard 1
- Standard 2
`;
      const parsed = parseGuidelines(plainMarkdown);
      assert.equal(Object.keys(parsed.lenses).length, 0);
      assert.ok(parsed.global.includes('Standard 1'));

      const guidance = resolveGuidelinesForLens({ parsed, lensId: 'security' });
      assert.ok(guidance.includes('Standard 1'));
    });
  });

  describe('loadGuidelines High-Level Loader', () => {
    it('returns disabled status when config.guidelines.enabled is false', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      fs.writeFileSync(path.join(githubDir, 'gem-pr-review.md'), '# Rules');

      const loaded = loadGuidelines({
        cwd: tmpDir,
        config: { guidelines: { enabled: false } },
      });

      assert.equal(loaded.enabled, false);
      assert.equal(loaded.found, false);
      assert.equal(loaded.content, '');
    });

    it('loads and parses repository guidelines when present', () => {
      const githubDir = path.join(tmpDir, '.github');
      fs.mkdirSync(githubDir, { recursive: true });
      const content = '# Team Rules\n- Rule A\n\n## Lens: Security\n- Security Rule';
      fs.writeFileSync(path.join(githubDir, 'gem-pr-review.md'), content);

      const loaded = loadGuidelines({ cwd: tmpDir });
      assert.equal(loaded.enabled, true);
      assert.equal(loaded.found, true);
      assert.equal(loaded.relativePath, '.github/gem-pr-review.md');
      assert.equal(loaded.truncated, false);

      const secRules = loaded.formatForLens('security', { lensName: 'Security & Trust Boundaries' });
      assert.ok(secRules.includes('Rule A'));
      assert.ok(secRules.includes('Security Rule'));
    });

    it('loads configured custom guidelines path', () => {
      const docsDir = path.join(tmpDir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'custom-rules.md'), '# Custom Rules\n- Rule 42');

      const loaded = loadGuidelines({
        cwd: tmpDir,
        guidelinesPath: 'docs/custom-rules.md',
      });

      assert.equal(loaded.found, true);
      assert.equal(loaded.relativePath, 'docs/custom-rules.md');
      assert.ok(loaded.rawContent.includes('Rule 42'));
    });

    it('returns found: false when guidelines file is absent without throwing', () => {
      const loaded = loadGuidelines({ cwd: tmpDir });
      assert.equal(loaded.enabled, true);
      assert.equal(loaded.found, false);
      assert.equal(loaded.relativePath, null);
      assert.equal(loaded.content, '');
      assert.equal(loaded.formatForLens('security'), '');
    });
  });
});
