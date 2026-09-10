/**
 * src/subagents.js — Multi-Lens Parallel Subagent Dispatcher via Copilot SDK
 *
 * Dispatches specialist code review lenses in parallel, mapping each lens to
 * optimal model tiers (light, medium, heavy) and reasoning efforts.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  LENS_DEFINITIONS,
  REVIEW_MODES,
  resolveReviewMode,
  buildReviewerPrompt,
} from './reviewer.js';
import {
  loadConfig,
  getModelForTier,
  getReasoningEffortForTier,
  getFallbackModels,
  getFallbackModelsForTier,
  DEFAULT_CONFIG,
  VALID_TIERS,
  formatDefaultRoleName,
  sanitizeCustomRoles,
} from './config.js';
import { parseMarkdownFindings } from './publish.js';
import { isLargeDiff, createFileBackedDiff } from './diff.js';

const execFileAsync = promisify(execFile);

const QUOTA_ERROR_CODES = new Set([
  'RESOURCE_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
  'INSUFFICIENT_QUOTA',
  'QUOTA_EXCEEDED',
  'MODEL_CAPACITY_EXCEEDED',
  'ERR_RATE_LIMITED',
]);

const NON_QUOTA_ERROR_NAMES = new Set([
  'TypeError',
  'SyntaxError',
  'ReferenceError',
  'RangeError',
  'URIError',
]);

const NON_QUOTA_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'EHOSTUNREACH',
]);

/**
 * Checks whether an error represents an API quota exhaustion, rate limit (HTTP 429),
 * or model/server capacity constraint.
 *
 * @param {any} error - Error object, string, or response
 * @returns {boolean}
 */
export function isQuotaOrCapacityError(error) {
  if (!error) return false;

  // Reject pure programming syntax/type/reference errors
  if (
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof ReferenceError ||
    error instanceof RangeError
  ) {
    return false;
  }
  if (typeof error === 'object' && NON_QUOTA_ERROR_NAMES.has(error.name)) {
    return false;
  }

  // Check HTTP status code (429 Too Many Requests)
  const status = error.status || error.statusCode || error.response?.status || error.response?.statusCode;
  if (status === 429 || error.code === 429 || error.code === '429') {
    return true;
  }

  // Check explicit error codes
  const rawCode = error.code || error.error?.code || error.response?.data?.error?.code;
  if (typeof rawCode === 'string') {
    const upperCode = rawCode.toUpperCase();
    if (QUOTA_ERROR_CODES.has(upperCode)) {
      return true;
    }
    if (NON_QUOTA_NETWORK_CODES.has(upperCode)) {
      return false;
    }
  }

  // Inspect textual message and response details
  const messageCandidates = [
    typeof error === 'string' ? error : '',
    error.message,
    error.details,
    error.response?.data?.message,
    error.response?.data?.error?.message,
    error.error?.message,
    error.statusText,
  ].filter(Boolean);

  const fullText = messageCandidates.join(' ');
  if (!fullText) return false;

  const hasQuotaOrRateLimit = /quota|rate[\s_-]*limit|too many requests|resource[\s_-]*exhausted|\b(tpm|rpm)\b/i.test(fullText);
  const hasCapacityOrOverload = /\bcapacity\b|\boverloaded\b/i.test(fullText);

  // If text does not mention quota, rate-limit, capacity or overload, reject
  if (!hasQuotaOrRateLimit && !hasCapacityOrOverload) {
    return false;
  }

  // If status is 503 and mentions capacity/overloaded, it's a capacity error
  if (status === 503 && hasCapacityOrOverload) {
    return true;
  }

  if (
    /\b429\b/.test(fullText) ||
    hasQuotaOrRateLimit ||
    hasCapacityOrOverload
  ) {
    return true;
  }

  return false;
}

export const isQuotaError = isQuotaOrCapacityError;

/**
 * Default tier and reasoning effort assignments per specialist lens.
 */
export const DEFAULT_LENS_TIERS = Object.freeze({
  correctness: Object.freeze({ tier: 'heavy', reasoningEffort: 'medium' }),
  contracts: Object.freeze({ tier: 'medium', reasoningEffort: 'off' }),
  security: Object.freeze({ tier: 'heavy', reasoningEffort: 'low' }),
  performance: Object.freeze({ tier: 'medium', reasoningEffort: 'off' }),
  conventions: Object.freeze({ tier: 'light', reasoningEffort: 'off' }),
  tests: Object.freeze({ tier: 'medium', reasoningEffort: 'off' }),
});

