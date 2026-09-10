import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Valid model tier names.
 */
export const VALID_TIERS = Object.freeze(['light', 'medium', 'heavy']);

/**
 * Valid review modes.
 */
export const VALID_REVIEW_MODES = Object.freeze(['balanced', 'quick', 'full', 'deep']);

/**
 * Valid reasoning effort settings per tier.
 */
export const VALID_REASONING_EFFORTS = Object.freeze(['off', 'low', 'medium', 'high']);

/**
 * Valid maximum priority levels eligible for automated review approval.
 */
export const VALID_APPROVE_MAX_PRIORITY_LEVELS = Object.freeze(['off', 'P2', 'P3', 'nit']);

/**
 * Sensible default configuration.
 */
export const DEFAULT_CONFIG = Object.freeze({
  defaultReviewMode: 'balanced',
  tiers: Object.freeze({
    light: 'claude-3.5-haiku',
    medium: 'claude-3.5-sonnet',
    heavy: 'claude-3.7-sonnet',
  }),
  reasoningEfforts: Object.freeze({
    light: 'off',
    medium: 'off',
    heavy: 'medium',
  }),
  autoPostReviews: false,
  approveMaxPriorityLevel: 'off',
});

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function readJsonSafely(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (isPlainObject(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves configuration by layering defaults, user-level settings, project-level settings, and optional runtime overrides.
 *
 * @param {Object} [options]
 * @param {Object} [options.userConfig] - Raw user-level configuration (~/.copilot/pr-review.json)
 * @param {Object} [options.projectConfig] - Raw project-level configuration (.github/pr-review.json)
 * @param {Object} [options.overrides] - Direct runtime overrides
 * @returns {typeof DEFAULT_CONFIG} Resolved configuration object
 */
export function resolveConfig({ userConfig, projectConfig, overrides } = {}) {
  const sources = [userConfig, projectConfig, overrides].filter(isPlainObject);

  const resolved = {
    defaultReviewMode: DEFAULT_CONFIG.defaultReviewMode,
    tiers: { ...DEFAULT_CONFIG.tiers },
    reasoningEfforts: { ...DEFAULT_CONFIG.reasoningEfforts },
    autoPostReviews: DEFAULT_CONFIG.autoPostReviews,
    approveMaxPriorityLevel: DEFAULT_CONFIG.approveMaxPriorityLevel,
  };

  for (const src of sources) {
    if (typeof src.defaultReviewMode === 'string' && VALID_REVIEW_MODES.includes(src.defaultReviewMode)) {
      resolved.defaultReviewMode = src.defaultReviewMode;
    }

    if (typeof src.autoPostReviews === 'boolean') {
      resolved.autoPostReviews = src.autoPostReviews;
    }

    if (
      typeof src.approveMaxPriorityLevel === 'string' &&
      VALID_APPROVE_MAX_PRIORITY_LEVELS.includes(src.approveMaxPriorityLevel)
    ) {
      resolved.approveMaxPriorityLevel = src.approveMaxPriorityLevel;
    }

    if (isPlainObject(src.tiers)) {
      for (const tier of VALID_TIERS) {
        if (typeof src.tiers[tier] === 'string' && src.tiers[tier].trim().length > 0) {
          resolved.tiers[tier] = src.tiers[tier].trim();
        }
      }
    }

    if (isPlainObject(src.reasoningEfforts)) {
      for (const tier of VALID_TIERS) {
        if (typeof src.reasoningEfforts[tier] === 'string' && VALID_REASONING_EFFORTS.includes(src.reasoningEfforts[tier])) {
          resolved.reasoningEfforts[tier] = src.reasoningEfforts[tier];
        }
      }
    }
  }

  return resolved;
}

/**
 * Loads and resolves configuration from user and project files.
 *
 * @param {Object} [options]
 * @param {string} [options.homeDir] - User home directory (defaults to os.homedir())
 * @param {string} [options.cwd] - Current working directory / project root (defaults to process.cwd())
 * @param {string} [options.userConfigPath] - Explicit path to user configuration file
 * @param {string} [options.projectConfigPath] - Explicit path to project configuration file
 * @param {Object} [options.overrides] - Runtime overrides
 * @returns {typeof DEFAULT_CONFIG} Resolved configuration object
 */
export function loadConfig(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const cwd = options.cwd || process.cwd();

  const userGemConfigPath = path.join(homeDir, '.copilot', 'gem-pr-review.json');
  const userFallbackConfigPath = path.join(homeDir, '.copilot', 'pr-review.json');
  const userConfigPath = options.userConfigPath || (
    fs.existsSync(userGemConfigPath) ? userGemConfigPath : userFallbackConfigPath
  );

  const projectGemConfigPath = path.join(cwd, '.github', 'gem-pr-review.json');
  const projectFallbackConfigPath = path.join(cwd, '.github', 'pr-review.json');
  const projectConfigPath = options.projectConfigPath || (
    fs.existsSync(projectGemConfigPath) ? projectGemConfigPath : projectFallbackConfigPath
  );

  const userConfig = readJsonSafely(userConfigPath);
  const projectConfig = readJsonSafely(projectConfigPath);

  return resolveConfig({
    userConfig,
    projectConfig,
    overrides: options.overrides,
  });
}

/**
 * Returns the configured model identifier for a given tier.
 *
 * @param {Object} config - Resolved configuration object
 * @param {'light'|'medium'|'heavy'} tier - Tier name
 * @returns {string} Model name
 */
export function getModelForTier(config, tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Unknown tier: ${tier}. Expected one of: ${VALID_TIERS.join(', ')}`);
  }
  return config?.tiers?.[tier] || DEFAULT_CONFIG.tiers[tier];
}

/**
 * Returns the configured reasoning effort for a given tier.
 *
 * @param {Object} config - Resolved configuration object
 * @param {'light'|'medium'|'heavy'} tier - Tier name
 * @returns {'off'|'low'|'medium'|'high'} Reasoning effort level
 */
export function getReasoningEffortForTier(config, tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Unknown tier: ${tier}. Expected one of: ${VALID_TIERS.join(', ')}`);
  }
  return config?.reasoningEfforts?.[tier] || DEFAULT_CONFIG.reasoningEfforts[tier];
}
