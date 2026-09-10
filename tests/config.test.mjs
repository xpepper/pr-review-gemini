import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_CONFIG,
  VALID_REVIEW_MODES,
  VALID_REASONING_EFFORTS,
  VALID_APPROVE_MAX_PRIORITY_LEVELS,
  resolveConfig,
  loadConfig,
  getModelForTier,
  getReasoningEffortForTier,
} from '../src/config.js';

describe('Configuration & Model Tier Management', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-config-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('DEFAULT_CONFIG and constants', () => {
    it('provides sensible default configuration values', () => {
      assert.equal(DEFAULT_CONFIG.defaultReviewMode, 'balanced');
      assert.equal(DEFAULT_CONFIG.autoPostReviews, false);
      assert.equal(DEFAULT_CONFIG.approveMaxPriorityLevel, 'off');

      assert.deepEqual(DEFAULT_CONFIG.tiers, {
        light: 'claude-3.5-haiku',
        medium: 'claude-3.5-sonnet',
        heavy: 'claude-3.7-sonnet',
      });

      assert.deepEqual(DEFAULT_CONFIG.reasoningEfforts, {
        light: 'off',
        medium: 'off',
        heavy: 'medium',
      });
    });

    it('defines valid allowed option sets', () => {
      assert.deepEqual(VALID_REVIEW_MODES, ['balanced', 'quick', 'full', 'deep']);
      assert.deepEqual(VALID_REASONING_EFFORTS, ['off', 'low', 'medium', 'high']);
      assert.deepEqual(VALID_APPROVE_MAX_PRIORITY_LEVELS, ['off', 'P2', 'P3', 'nit']);
    });
  });

  describe('resolveConfig (pure resolution)', () => {
    it('returns default configuration when given empty or null inputs', () => {
      const config = resolveConfig();
      assert.deepEqual(config, DEFAULT_CONFIG);

      const configWithNulls = resolveConfig({ userConfig: null, projectConfig: null });
      assert.deepEqual(configWithNulls, DEFAULT_CONFIG);
    });

    it('overlays user configuration over defaults', () => {
      const userConfig = {
        defaultReviewMode: 'quick',
        autoPostReviews: true,
        tiers: {
          light: 'custom-haiku',
        },
        reasoningEfforts: {
          heavy: 'high',
        },
      };

      const resolved = resolveConfig({ userConfig });

      assert.equal(resolved.defaultReviewMode, 'quick');
      assert.equal(resolved.autoPostReviews, true);
      assert.equal(resolved.approveMaxPriorityLevel, 'off');
      assert.deepEqual(resolved.tiers, {
        light: 'custom-haiku',
        medium: 'claude-3.5-sonnet',
        heavy: 'claude-3.7-sonnet',
      });
      assert.deepEqual(resolved.reasoningEfforts, {
        light: 'off',
        medium: 'off',
        heavy: 'high',
      });
    });

    it('allows project configuration to override user configuration (trusted overlay)', () => {
      const userConfig = {
        defaultReviewMode: 'quick',
        autoPostReviews: true,
        approveMaxPriorityLevel: 'nit',
        tiers: {
          light: 'user-light',
          medium: 'user-medium',
          heavy: 'user-heavy',
        },
        reasoningEfforts: {
          medium: 'low',
          heavy: 'low',
        },
      };

      const projectConfig = {
        defaultReviewMode: 'full',
        autoPostReviews: false,
        approveMaxPriorityLevel: 'P2',
        tiers: {
          medium: 'project-medium',
        },
        reasoningEfforts: {
          heavy: 'high',
        },
      };

      const resolved = resolveConfig({ userConfig, projectConfig });

      assert.equal(resolved.defaultReviewMode, 'full');
      assert.equal(resolved.autoPostReviews, false);
      assert.equal(resolved.approveMaxPriorityLevel, 'P2');
      assert.deepEqual(resolved.tiers, {
        light: 'user-light',
        medium: 'project-medium',
        heavy: 'user-heavy',
      });
      assert.deepEqual(resolved.reasoningEfforts, {
        light: 'off',
        medium: 'low',
        heavy: 'high',
      });
    });

    it('applies overrides as highest precedence', () => {
      const userConfig = { defaultReviewMode: 'quick' };
      const projectConfig = { defaultReviewMode: 'balanced' };
      const overrides = { defaultReviewMode: 'deep' };

      const resolved = resolveConfig({ userConfig, projectConfig, overrides });
      assert.equal(resolved.defaultReviewMode, 'deep');
    });

    it('falls back to defaults when invalid enum values or types are provided', () => {
      const malformedConfig = {
        defaultReviewMode: 'ultra-speed',
        autoPostReviews: 'yes-please',
        approveMaxPriorityLevel: 'P0',
        tiers: {
          light: '',
          medium: 123,
          heavy: null,
        },
        reasoningEfforts: {
          light: 'ultra',
          medium: null,
          heavy: 99,
        },
      };

      const resolved = resolveConfig({ userConfig: malformedConfig });
      assert.deepEqual(resolved, DEFAULT_CONFIG);
    });

    it('ignores non-object configurations gracefully', () => {
      assert.deepEqual(resolveConfig({ userConfig: 'invalid-string' }), DEFAULT_CONFIG);
      assert.deepEqual(resolveConfig({ userConfig: [1, 2, 3] }), DEFAULT_CONFIG);
      assert.deepEqual(resolveConfig({ projectConfig: 42 }), DEFAULT_CONFIG);
    });
  });

  describe('loadConfig (filesystem resolution)', () => {
    it('returns default config when both user and project files are absent', () => {
      const homeDir = path.join(tmpDir, 'home');
      const cwd = path.join(tmpDir, 'project');
      fs.mkdirSync(homeDir, { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });

      const config = loadConfig({ homeDir, cwd });
      assert.deepEqual(config, DEFAULT_CONFIG);
    });

    it('loads and overlays user configuration from ~/.copilot/pr-review.json', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });

      fs.writeFileSync(
        path.join(userCopilotDir, 'pr-review.json'),
        JSON.stringify({
          defaultReviewMode: 'quick',
          tiers: { light: 'custom-haiku-user' },
        })
      );

      const cwd = path.join(tmpDir, 'project');
      fs.mkdirSync(cwd, { recursive: true });

      const config = loadConfig({ homeDir, cwd });
      assert.equal(config.defaultReviewMode, 'quick');
      assert.equal(config.tiers.light, 'custom-haiku-user');
      assert.equal(config.tiers.medium, DEFAULT_CONFIG.tiers.medium);
    });

    it('overlays project configuration from .github/pr-review.json', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });

      fs.writeFileSync(
        path.join(userCopilotDir, 'pr-review.json'),
        JSON.stringify({
          defaultReviewMode: 'quick',
          tiers: { light: 'user-light', heavy: 'user-heavy' },
          reasoningEfforts: { heavy: 'low' },
        })
      );

      const cwd = path.join(tmpDir, 'project');
      const projectGithubDir = path.join(cwd, '.github');
      fs.mkdirSync(projectGithubDir, { recursive: true });

      fs.writeFileSync(
        path.join(projectGithubDir, 'pr-review.json'),
        JSON.stringify({
          defaultReviewMode: 'full',
          tiers: { heavy: 'project-heavy' },
          reasoningEfforts: { heavy: 'high' },
        })
      );

      const config = loadConfig({ homeDir, cwd });
      assert.equal(config.defaultReviewMode, 'full');
      assert.equal(config.tiers.light, 'user-light');
      assert.equal(config.tiers.heavy, 'project-heavy');
      assert.equal(config.reasoningEfforts.heavy, 'high');
    });

    it('loads configuration from gem-pr-review.json with priority over pr-review.json', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });

      // Write fallback
      fs.writeFileSync(
        path.join(userCopilotDir, 'pr-review.json'),
        JSON.stringify({ defaultReviewMode: 'quick' })
      );
      // Write prioritized gem-pr-review.json
      fs.writeFileSync(
        path.join(userCopilotDir, 'gem-pr-review.json'),
        JSON.stringify({ defaultReviewMode: 'deep' })
      );

      const cwd = path.join(tmpDir, 'project');
      const projectGithubDir = path.join(cwd, '.github');
      fs.mkdirSync(projectGithubDir, { recursive: true });

      fs.writeFileSync(
        path.join(projectGithubDir, 'pr-review.json'),
        JSON.stringify({ tiers: { light: 'fallback-light' } })
      );
      fs.writeFileSync(
        path.join(projectGithubDir, 'gem-pr-review.json'),
        JSON.stringify({ tiers: { light: 'gem-light' } })
      );

      const config = loadConfig({ homeDir, cwd });
      assert.equal(config.defaultReviewMode, 'deep');
      assert.equal(config.tiers.light, 'gem-light');
    });

    it('handles explicit userConfigPath and projectConfigPath options', () => {
      const userPath = path.join(tmpDir, 'custom-user.json');
      const projectPath = path.join(tmpDir, 'custom-project.json');

      fs.writeFileSync(userPath, JSON.stringify({ defaultReviewMode: 'quick' }));
      fs.writeFileSync(projectPath, JSON.stringify({ defaultReviewMode: 'deep' }));

      const config = loadConfig({
        userConfigPath: userPath,
        projectConfigPath: projectPath,
      });

      assert.equal(config.defaultReviewMode, 'deep');
    });

    it('handles malformed JSON in user or project files gracefully', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });
      fs.writeFileSync(path.join(userCopilotDir, 'pr-review.json'), '{ malformed json: true, ');

      const cwd = path.join(tmpDir, 'project');
      const projectGithubDir = path.join(cwd, '.github');
      fs.mkdirSync(projectGithubDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectGithubDir, 'pr-review.json'),
        JSON.stringify({ defaultReviewMode: 'full' })
      );

      const config = loadConfig({ homeDir, cwd });
      assert.equal(config.defaultReviewMode, 'full');
      assert.equal(config.tiers.light, DEFAULT_CONFIG.tiers.light);
    });

    it('handles malformed JSON in project file gracefully', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });
      fs.writeFileSync(
        path.join(userCopilotDir, 'pr-review.json'),
        JSON.stringify({ defaultReviewMode: 'quick' })
      );

      const cwd = path.join(tmpDir, 'project');
      const projectGithubDir = path.join(cwd, '.github');
      fs.mkdirSync(projectGithubDir, { recursive: true });
      fs.writeFileSync(path.join(projectGithubDir, 'pr-review.json'), 'NOT JSON AT ALL');

      const config = loadConfig({ homeDir, cwd });
      assert.equal(config.defaultReviewMode, 'quick');
    });
  });

  describe('Tier helper functions', () => {
    it('getModelForTier returns model name or throws on invalid tier', () => {
      const config = resolveConfig();
      assert.equal(getModelForTier(config, 'light'), 'claude-3.5-haiku');
      assert.equal(getModelForTier(config, 'medium'), 'claude-3.5-sonnet');
      assert.equal(getModelForTier(config, 'heavy'), 'claude-3.7-sonnet');

      assert.throws(() => getModelForTier(config, 'invalidTier'), {
        name: 'Error',
        message: /Unknown tier: invalidTier/,
      });
    });

    it('getReasoningEffortForTier returns reasoning effort or throws on invalid tier', () => {
      const config = resolveConfig();
      assert.equal(getReasoningEffortForTier(config, 'light'), 'off');
      assert.equal(getReasoningEffortForTier(config, 'medium'), 'off');
      assert.equal(getReasoningEffortForTier(config, 'heavy'), 'medium');

      assert.throws(() => getReasoningEffortForTier(config, 'invalidTier'), {
        name: 'Error',
        message: /Unknown tier: invalidTier/,
      });
    });
  });
});
