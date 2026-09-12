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
 * Default guidelines configuration.
 */
export const DEFAULT_GUIDELINES_CONFIG = Object.freeze({
  enabled: true,
  path: null,
  max_bytes: 64 * 1024,
});

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
  fallbacks: Object.freeze({
    light: Object.freeze([]),
    medium: Object.freeze([]),
    heavy: Object.freeze([]),
  }),
  heavy_fallbacks: Object.freeze([]),
  medium_fallbacks: Object.freeze([]),
  light_fallbacks: Object.freeze([]),
  fallback_to_auto: true,
  lenses: Object.freeze({}),
  custom_roles: Object.freeze({}),
  replace_standard_roles: false,
  enabled_roles: Object.freeze([]),
  autoPostReviews: false,
  approveMaxPriorityLevel: 'off',
  guidelines: DEFAULT_GUIDELINES_CONFIG,
});

const UNSAFE_OBJECT_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

function sanitizeModelList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim().length > 0) {
      result.push(item.trim());
    }
  }
  return result;
}

function sanitizeStringList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim().length > 0) {
      result.push(item.trim());
    }
  }
  return result;
}

export function formatDefaultRoleName(roleId) {
  if (!roleId || typeof roleId !== 'string') return 'Custom Role';
  return roleId
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function sanitizeCustomRoles(rawRoles) {
  if (!isPlainObject(rawRoles)) return {};
  const sanitized = {};
  for (const [roleId, roleConfig] of Object.entries(rawRoles)) {
    if (UNSAFE_OBJECT_KEYS.includes(roleId) || !isPlainObject(roleConfig)) continue;
    const clean = sanitizeRoleConfig(roleId, roleConfig);
    if (clean) {
      sanitized[roleId] = clean;
    }
  }
  return sanitized;
}

function sanitizeRoleConfig(roleId, roleConfig, existingRole = null) {
  if (!isPlainObject(roleConfig)) return null;

  const rawPrompt =
    typeof roleConfig.prompt === 'string' && roleConfig.prompt.trim().length > 0
      ? roleConfig.prompt.trim()
      : typeof roleConfig.instructions === 'string' && roleConfig.instructions.trim().length > 0
        ? roleConfig.instructions.trim()
        : existingRole?.prompt || '';

  if (!rawPrompt) {
    return null;
  }

  const sanitized = {
    name:
      typeof roleConfig.name === 'string' && roleConfig.name.trim().length > 0
        ? roleConfig.name.trim()
        : existingRole?.name || formatDefaultRoleName(roleId),
    prompt: rawPrompt,
    instructions: rawPrompt,
  };

  if (typeof roleConfig.description === 'string' && roleConfig.description.trim().length > 0) {
    sanitized.description = roleConfig.description.trim();
  } else if (existingRole?.description) {
    sanitized.description = existingRole.description;
  }

  if (typeof roleConfig.model === 'string' && roleConfig.model.trim().length > 0) {
    sanitized.model = roleConfig.model.trim();
  } else if (existingRole?.model) {
    sanitized.model = existingRole.model;
  }

  if (
    typeof roleConfig.reasoningEffort === 'string' &&
    VALID_REASONING_EFFORTS.includes(roleConfig.reasoningEffort)
  ) {
    sanitized.reasoningEffort = roleConfig.reasoningEffort;
  } else if (existingRole?.reasoningEffort) {
    sanitized.reasoningEffort = existingRole.reasoningEffort;
  }

  if (typeof roleConfig.tier === 'string' && VALID_TIERS.includes(roleConfig.tier)) {
    sanitized.tier = roleConfig.tier;
  } else if (existingRole?.tier) {
    sanitized.tier = existingRole.tier;
  }

  if (Array.isArray(roleConfig.fallbacks)) {
    sanitized.fallbacks = sanitizeModelList(roleConfig.fallbacks);
  } else if (existingRole?.fallbacks) {
    sanitized.fallbacks = [...existingRole.fallbacks];
  }

  return sanitized;
}

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
    fallbacks: {
      light: [...DEFAULT_CONFIG.fallbacks.light],
      medium: [...DEFAULT_CONFIG.fallbacks.medium],
      heavy: [...DEFAULT_CONFIG.fallbacks.heavy],
    },
    heavy_fallbacks: [...DEFAULT_CONFIG.heavy_fallbacks],
    medium_fallbacks: [...DEFAULT_CONFIG.medium_fallbacks],
    light_fallbacks: [...DEFAULT_CONFIG.light_fallbacks],
    fallback_to_auto: DEFAULT_CONFIG.fallback_to_auto,
    lenses: { ...DEFAULT_CONFIG.lenses },
    custom_roles: { ...DEFAULT_CONFIG.custom_roles },
    replace_standard_roles: DEFAULT_CONFIG.replace_standard_roles,
    enabled_roles: [...DEFAULT_CONFIG.enabled_roles],
    autoPostReviews: DEFAULT_CONFIG.autoPostReviews,
    approveMaxPriorityLevel: DEFAULT_CONFIG.approveMaxPriorityLevel,
    guidelines: { ...DEFAULT_CONFIG.guidelines },
  };

  for (const src of sources) {
    if (typeof src.defaultReviewMode === 'string' && VALID_REVIEW_MODES.includes(src.defaultReviewMode)) {
      resolved.defaultReviewMode = src.defaultReviewMode;
    }

    if (typeof src.fallback_to_auto === 'boolean') {
      resolved.fallback_to_auto = src.fallback_to_auto;
    } else if (typeof src.fallbackToAuto === 'boolean') {
      resolved.fallback_to_auto = src.fallbackToAuto;
    } else if (typeof src.auto_fallback === 'boolean') {
      resolved.fallback_to_auto = src.auto_fallback;
    } else if (typeof src.autoFallback === 'boolean') {
      resolved.fallback_to_auto = src.autoFallback;
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

    // Top-level guideline aliases
    if (typeof src.review_guidelines_path === 'string' && src.review_guidelines_path.trim().length > 0) {
      resolved.guidelines.path = src.review_guidelines_path.trim();
    } else if (typeof src.guidelines_path === 'string' && src.guidelines_path.trim().length > 0) {
      resolved.guidelines.path = src.guidelines_path.trim();
    } else if (typeof src.guidelinesPath === 'string' && src.guidelinesPath.trim().length > 0) {
      resolved.guidelines.path = src.guidelinesPath.trim();
    }

    if (typeof src.guidelines_enabled === 'boolean') {
      resolved.guidelines.enabled = src.guidelines_enabled;
    } else if (typeof src.guidelinesEnabled === 'boolean') {
      resolved.guidelines.enabled = src.guidelinesEnabled;
    }

    // Guidelines configuration object
    if (isPlainObject(src.guidelines)) {
      if (typeof src.guidelines.enabled === 'boolean') {
        resolved.guidelines.enabled = src.guidelines.enabled;
      }
      if (typeof src.guidelines.path === 'string' && src.guidelines.path.trim().length > 0) {
        resolved.guidelines.path = src.guidelines.path.trim();
      } else if (src.guidelines.path === null) {
        resolved.guidelines.path = null;
      }
      const rawMaxBytes = src.guidelines.max_bytes ?? src.guidelines.maxBytes;
      if (typeof rawMaxBytes === 'number' && Number.isFinite(rawMaxBytes) && rawMaxBytes > 0) {
        resolved.guidelines.max_bytes = Math.floor(rawMaxBytes);
      }
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

    // Top-level tier fallback keys (e.g. heavy_fallbacks or heavyFallbacks)
    for (const tier of VALID_TIERS) {
      const snakeKey = `${tier}_fallbacks`;
      const camelKey = `${tier}Fallbacks`;
      if (Array.isArray(src[snakeKey])) {
        const sanitized = sanitizeModelList(src[snakeKey]);
        resolved[snakeKey] = sanitized;
        resolved.fallbacks[tier] = sanitized;
      } else if (Array.isArray(src[camelKey])) {
        const sanitized = sanitizeModelList(src[camelKey]);
        resolved[snakeKey] = sanitized;
        resolved.fallbacks[tier] = sanitized;
      }
    }

    // Nested fallbacks object (e.g. fallbacks: { heavy: [...] })
    if (isPlainObject(src.fallbacks)) {
      for (const tier of VALID_TIERS) {
        if (Array.isArray(src.fallbacks[tier])) {
          const sanitized = sanitizeModelList(src.fallbacks[tier]);
          resolved.fallbacks[tier] = sanitized;
          resolved[`${tier}_fallbacks`] = sanitized;
        }
      }
    }

    if (isPlainObject(src.lenses)) {
      for (const [lensId, lensConfig] of Object.entries(src.lenses)) {
        if (UNSAFE_OBJECT_KEYS.includes(lensId) || !isPlainObject(lensConfig)) continue;
        const validLens = {};
        if (typeof lensConfig.model === 'string' && lensConfig.model.trim().length > 0) {
          validLens.model = lensConfig.model.trim();
        }
        if (typeof lensConfig.reasoningEffort === 'string' && VALID_REASONING_EFFORTS.includes(lensConfig.reasoningEffort)) {
          validLens.reasoningEffort = lensConfig.reasoningEffort;
        }
        if (typeof lensConfig.tier === 'string' && VALID_TIERS.includes(lensConfig.tier)) {
          validLens.tier = lensConfig.tier;
        }
        if (Array.isArray(lensConfig.fallbacks)) {
          validLens.fallbacks = sanitizeModelList(lensConfig.fallbacks);
        }
        if (Object.keys(validLens).length > 0) {
          resolved.lenses[lensId] = {
            ...(resolved.lenses[lensId] || {}),
            ...validLens,
          };
        }
      }
    }

    if (typeof src.replace_standard_roles === 'boolean') {
      resolved.replace_standard_roles = src.replace_standard_roles;
    } else if (typeof src.replaceStandardRoles === 'boolean') {
      resolved.replace_standard_roles = src.replaceStandardRoles;
    }

    if (Array.isArray(src.enabled_roles)) {
      resolved.enabled_roles = sanitizeStringList(src.enabled_roles);
    } else if (Array.isArray(src.enabledRoles)) {
      resolved.enabled_roles = sanitizeStringList(src.enabledRoles);
    }

    const rawRoles = isPlainObject(src.custom_roles)
      ? src.custom_roles
      : isPlainObject(src.customRoles)
        ? src.customRoles
        : isPlainObject(src.roles)
          ? src.roles
          : null;

    if (rawRoles) {
      for (const [roleId, roleConfig] of Object.entries(rawRoles)) {
        if (UNSAFE_OBJECT_KEYS.includes(roleId) || !isPlainObject(roleConfig)) continue;
        const existingRole = resolved.custom_roles[roleId] || null;
        const sanitized = sanitizeRoleConfig(roleId, roleConfig, existingRole);
        if (sanitized) {
          resolved.custom_roles[roleId] = {
            ...(resolved.custom_roles[roleId] || {}),
            ...sanitized,
          };
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
  const opts = typeof options === 'string' ? { cwd: options } : (options || {});
  const homeDir = opts.homeDir || os.homedir();
  const cwd = opts.cwd || process.cwd();

  const userGemConfigPath = path.join(homeDir, '.copilot', 'gem-pr-review.json');
  const userFallbackConfigPath = path.join(homeDir, '.copilot', 'pr-review.json');
  const userConfigPath = opts.userConfigPath || (
    fs.existsSync(userGemConfigPath) ? userGemConfigPath : userFallbackConfigPath
  );

  const projectGemConfigPath = path.join(cwd, '.github', 'gem-pr-review.json');
  const projectFallbackConfigPath = path.join(cwd, '.github', 'pr-review.json');
  const projectConfigPath = opts.projectConfigPath || (
    fs.existsSync(projectGemConfigPath) ? projectGemConfigPath : projectFallbackConfigPath
  );

  const userConfig = readJsonSafely(userConfigPath);
  const projectConfig = readJsonSafely(projectConfigPath);

  return resolveConfig({
    userConfig,
    projectConfig,
    overrides: opts.overrides,
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

/**
 * Returns the configured fallback model list for a given tier.
 *
 * @param {Object} config - Resolved configuration object
 * @param {'light'|'medium'|'heavy'} tier - Tier name
 * @returns {Array<string>} Array of fallback model identifiers
 */
export function getFallbackModelsForTier(config, tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Unknown tier: ${tier}. Expected one of: ${VALID_TIERS.join(', ')}`);
  }
  return config?.fallbacks?.[tier] || config?.[`${tier}_fallbacks`] || [];
}

/**
 * Resolves fallback models for a lens, giving precedence to per-lens fallbacks,
 * then tier fallbacks, then empty array.
 *
 * @param {Object} config - Resolved configuration object
 * @param {Object} [options]
 * @param {string} [options.tier] - Model tier
 * @param {string} [options.lensId] - Lens identifier
 * @returns {Array<string>} Array of fallback model identifiers
 */
export function getFallbackModels(config, { tier, lensId } = {}) {
  if (lensId && Array.isArray(config?.lenses?.[lensId]?.fallbacks)) {
    return config.lenses[lensId].fallbacks;
  }
  if (tier && VALID_TIERS.includes(tier)) {
    return getFallbackModelsForTier(config, tier);
  }
  return [];
}

/**
 * Returns the configured custom roles dictionary.
 *
 * @param {Object} config - Resolved configuration object
 * @returns {Record<string, Object>} Custom roles map
 */
export function getCustomRoles(config) {
  return config?.custom_roles || {};
}