/**
 * Resolves the execution plan (lenses, tiers, models, and reasoning efforts) for a given review mode.
 * Supports custom review roles, flexible composition (adding or replacing standard lenses),
 * and filtering via enabled roles.
 *
 * @param {string|Object} [modeOrOptions='balanced'] - Review mode name/object, or options object
 * @param {Object} [maybeConfig] - Configuration settings (when modeOrOptions is mode string/object)
 * @returns {Array<Object>} Execution plan items
 */
export function resolveLensPlan(modeOrOptions = 'balanced', maybeConfig) {
  let modeInput = 'balanced';
  let configInput = null;
  let explicitRoles = null;
  let explicitReplaceStandard = null;
  let explicitCustomRoles = null;

  if (
    typeof modeOrOptions === 'string' ||
    (modeOrOptions && modeOrOptions.lenses && !modeOrOptions.mode && !modeOrOptions.config && !modeOrOptions.customRoles)
  ) {
    modeInput = modeOrOptions;
    configInput = maybeConfig;
  } else if (modeOrOptions && typeof modeOrOptions === 'object') {
    modeInput = modeOrOptions.mode ?? 'balanced';
    configInput = modeOrOptions.config || maybeConfig;
    explicitRoles = modeOrOptions.roles || modeOrOptions.enabledRoles || modeOrOptions.enabled_roles;
    explicitReplaceStandard = modeOrOptions.replaceStandardRoles ?? modeOrOptions.replace_standard_roles;
    explicitCustomRoles = modeOrOptions.customRoles ?? modeOrOptions.custom_roles;
  }

  const resolvedMode = typeof modeInput === 'string' ? resolveReviewMode(modeInput) : modeInput || REVIEW_MODES.balanced;
  const resolvedConfig = configInput || DEFAULT_CONFIG;

  const customRoles = {
    ...(resolvedConfig.custom_roles || {}),
    ...sanitizeCustomRoles(explicitCustomRoles),
  };

  const replaceStandard =
    explicitReplaceStandard !== null && explicitReplaceStandard !== undefined
      ? Boolean(explicitReplaceStandard)
      : Boolean(resolvedConfig.replace_standard_roles);

  let enabledList = null;
  if (explicitRoles) {
    if (Array.isArray(explicitRoles)) {
      enabledList = explicitRoles.map(String).map((s) => s.trim()).filter(Boolean);
    } else if (typeof explicitRoles === 'string') {
      enabledList = explicitRoles.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else if (Array.isArray(resolvedConfig.enabled_roles) && resolvedConfig.enabled_roles.length > 0) {
    enabledList = resolvedConfig.enabled_roles;
  }

  // Determine role IDs to schedule
  let roleIdsToRun = [];
  if (enabledList && enabledList.length > 0) {
    for (const requestedId of enabledList) {
      if (!customRoles[requestedId] && !LENS_DEFINITIONS[requestedId]) {
        throw new Error(`Unknown review role: "${requestedId}".`);
      }
    }
    roleIdsToRun = enabledList;
  } else if (replaceStandard) {
    roleIdsToRun = Object.keys(customRoles);
  } else {
    const standardLenses = resolvedMode.lenses || [];
    roleIdsToRun = [...standardLenses];
    for (const customId of Object.keys(customRoles)) {
      if (!roleIdsToRun.includes(customId)) {
        roleIdsToRun.push(customId);
      }
    }
  }

  const plan = [];

  for (const lensId of roleIdsToRun) {
    const customRole = customRoles[lensId];
    const standardDef = LENS_DEFINITIONS[lensId];

    if (!customRole && !standardDef) {
      throw new Error(`Unknown review role: "${lensId}".`);
    }

    const lensOverride = resolvedConfig.lenses?.[lensId];

    if (customRole) {
      const promptText = customRole.prompt || customRole.instructions || '';
      const lensDef = {
        id: lensId,
        name: customRole.name || formatDefaultRoleName(lensId),
        description: customRole.description || `Custom review role for ${lensId}`,
        instructions: promptText,
        prompt: promptText,
        isCustomRole: true,
      };

      let tier = customRole.tier || resolvedMode.defaultTier || 'medium';
      if (lensOverride?.tier && VALID_TIERS.includes(lensOverride.tier)) {
        tier = lensOverride.tier;
      }

      const model = lensOverride?.model || customRole.model || getModelForTier(resolvedConfig, tier);

      let reasoningEffort = lensOverride?.reasoningEffort || customRole.reasoningEffort;
      if (!reasoningEffort) {
        if (resolvedMode.name === 'deep') {
          reasoningEffort = 'high';
        } else if (resolvedConfig.reasoningEfforts?.[tier] && resolvedConfig.reasoningEfforts[tier] !== 'off') {
          reasoningEffort = resolvedConfig.reasoningEfforts[tier];
        } else {
          reasoningEffort = 'off';
        }
      }

      const rawFallbacks = lensOverride?.fallbacks || customRole.fallbacks || getFallbackModels(resolvedConfig, { tier, lensId });
      const fallbacks = (Array.isArray(rawFallbacks) ? rawFallbacks : []).filter(
        (fb) => fb && fb !== model
      );

      plan.push({
        lensId,
        lensDef,
        mode: resolvedMode.name || 'custom',
        tier,
        model,
        reasoningEffort,
        fallbacks,
      });
    } else {
      // Standard lens
      const lensDef = standardDef;
      let tier = resolvedMode.defaultTier || 'medium';
      let reasoningEffort = resolvedMode.reasoningEffort || 'off';

      if (resolvedMode.name === 'quick') {
        tier = 'light';
        reasoningEffort = 'off';
      } else if (resolvedMode.name === 'deep') {
        tier = 'heavy';
        reasoningEffort = 'high';
      } else {
        const defaultMapping = DEFAULT_LENS_TIERS[lensId];
        if (defaultMapping) {
          tier = defaultMapping.tier;
          reasoningEffort = defaultMapping.reasoningEffort;
        }
      }

      if (lensOverride?.tier && VALID_TIERS.includes(lensOverride.tier)) {
        tier = lensOverride.tier;
      }

      const model = lensOverride?.model || getModelForTier(resolvedConfig, tier);

      if (lensOverride?.reasoningEffort) {
        reasoningEffort = lensOverride.reasoningEffort;
      } else if (resolvedConfig.reasoningEfforts?.[tier]) {
        if (reasoningEffort === 'off' && resolvedConfig.reasoningEfforts[tier] !== 'off') {
          reasoningEffort = resolvedConfig.reasoningEfforts[tier];
        }
      }

      const rawFallbacks = lensOverride?.fallbacks
        ? lensOverride.fallbacks
        : getFallbackModels(resolvedConfig, { tier, lensId });
      const fallbacks = (Array.isArray(rawFallbacks) ? rawFallbacks : []).filter(
        (fb) => fb && fb !== model
      );

      plan.push({
        lensId,
        lensDef,
        mode: resolvedMode.name,
        tier,
        model,
        reasoningEffort,
        fallbacks,
      });
    }
  }

  if (plan.length === 0) {
    throw new Error('No review roles scheduled. Cannot execute review with zero lenses.');
  }

  return plan;
}

/**
 * Dispatches specialist lenses in parallel, collecting findings and capturing errors per lens.
 *
 * @param {Object} options
 * @param {Array<Object>} options.plan - Lens execution plan from resolveLensPlan
 * @param {string} options.diffText - Unified diff text
 * @param {Object} [options.prMetadata] - Metadata about the PR (number, title, author)
/**
 * Helper to build Copilot SDK compliant tool declarations for the host-supervised diff reader.
 *
 * @param {object} reader - Host-supervised reader instance
 * @returns {Array<object>}
 */
export function buildSdkReaderTools(reader) {
  if (!reader) return [];
  return [
    {
      name: 'diff_read',
      description:
        'Host-supervised tool to read a slice of the PR diff or a specific file diff within budget (max 16 reads, ~640 KB total).',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File path to read from the diff' },
          offset: { type: 'integer', description: 'Character offset' },
          limit: { type: 'integer', description: 'Max characters to read' },
          startLine: { type: 'integer', description: '1-based starting line number' },
          lineCount: { type: 'integer', description: 'Number of lines to read' },
        },
      },
      handler: async (args) => reader.read(args),
    },
    {
      name: 'diff_grep',
      description:
        'Host-supervised tool to grep for regex or literal patterns in the PR diff within access budget.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or regex pattern' },
          file: { type: 'string', description: 'Optional file to limit grep' },
          isRegex: { type: 'boolean', description: 'Treat query as regex' },
          caseInsensitive: { type: 'boolean', description: 'Case-insensitive search' },
          maxMatches: { type: 'integer', description: 'Max match results' },
        },
        required: ['query'],
      },
      handler: async (args) => reader.grep(args),
    },
    {
      name: 'diff_find',
      description:
        'Host-supervised metadata tool to filter changed files by path substring or status without consuming read budget.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Path substring to search' },
          status: {
            type: 'string',
            description: 'Status filter (modified, added, deleted, renamed, binary)',
          },
        },
      },
      handler: async (args) => reader.find(args),
    },
  ];
}

