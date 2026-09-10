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
  DEFAULT_CONFIG,
  VALID_TIERS,
} from './config.js';
import { parseMarkdownFindings } from './publish.js';

const execFileAsync = promisify(execFile);

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
 *
 * @param {Object} options
 * @param {string|Object} [options.mode] - Review mode name or object
 * @param {Object} [options.config] - Configuration settings
 * @returns {Array<Object>} Execution plan items
 */
export function resolveLensPlan({ mode = 'balanced', config } = {}) {
  const resolvedMode = typeof mode === 'string' ? resolveReviewMode(mode) : mode || REVIEW_MODES.balanced;
  const resolvedConfig = config || DEFAULT_CONFIG;

  const plan = [];

  for (const lensId of resolvedMode.lenses || []) {
    const lensDef = LENS_DEFINITIONS[lensId];
    if (!lensDef) continue;

    let tier = resolvedMode.defaultTier || 'medium';
    let reasoningEffort = resolvedMode.reasoningEffort || 'off';

    const lensOverride = resolvedConfig.lenses?.[lensId];

    if (resolvedMode.name === 'quick') {
      tier = 'light';
      reasoningEffort = 'off';
    } else if (resolvedMode.name === 'deep') {
      tier = 'heavy';
      reasoningEffort = 'high';
    } else {
      // Balanced or full: use specialized tier mapping
      const defaultMapping = DEFAULT_LENS_TIERS[lensId];
      if (defaultMapping) {
        tier = defaultMapping.tier;
        reasoningEffort = defaultMapping.reasoningEffort;
      }
    }

    if (lensOverride?.tier && VALID_TIERS.includes(lensOverride.tier)) {
      tier = lensOverride.tier;
    }

    // Resolve model identifier: lens override -> config tiers -> default tiers
    const model = lensOverride?.model || getModelForTier(resolvedConfig, tier);

    // Resolve reasoning effort: lens override -> tier configuration -> default assignment
    if (lensOverride?.reasoningEffort) {
      reasoningEffort = lensOverride.reasoningEffort;
    } else if (resolvedConfig.reasoningEfforts?.[tier]) {
      // When lens reasoning effort is 'off', respect config if set, otherwise keep lens recommendation
      if (reasoningEffort === 'off' && resolvedConfig.reasoningEfforts[tier] !== 'off') {
        reasoningEffort = resolvedConfig.reasoningEfforts[tier];
      }
    }

    plan.push({
      lensId,
      lensDef,
      mode: resolvedMode.name,
      tier,
      model,
      reasoningEffort,
    });
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
 * @param {string} [options.customInstructions] - Custom user instructions
 * @param {Function} options.runnerFn - Subagent runner function
 * @returns {Promise<{ results: Array, findings: Array, errors: Array }>}
 */
export async function dispatchSubagentsParallel({
  plan,
  diffText,
  prMetadata,
  customInstructions,
  runnerFn,
}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { results: [], findings: [], errors: [] };
  }

  if (typeof runnerFn !== 'function') {
    throw new Error('runnerFn is required for dispatchSubagentsParallel');
  }

  const tasks = plan.map(async (item) => {
    const prompt = buildReviewerPrompt({
      lens: item.lensDef,
      diffText,
      prMetadata,
      customInstructions,
    });

    try {
      const rawOutput = await runnerFn({
        lens: item.lensDef,
        prompt,
        mode: item.mode,
        tier: item.tier,
        model: item.model,
        reasoningEffort: item.reasoningEffort,
      });

      const parsed = parseMarkdownFindings(rawOutput || '');
      const lensFindings = parsed.map((f) => ({
        ...f,
        file: f.filePath || f.file,
        filePath: f.filePath || f.file,
        lens: item.lensId,
      }));

      return {
        lensId: item.lensId,
        tier: item.tier,
        model: item.model,
        findings: lensFindings,
        rawOutput,
        error: null,
      };
    } catch (err) {
      return {
        lensId: item.lensId,
        tier: item.tier,
        model: item.model,
        findings: [],
        rawOutput: '',
        error: err,
      };
    }
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
    return async ({ prompt, tier, model, reasoningEffort }) => {
      const selectedModel = modelOverride || model || (tier === 'heavy' ? 'claude-3.7-sonnet' : 'gpt-4o');
      const session = await copilotClient.createSession({
        model: selectedModel,
        reasoningEffort,
        workingDirectory: cwd,
      });
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

      return async ({ prompt, tier, model, reasoningEffort }) => {
        const selectedModel = modelOverride || model || (tier === 'heavy' ? 'claude-3.7-sonnet' : 'gpt-4o');
        const session = await client.createSession({
          model: selectedModel,
          reasoningEffort,
          workingDirectory: cwd,
        });
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
