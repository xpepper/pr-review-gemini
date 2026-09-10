import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Agent Skill: gem-pr-review (Agent Plugins 1.0)', () => {
  const skillPath = path.resolve('skills/gem-pr-review/SKILL.md');

  it('skill file exists at skills/gem-pr-review/SKILL.md', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md should exist');
  });

  it('contains valid YAML frontmatter with name and description', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch, 'SKILL.md must start with YAML frontmatter delimited by ---');

    const frontmatter = frontmatterMatch[1];
    assert.match(frontmatter, /^name:\s*gem-pr-review\b/m, 'Frontmatter must have name: gem-pr-review');
    assert.match(frontmatter, /^description:\s*.+/m, 'Frontmatter must have a description');
  });

  it('documents all review modes: balanced, quick, full, deep', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');

    assert.ok(content.includes('--balanced') || content.includes('balanced'), 'Should document balanced mode');
    assert.ok(content.includes('--quick') || content.includes('quick'), 'Should document quick mode');
    assert.ok(content.includes('--full') || content.includes('full'), 'Should document full mode');
    assert.ok(content.includes('--deep') || content.includes('deep'), 'Should document deep mode');
  });

  it('documents specialist lenses and structured findings contract', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');

    // Specialist lenses
    assert.match(content, /correctness/i, 'Should document correctness lens');
    assert.match(content, /security/i, 'Should document security lens');
    assert.match(content, /performance/i, 'Should document performance lens');

    // Structured findings contract
    assert.match(content, /P0/i, 'Should mention P0 severity');
    assert.match(content, /P1/i, 'Should mention P1 severity');
    assert.match(content, /P2/i, 'Should mention P2 severity');
    assert.match(content, /confidence/i, 'Should mention confidence scoring');
    assert.match(content, /host-gated/i, 'Should mention host-gated publishing');
  });

  it('documents incremental re-reviews and prior findings revalidation', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes('--incremental') || content.includes('incremental'), 'Should document incremental mode');
    assert.match(content, /revalidation|revalidate/i, 'Should document finding revalidation');
    assert.match(content, /resolved/i, 'Should document resolved status');
    assert.match(content, /still open/i, 'Should document still open status');
  });

  it('does not contain local machine absolute paths (security rule)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.doesNotMatch(content, /\/Users\//, 'Must not expose /Users/ machine paths');
    assert.doesNotMatch(content, /\/home\//, 'Must not expose /home/ machine paths');
  });

  it('documents large-diff transport and host-supervised reader tools', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /200\s*KB/i, 'Should document 200 KB threshold');
    assert.match(content, /file-backed/i, 'Should document file-backed transport');
    assert.match(content, /manifest/i, 'Should document changed-file manifest');
    assert.match(content, /diff_read|read/i, 'Should document read tool');
    assert.match(content, /diff_grep|grep/i, 'Should document grep tool');
    assert.match(content, /diff_find|find/i, 'Should document find tool');
    assert.match(content, /640\s*KB/i, 'Should document 640 KB budget');
  });
});
