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

  it('documents interactive finding selection and cached publish-later', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /interactive/i, 'Should document interactive finding selection');
    assert.match(content, /--all/i, 'Should document --all flag');
    assert.match(content, /--publish-cached|publish_cached/i, 'Should document publish-cached');
    assert.match(content, /gem_pr_review_publish_cached/i, 'Should document MCP tool gem_pr_review_publish_cached');
    assert.match(content, /freshness|stale/i, 'Should document head freshness / stale check');
  });

  it('documents automatic fallback model retry on quota errors and zero timeouts', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /fallback/i, 'Should document fallback model retry');
    assert.match(content, /quota|429|capacity/i, 'Should document quota/capacity error detection');
    assert.match(content, /timeout/i, 'Should document zero timeout execution');
  });

  it('documents one-shot coding-task self-review (gem_self_review) and fail-closed safety gate', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /gem_self_review/i, 'Should document gem_self_review');
    assert.match(content, /self-review/i, 'Should document self-review');
    assert.match(content, /fail-closed/i, 'Should document fail-closed safety gate');
    assert.match(content, /worktree/i, 'Should document local worktree diff acquisition');
    assert.match(content, /synthetic/i, 'Should document synthetic diffs for untracked files');
    assert.match(content, /scripts\/self-review\.mjs/i, 'Should document self-review script');
  });

  it('documents candidate finding recovery from degraded or malformed model output', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Candidate Finding Recovery/i, 'Should document candidate finding recovery');
    assert.match(content, /repairJsonString/i, 'Should mention repairJsonString');
    assert.match(content, /extractCandidateObjects/i, 'Should mention extractCandidateObjects');
    assert.match(content, /extractJsonEnvelope/i, 'Should mention extractJsonEnvelope');
    assert.match(content, /normalizeFindingCandidate/i, 'Should mention normalizeFindingCandidate');
  });

  it('documents reusable GitHub Action and automated CI review workflow (action.yml)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /action\.yml|GitHub Action/i, 'Should document action.yml or GitHub Action');
    assert.match(content, /fail_on/i, 'Should document fail_on input');
    assert.match(content, /synchronize/i, 'Should document synchronize event auto-detection');
    assert.match(content, /starter workflow|\.github\/workflows\/gem-pr-review\.yml/i, 'Should document starter workflow');
  });

  it('documents pluggable custom review roles and flexible role composition', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /custom_roles|custom review roles/i, 'Should document custom review roles');
    assert.match(content, /replace_standard_roles/i, 'Should document replace_standard_roles');
    assert.match(content, /enabled_roles/i, 'Should document enabled_roles');
    assert.match(content, /--role/i, 'Should document --role CLI flag');
    assert.match(content, /--replace-standard-roles/i, 'Should document --replace-standard-roles CLI flag');
    assert.match(content, /reasoningEffort/i, 'Should document reasoningEffort');
  });

  it('documents semantic versioning, release management, and manifest synchronization', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /semantic versioning|bump-version/i, 'Should document semantic versioning');
    assert.match(content, /bump-version\.mjs/i, 'Should mention scripts/bump-version.mjs');
    assert.match(content, /--version|-v/i, 'Should mention --version flag');
    assert.match(content, /manifest/i, 'Should mention manifest synchronization');
  });

  it('documents calibrated language-agnostic review checklists (Increment 16)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Where the argument breaks down/i, 'Should mention where the argument breaks down');
    assert.match(content, /Landing Surface Invariants/i, 'Should mention landing surface invariants');
    assert.match(content, /Ambient State Coupling/i, 'Should mention ambient state coupling');
    assert.match(content, /Data Exposure/i, 'Should mention data exposure');
    assert.match(content, /Redundant Work/i, 'Should mention redundant work');
    assert.match(content, /Dead Code & Phantom Logic/i, 'Should mention dead code and phantom logic');
    assert.match(content, /Single Source of Truth/i, 'Should mention single source of truth');
    assert.match(content, /Evidence Before Completion/i, 'Should mention evidence before completion');
  });

  it('documents model catalog auto fallback resilience and streamlined dogfood:pr command (Increment 16)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Model Catalog & Auto Fallback Resilience/i, 'Should document model catalog resilience');
    assert.match(content, /isModelUnavailableError/i, 'Should mention isModelUnavailableError');
    assert.match(content, /fallback_to_auto/i, 'Should mention fallback_to_auto setting');
    assert.match(content, /npm run dogfood:pr/i, 'Should document npm run dogfood:pr');
    assert.match(content, /scripts\/dogfood-pr\.mjs/i, 'Should document scripts/dogfood-pr.mjs');
    assert.match(content, /--model auto/i, 'Should document default --model auto');
  });

  it('documents Increment 16 calibration, resilience, and dogfood:pr in README.md', () => {
    const readmePath = path.resolve('README.md');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.match(readmeContent, /npm run dogfood:pr/i, 'README should document npm run dogfood:pr');
    assert.match(readmeContent, /Reviewer Sensitivity & Quality Calibration/i, 'README should document Reviewer Sensitivity & Quality Calibration');
    assert.match(readmeContent, /Model Catalog & Auto Fallback Resilience|Model Catalog Resilience/i, 'README should document model catalog resilience');
    assert.match(readmeContent, /fallback_to_auto/i, 'README should document fallback_to_auto');
  });

  it('documents centralized CLI infrastructure and pre-commit hook installer in SKILL.md (Increment 17)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Centralized CLI Infrastructure/i, 'Should document Centralized CLI Infrastructure');
    assert.match(content, /runIfDirect/i, 'Should document runIfDirect');
    assert.match(content, /handleCommonFlags/i, 'Should document handleCommonFlags');
    assert.match(content, /isDirectRun/i, 'Should document isDirectRun');
    assert.match(content, /npm run install-hook/i, 'Should document npm run install-hook');
    assert.match(content, /--install-hook/i, 'Should document --install-hook');
    assert.match(content, /--uninstall-hook/i, 'Should document --uninstall-hook');
  });

  it('documents centralized CLI infrastructure and pre-commit hook installer in README.md (Increment 17)', () => {
    const readmePath = path.resolve('README.md');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.match(readmeContent, /Centralized CLI Infrastructure/i, 'README should document Centralized CLI Infrastructure');
    assert.match(readmeContent, /npm run install-hook/i, 'README should document npm run install-hook');
    assert.match(readmeContent, /isDirectRun/i, 'README should document isDirectRun');
    assert.match(readmeContent, /runIfDirect/i, 'README should document runIfDirect');
    assert.doesNotMatch(readmeContent, /\/Users\//, 'README must not expose /Users/ machine paths');
    assert.doesNotMatch(readmeContent, /\/home\//, 'README must not expose /home/ machine paths');
  });
});


