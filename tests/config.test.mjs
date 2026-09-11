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
  getFallbackModelsForTier,
  getFallbackModels,
  getCustomRoles,
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
      assert.deepEqual(DEFAULT_CONFIG.fallbacks, {
        light: [],
        medium: [],
        heavy: [],
      });
      assert.deepEqual(DEFAULT_CONFIG.heavy_fallbacks, []);
      assert.deepEqual(DEFAULT_CONFIG.medium_fallbacks, []);
      assert.deepEqual(DEFAULT_CONFIG.light_fallbacks, []);
      assert.deepEqual(DEFAULT_CONFIG.lenses, {});
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

    it('parses valid per-lens configuration overrides', () => {
      const userConfig = {
        lenses: {
          correctness: {
            model: 'gpt-5.6-terra',
            reasoningEffort: 'high',
          },
          security: {
            model: 'claude-opus-5',
            reasoningEffort: 'high',
            tier: 'heavy',
          },
          conventions: {
            tier: 'medium',
          },
        },
      };

      const resolved = resolveConfig({ userConfig });
      assert.deepEqual(resolved.lenses, {
        correctness: {
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
        },
        security: {
          model: 'claude-opus-5',
          reasoningEffort: 'high',
          tier: 'heavy',
        },
        conventions: {
          tier: 'medium',
        },
      });
    });

    it('merges project-level and user-level lenses overrides', () => {
      const userConfig = {
        lenses: {
          correctness: {
            model: 'gpt-5.6-terra',
            reasoningEffort: 'medium',
          },
          security: {
            model: 'claude-opus-5',
          },
        },
      };

      const projectConfig = {
        lenses: {
          correctness: {
            reasoningEffort: 'high',
          },
          tests: {
            tier: 'heavy',
          },
        },
      };

      const resolved = resolveConfig({ userConfig, projectConfig });
      assert.deepEqual(resolved.lenses, {
        correctness: {
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
        },
        security: {
          model: 'claude-opus-5',
        },
        tests: {
          tier: 'heavy',
        },
      });
    });

    it('ignores malformed or invalid lens entries gracefully', () => {
      const malformedConfig = {
        lenses: {
          invalidEntry: null,
          notAnObject: 'invalid',
          emptyObject: {},
          invalidFields: {
            model: '',
            reasoningEffort: 'ultra',
            tier: 'super-heavy',
            unknownField: 42,
          },
          partiallyValid: {
            model: 'valid-model',
            reasoningEffort: 99,
            tier: 'invalid-tier',
          },
        },
      };

      const resolved = resolveConfig({ userConfig: malformedConfig });
      assert.deepEqual(resolved.lenses, {
        partiallyValid: {
          model: 'valid-model',
        },
      });
    });

    it('guards against prototype pollution keys in lenses', () => {
      const maliciousConfig = JSON.parse(`{
        "lenses": {
          "__proto__": { "polluted": true, "model": "evil" },
          "constructor": { "polluted": true, "model": "evil" },
          "prototype": { "polluted": true, "model": "evil" },
          "correctness": { "model": "safe-model" }
        }
      }`);

      const resolved = resolveConfig({ userConfig: maliciousConfig });
      assert.deepEqual(resolved.lenses, {
        correctness: {
          model: 'safe-model',
        },
      });
      assert.equal(Object.prototype.polluted, undefined);
    });

    it('resolves top-level tier fallback arrays (heavy_fallbacks, medium_fallbacks, light_fallbacks)', () => {
      const userConfig = {
        heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o'],
        medium_fallbacks: ['gpt-4o-mini'],
      };

      const resolved = resolveConfig({ userConfig });
      assert.deepEqual(resolved.heavy_fallbacks, ['claude-3.5-sonnet', 'gpt-4o']);
      assert.deepEqual(resolved.medium_fallbacks, ['gpt-4o-mini']);
      assert.deepEqual(resolved.light_fallbacks, []);
      assert.deepEqual(resolved.fallbacks, {
        heavy: ['claude-3.5-sonnet', 'gpt-4o'],
        medium: ['gpt-4o-mini'],
        light: [],
      });
    });

    it('resolves nested fallbacks object and merges with project configuration', () => {
      const userConfig = {
        fallbacks: {
          heavy: ['claude-3.5-sonnet', 'gpt-4o'],
          light: ['claude-3.5-haiku'],
        },
      };

      const projectConfig = {
        fallbacks: {
          heavy: ['gpt-4o', 'o3-mini'],
        },
        medium_fallbacks: ['custom-medium-fallback'],
      };

      const resolved = resolveConfig({ userConfig, projectConfig });
      assert.deepEqual(resolved.fallbacks.heavy, ['gpt-4o', 'o3-mini']);
      assert.deepEqual(resolved.heavy_fallbacks, ['gpt-4o', 'o3-mini']);
      assert.deepEqual(resolved.fallbacks.medium, ['custom-medium-fallback']);
      assert.deepEqual(resolved.medium_fallbacks, ['custom-medium-fallback']);
      assert.deepEqual(resolved.fallbacks.light, ['claude-3.5-haiku']);
      assert.deepEqual(resolved.light_fallbacks, ['claude-3.5-haiku']);
    });

    it('sanitizes fallback arrays by trimming and removing empty or invalid elements', () => {
      const userConfig = {
        heavy_fallbacks: ['  claude-3.5-sonnet  ', '', null, 42, 'gpt-4o', '   '],
        fallbacks: {
          medium: [' gpt-4o-mini ', undefined, false],
        },
      };

      const resolved = resolveConfig({ userConfig });
      assert.deepEqual(resolved.heavy_fallbacks, ['claude-3.5-sonnet', 'gpt-4o']);
      assert.deepEqual(resolved.fallbacks.heavy, ['claude-3.5-sonnet', 'gpt-4o']);
      assert.deepEqual(resolved.fallbacks.medium, ['gpt-4o-mini']);
    });

    it('parses and preserves per-lens fallbacks in lenses configuration', () => {
      const userConfig = {
        lenses: {
          correctness: {
            model: 'o3',
            fallbacks: ['claude-3.7-sonnet', 'gpt-4o'],
          },
          security: {
            fallbacks: ['claude-3.5-sonnet'],
          },
        },
      };

      const resolved = resolveConfig({ userConfig });
      assert.deepEqual(resolved.lenses.correctness.fallbacks, ['claude-3.7-sonnet', 'gpt-4o']);
      assert.deepEqual(resolved.lenses.security.fallbacks, ['claude-3.5-sonnet']);
    });

    it('resolves fallback_to_auto configuration setting with default true', () => {
      // Default is true
      const defaultConfig = resolveConfig();
      assert.equal(defaultConfig.fallback_to_auto, true);

      // Explicitly disabled via snake_case or camelCase
      const disabledSnake = resolveConfig({ userConfig: { fallback_to_auto: false } });
      assert.equal(disabledSnake.fallback_to_auto, false);

      const disabledCamel = resolveConfig({ userConfig: { fallbackToAuto: false } });
      assert.equal(disabledCamel.fallback_to_auto, false);

      const disabledAutoFallback = resolveConfig({ userConfig: { auto_fallback: false } });
      assert.equal(disabledAutoFallback.fallback_to_auto, false);

      // Explicitly enabled
      const enabled = resolveConfig({ userConfig: { fallback_to_auto: true } });
      assert.equal(enabled.fallback_to_auto, true);
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

    it('loads and merges lenses overrides from user and project files', () => {
      const homeDir = path.join(tmpDir, 'home');
      const userCopilotDir = path.join(homeDir, '.copilot');
      fs.mkdirSync(userCopilotDir, { recursive: true });

      fs.writeFileSync(
        path.join(userCopilotDir, 'gem-pr-review.json'),
        JSON.stringify({
          lenses: {
            correctness: { model: 'user-gpt', reasoningEffort: 'medium' },
            security: { model: 'user-claude' },
          },
        })
      );

      const cwd = path.join(tmpDir, 'project');
      const projectGithubDir = path.join(cwd, '.github');
      fs.mkdirSync(projectGithubDir, { recursive: true });

      fs.writeFileSync(
        path.join(projectGithubDir, 'gem-pr-review.json'),
        JSON.stringify({
          lenses: {
            correctness: { reasoningEffort: 'high' },
            performance: { tier: 'light' },
          },
        })
      );

      const config = loadConfig({ homeDir, cwd });
      assert.deepEqual(config.lenses, {
        correctness: { model: 'user-gpt', reasoningEffort: 'high' },
        security: { model: 'user-claude' },
        performance: { tier: 'light' },
      });
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

    it('accepts string argument as cwd in loadConfig for backward compatibility', () => {
      const cwd = path.join(tmpDir, 'project-str-cwd');
      const dotGithub = path.join(cwd, '.github');
      fs.mkdirSync(dotGithub, { recursive: true });
      fs.writeFileSync(
        path.join(dotGithub, 'gem-pr-review.json'),
        JSON.stringify({ tiers: { light: 'string-arg-model' } })
      );
      const config = loadConfig(cwd);
      assert.equal(config.tiers.light, 'string-arg-model');
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

    it('getFallbackModelsForTier returns fallback models or throws on invalid tier', () => {
      const config = resolveConfig({
        userConfig: {
          heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o'],
          fallbacks: {
            medium: ['gpt-4o-mini'],
          },
        },
      });

      assert.deepEqual(getFallbackModelsForTier(config, 'heavy'), ['claude-3.5-sonnet', 'gpt-4o']);
      assert.deepEqual(getFallbackModelsForTier(config, 'medium'), ['gpt-4o-mini']);
      assert.deepEqual(getFallbackModelsForTier(config, 'light'), []);

      assert.throws(() => getFallbackModelsForTier(config, 'unknownTier'), {
        name: 'Error',
        message: /Unknown tier: unknownTier/,
      });
    });

    it('getFallbackModels resolves per-lens fallbacks with fallback to tier fallbacks', () => {
      const config = resolveConfig({
        userConfig: {
          heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o'],
          lenses: {
            correctness: {
              fallbacks: ['custom-correctness-fallback'],
            },
          },
        },
      });

      // Lens override takes precedence
      assert.deepEqual(
        getFallbackModels(config, { tier: 'heavy', lensId: 'correctness' }),
        ['custom-correctness-fallback']
      );

      // Other lens falls back to tier fallbacks
      assert.deepEqual(
        getFallbackModels(config, { tier: 'heavy', lensId: 'security' }),
        ['claude-3.5-sonnet', 'gpt-4o']
      );

      // Missing tier defaults to empty array
      assert.deepEqual(
        getFallbackModels(config, { tier: 'light' }),
        []
      );
    });
  });

  describe('Custom Roles & Flexible Composition Configuration', () => {
    it('defines defaults for custom_roles, replace_standard_roles, and enabled_roles', () => {
      assert.deepEqual(DEFAULT_CONFIG.custom_roles, {});
      assert.equal(DEFAULT_CONFIG.replace_standard_roles, false);
      assert.deepEqual(DEFAULT_CONFIG.enabled_roles, []);
    });

    it('resolves valid custom_roles with prompt, model, reasoningEffort, and tier', () => {
      const config = resolveConfig({
        userConfig: {
          custom_roles: {
            accessibility: {
              name: 'Accessibility & WCAG',
              prompt: 'Evaluate WCAG 2.1 AA accessibility guidelines, semantic HTML, ARIA attributes...',
              model: 'claude-3.7-sonnet',
              reasoningEffort: 'medium',
              tier: 'heavy',
              fallbacks: ['gpt-4o'],
            },
          },
        },
      });

      assert.ok(config.custom_roles.accessibility);
      assert.equal(config.custom_roles.accessibility.name, 'Accessibility & WCAG');
      assert.equal(config.custom_roles.accessibility.prompt, 'Evaluate WCAG 2.1 AA accessibility guidelines, semantic HTML, ARIA attributes...');
      assert.equal(config.custom_roles.accessibility.model, 'claude-3.7-sonnet');
      assert.equal(config.custom_roles.accessibility.reasoningEffort, 'medium');
      assert.equal(config.custom_roles.accessibility.tier, 'heavy');
      assert.deepEqual(config.custom_roles.accessibility.fallbacks, ['gpt-4o']);
    });

    it('supports "roles" alias and "instructions" alias', () => {
      const config = resolveConfig({
        projectConfig: {
          roles: {
            migrations: {
              name: 'Database Migration Safety',
              instructions: 'Inspect database migrations for table locks and backwards compatibility.',
              model: 'gpt-4o',
            },
          },
        },
      });

      assert.ok(config.custom_roles.migrations);
      assert.equal(config.custom_roles.migrations.name, 'Database Migration Safety');
      assert.equal(config.custom_roles.migrations.prompt, 'Inspect database migrations for table locks and backwards compatibility.');
      assert.equal(config.custom_roles.migrations.instructions, 'Inspect database migrations for table locks and backwards compatibility.');
      assert.equal(config.custom_roles.migrations.model, 'gpt-4o');
    });

    it('supports camelCase configuration keys (customRoles, replaceStandardRoles, enabledRoles)', () => {
      const config = resolveConfig({
        overrides: {
          customRoles: {
            compliance: {
              prompt: 'Ensure GDPR and SOC2 compliance controls.',
            },
          },
          replaceStandardRoles: true,
          enabledRoles: ['compliance', 'security'],
        },
      });

      assert.ok(config.custom_roles.compliance);
      assert.equal(config.custom_roles.compliance.prompt, 'Ensure GDPR and SOC2 compliance controls.');
      assert.equal(config.replace_standard_roles, true);
      assert.deepEqual(config.enabled_roles, ['compliance', 'security']);
    });

    it('guards against prototype pollution keys in custom_roles', () => {
      const maliciousPayload = JSON.parse(`{
        "custom_roles": {
          "__proto__": { "prompt": "evil" },
          "prototype": { "prompt": "evil" },
          "constructor": { "prompt": "evil" },
          "valid_role": { "prompt": "Inspect safely." }
        }
      }`);

      const config = resolveConfig({ userConfig: maliciousPayload });
      assert.equal(config.custom_roles.__proto__.prompt, undefined);
      assert.equal(config.custom_roles.prototype, undefined);
      assert.equal(config.custom_roles.constructor?.prompt, undefined);
      assert.ok(config.custom_roles.valid_role);
      assert.equal(config.custom_roles.valid_role.prompt, 'Inspect safely.');
    });

    it('ignores invalid custom role definitions without prompt or instructions', () => {
      const config = resolveConfig({
        userConfig: {
          custom_roles: {
            invalidRole1: null,
            invalidRole2: 'not an object',
            invalidRole3: { model: 'gpt-4o' }, // missing prompt/instructions
            validRole: { prompt: 'Valid prompt.' },
          },
        },
      });

      assert.equal(config.custom_roles.invalidRole1, undefined);
      assert.equal(config.custom_roles.invalidRole2, undefined);
      assert.equal(config.custom_roles.invalidRole3, undefined);
      assert.ok(config.custom_roles.validRole);
    });

    it('sanitizes invalid reasoningEffort and tier on custom roles', () => {
      const config = resolveConfig({
        userConfig: {
          custom_roles: {
            testRole: {
              prompt: 'Review test coverage.',
              reasoningEffort: 'ultra-high-invalid',
              tier: 'super-tier-invalid',
            },
          },
        },
      });

      assert.ok(config.custom_roles.testRole);
      assert.equal(config.custom_roles.testRole.reasoningEffort, undefined);
      assert.equal(config.custom_roles.testRole.tier, undefined);
    });

    it('layers custom roles across user, project, and runtime overrides', () => {
      const userConfig = {
        custom_roles: {
          accessibility: {
            name: 'Accessibility Base',
            prompt: 'Base accessibility checks.',
            model: 'claude-3.5-haiku',
          },
          security_extra: {
            prompt: 'Extra security audit.',
          },
        },
      };

      const projectConfig = {
        custom_roles: {
          accessibility: {
            name: 'Project Accessibility',
            model: 'claude-3.7-sonnet',
          },
          migrations: {
            prompt: 'Inspect DB migrations.',
          },
        },
      };

      const overrides = {
        replace_standard_roles: true,
        enabled_roles: ['accessibility', 'migrations'],
      };

      const config = resolveConfig({ userConfig, projectConfig, overrides });

      assert.equal(config.replace_standard_roles, true);
      assert.deepEqual(config.enabled_roles, ['accessibility', 'migrations']);
      assert.ok(config.custom_roles.security_extra);
      assert.ok(config.custom_roles.migrations);
      assert.equal(config.custom_roles.accessibility.name, 'Project Accessibility');
      assert.equal(config.custom_roles.accessibility.prompt, 'Base accessibility checks.');
      assert.equal(config.custom_roles.accessibility.model, 'claude-3.7-sonnet');
    });

    it('getCustomRoles helper returns custom_roles dictionary', () => {
      const config = resolveConfig({
        userConfig: {
          custom_roles: {
            a11y: { prompt: 'a11y prompt' },
          },
        },
      });

      const roles = getCustomRoles(config);
      assert.ok(roles.a11y);
      assert.equal(roles.a11y.prompt, 'a11y prompt');
      assert.deepEqual(getCustomRoles(null), {});
    });
  });

  describe('Repository Review Guidelines Configuration (Increment 19)', () => {
    it('provides sensible default configuration for guidelines', () => {
      assert.ok(DEFAULT_CONFIG.guidelines);
      assert.equal(DEFAULT_CONFIG.guidelines.enabled, true);
      assert.equal(DEFAULT_CONFIG.guidelines.path, null);
      assert.equal(DEFAULT_CONFIG.guidelines.max_bytes, 64 * 1024);
    });

    it('preserves default guidelines configuration when none provided', () => {
      const config = resolveConfig();
      assert.deepEqual(config.guidelines, {
        enabled: true,
        path: null,
        max_bytes: 64 * 1024,
      });
    });

    it('resolves explicit guidelines options from config object', () => {
      const config = resolveConfig({
        projectConfig: {
          guidelines: {
            enabled: false,
            path: '.github/custom-rules.md',
            max_bytes: 32 * 1024,
          },
        },
      });

      assert.equal(config.guidelines.enabled, false);
      assert.equal(config.guidelines.path, '.github/custom-rules.md');
      assert.equal(config.guidelines.max_bytes, 32 * 1024);
    });

    it('supports top-level aliases: review_guidelines_path, guidelines_path, guidelinesPath', () => {
      const config1 = resolveConfig({
        projectConfig: {
          review_guidelines_path: 'docs/review-rules.md',
        },
      });
      assert.equal(config1.guidelines.path, 'docs/review-rules.md');

      const config2 = resolveConfig({
        overrides: {
          guidelines_path: '.github/guidelines-ci.md',
        },
      });
      assert.equal(config2.guidelines.path, '.github/guidelines-ci.md');

      const config3 = resolveConfig({
        overrides: {
          guidelinesPath: '.github/gem-pr-review.md',
        },
      });
      assert.equal(config3.guidelines.path, '.github/gem-pr-review.md');
    });

    it('layers guidelines settings across user, project, and runtime overrides', () => {
      const userConfig = {
        guidelines: {
          enabled: true,
          path: '.github/user-default.md',
          max_bytes: 16 * 1024,
        },
      };

      const projectConfig = {
        guidelines: {
          path: '.github/gem-pr-review.md',
        },
      };

      const overrides = {
        guidelines: {
          max_bytes: 48 * 1024,
        },
      };

      const config = resolveConfig({ userConfig, projectConfig, overrides });
      assert.equal(config.guidelines.enabled, true);
      assert.equal(config.guidelines.path, '.github/gem-pr-review.md');
      assert.equal(config.guidelines.max_bytes, 48 * 1024);
    });

    it('sanitizes invalid or malicious values', () => {
      const config = resolveConfig({
        overrides: {
          guidelines: {
            enabled: 'not-a-boolean',
            path: '   ',
            max_bytes: -100,
          },
        },
      });

      assert.equal(config.guidelines.enabled, true);
      assert.equal(config.guidelines.path, null);
      assert.equal(config.guidelines.max_bytes, 64 * 1024);
    });
  });
});