/**
 * Dispatches specialist lenses in parallel, collecting findings and capturing errors per lens.
 *
 * @param {Object} options
 * @param {Array<Object>} options.plan - Lens execution plan from resolveLensPlan
 * @param {string} options.diffText - Unified diff text
 * @param {Object} [options.prMetadata] - Metadata about the PR (number, title, author)
 * @param {string} [options.customInstructions] - Custom user instructions
 * @param {Function} options.runnerFn - Subagent runner function
 * @param {Object} [options.diffTransport] - Optional pre-created file-backed diff transport
 * @returns {Promise<{ results: Array, findings: Array, errors: Array }>}
 */
export async function dispatchSubagentsParallel({
  plan,
  diffText,
  prMetadata,
  customInstructions,
  runnerFn,
  diffTransport,
  config,
}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { results: [], findings: [], errors: [] };
  }

  if (typeof runnerFn !== 'function') {
    throw new Error('runnerFn is required for dispatchSubagentsParallel');
  }

  let activeTransport = diffTransport;
  let autoCreatedTransport = false;

  if (!activeTransport && isLargeDiff(diffText)) {
    activeTransport = await createFileBackedDiff(diffText);
    autoCreatedTransport = true;
  }

  try {
    const tasks = plan.map(async (item) => {
      const prompt = buildReviewerPrompt({
        lens: item.lensDef,
        diffText,
        prMetadata,
        customInstructions,
        diffTransport: activeTransport,
      });

      const sdkTools = activeTransport?.reader
        ? buildSdkReaderTools(activeTransport.reader)
        : [];

      const primaryModel = item.model;
      const configuredFallbacks = Array.isArray(item.fallbacks)
        ? item.fallbacks
        : config
          ? getFallbackModels(config, { tier: item.tier, lensId: item.lensId })
          : [];
      const fallbackModels = (configuredFallbacks || []).filter((m) => m && m !== primaryModel);
      const modelCandidates = [primaryModel, ...fallbackModels];

      let lastError = null;
      const attempts = [];

      for (let i = 0; i < modelCandidates.length; i++) {
        const candidateModel = modelCandidates[i];
        const isFallback = i > 0;

        try {
          const rawOutput = await runnerFn({
            lens: item.lensDef,
            prompt,
            mode: item.mode,
            tier: item.tier,
            model: candidateModel,
            reasoningEffort: item.reasoningEffort,
            diffTransport: activeTransport,
            tools: sdkTools,
            isFallback,
            attemptIndex: i,
          });

          const textOutput =
            typeof rawOutput === 'string' ? rawOutput : rawOutput?.output || rawOutput?.text || '';
          const parsed = parseMarkdownFindings(textOutput);
          const lensFindings = parsed.map((f) => ({
            ...f,
            file: f.filePath || f.file,
            filePath: f.filePath || f.file,
            lens: item.lensId,
          }));

          attempts.push({
            model: candidateModel,
            isFallback,
            success: true,
          });

          return {
            lensId: item.lensId,
            tier: item.tier,
            model: candidateModel,
            primaryModel,
            fallbackUsed: isFallback,
            fallbackModelsTried: attempts.filter((a) => a.isFallback).map((a) => a.model),
            attemptsCount: attempts.length,
            findings: lensFindings,
            rawOutput,
            error: null,
          };
        } catch (err) {
          lastError = err;
          attempts.push({
            model: candidateModel,
            isFallback,
            success: false,
            error: err,
          });

          const isQuota = isQuotaOrCapacityError(err);
          const hasMoreFallbacks = i < modelCandidates.length - 1;

          if (isQuota && hasMoreFallbacks) {
            continue;
          }

          break;
        }
      }

      return {
        lensId: item.lensId,
        tier: item.tier,
        model: primaryModel,
        primaryModel,
        fallbackUsed: attempts.some((a) => a.isFallback),
        fallbackModelsTried: attempts.filter((a) => a.isFallback).map((a) => a.model),
        attemptsCount: attempts.length,
        findings: [],
        rawOutput: '',
        error: lastError,
      };
    });

    const results = await Promise.all(tasks);

    const findings = [];
    const errors = [];

    for (const res of results) {
      if (res.error) {
        errors.push({ lensId: res.lensId, error: res.error });
      }
      for (const f of res.findings) {
        findings.push(f);
      }
    }

    return { results, findings, errors };
  } finally {
    if (autoCreatedTransport && activeTransport) {
      await activeTransport.cleanup();
    }
  }
}

/**
 * Creates a subagent runner function supporting Copilot SDK, CLI fallback, or mock mode.
 *
 * @param {Object} options
 * @param {Object} [options.config] - Resolved configuration
 * @param {string} [options.modelOverride] - Direct model override
 * @param {boolean} [options.mock] - Whether to use synthetic runner
 * @param {string} [options.cwd] - Working directory
 * @param {Object} [options.copilotClient] - Injected CopilotClient instance
 * @param {string} [options.copilotCliPath] - Explicit path to Copilot CLI binary
 * @param {string} [options.copilotSdkPath] - Explicit path to Copilot SDK package
 * @returns {Promise<Function>}
 */
export async function createSubagentRunner(options = {}) {
  const {
    modelOverride,
    mock = false,
    cwd = process.cwd(),
    copilotClient,
    copilotCliPath = process.env.COPILOT_CLI_PATH,
    copilotSdkPath = process.env.COPILOT_SDK_PATH,
  } = options;

  if (mock) {
    return async () => `<<<PR_REVIEW_JSON>>>
[]
<<<END_PR_REVIEW_JSON>>>`;
  }

  // If a pre-configured CopilotClient is provided, use it directly
  if (copilotClient && typeof copilotClient.createSession === 'function') {
    return async ({ prompt, tier, model, reasoningEffort, tools }) => {
      const selectedModel = modelOverride || model || (tier === 'heavy' ? 'claude-3.7-sonnet' : 'gpt-4o');
      const sessionOptions = {
        model: selectedModel,
        reasoningEffort,
        workingDirectory: cwd,
      };
      if (Array.isArray(tools) && tools.length > 0) {
        sessionOptions.tools = tools;
      }
      const session = await copilotClient.createSession(sessionOptions);
      try {
        const response = await session.send(prompt);
        return response?.text || '';
      } finally {
        if (typeof session.close === 'function') {
          await session.close();
        }
      }
    };
  }

  // Dynamic import of @github/copilot-sdk if configured in environment
  if (copilotSdkPath && copilotCliPath) {
    try {
      const { pathToFileURL } = await import('node:url');
      const sdkModule = await import(
        pathToFileURL(path.resolve(copilotSdkPath, 'index.js')).href
      );
      const { CopilotClient, RuntimeConnection } = sdkModule;
      const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({
          path: path.resolve(copilotCliPath),
        }),
      });

      return async ({ prompt, tier, model, reasoningEffort, tools }) => {
        const selectedModel = modelOverride || model || (tier === 'heavy' ? 'claude-3.7-sonnet' : 'gpt-4o');
        const sessionOptions = {
          model: selectedModel,
          reasoningEffort,
          workingDirectory: cwd,
        };
        if (Array.isArray(tools) && tools.length > 0) {
          sessionOptions.tools = tools;
        }
        const session = await client.createSession(sessionOptions);
        try {
          const response = await session.send(prompt);
          return response?.text || '';
        } finally {
          if (typeof session.close === 'function') {
            await session.close();
          }
        }
      };
    } catch {
      // Fallback to CLI
    }
  }

  // Fallback to direct Copilot CLI invocation
  return async ({ prompt, model }) => {
    const selectedModel = modelOverride || model;
    const cliArgs = ['-s', '-p', prompt, '--no-color'];
    if (selectedModel) {
      cliArgs.push('--model', selectedModel);
    }

    try {
      const { stdout } = await execFileAsync('copilot', cliArgs, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      console.error(`Copilot CLI execution warning: ${err.message}`);
      return '';
    }
  };
}
