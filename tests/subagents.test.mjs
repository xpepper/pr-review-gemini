import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LENS_TIERS,
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
  buildSdkReaderTools,
  isQuotaOrCapacityError,
  isQuotaError,
} from '../src/subagents.js';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { REVIEW_MODES, LENS_DEFINITIONS } from '../src/reviewer.js';

describe('Subagent Dispatcher & Parallel Execution', () => {
  describe('DEFAULT_LENS_TIERS and Lens Configuration', () => {
    it('defines tier and reasoning effort defaults for all specialist lenses', () => {
      const lenses = ['correctness', 'contracts', 'security', 'performance', 'conventions', 'tests'];
      for (const lensId of lenses) {
        const mapping = DEFAULT_LENS_TIERS[lensId];
        assert.ok(mapping, `Mapping should exist for lens ${lensId}`);
        assert.ok(['light', 'medium', 'heavy'].includes(mapping.tier));
        assert.ok(['off', 'low', 'medium', 'high'].includes(mapping.reasoningEffort));
      }

      // Verify specialized tier assignments
      assert.equal(DEFAULT_LENS_TIERS.correctness.tier, 'heavy');
      assert.equal(DEFAULT_LENS_TIERS.security.tier, 'heavy');
      assert.equal(DEFAULT_LENS_TIERS.conventions.tier, 'light');
    });
  });

  describe('resolveLensPlan', () => {
    it('resolves plan for balanced mode with 5 parallel lenses', () => {
      const config = loadConfig();
      const plan = resolveLensPlan({ mode: 'balanced', config });

      assert.equal(plan.length, 5);
      const lensIds = plan.map((p) => p.lensId);
      assert.deepEqual(lensIds, ['correctness', 'contracts', 'security', 'performance', 'conventions']);

      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.equal(correctness.tier, 'heavy');
      assert.equal(correctness.model, config.tiers.heavy);
      assert.equal(correctness.reasoningEffort, 'medium');

      const conventions = plan.find((p) => p.lensId === 'conventions');
      assert.equal(conventions.tier, 'light');
      assert.equal(conventions.model, config.tiers.light);
      assert.equal(conventions.reasoningEffort, 'off');
    });

    it('resolves plan for quick mode with light tier overrides', () => {
      const config = loadConfig();
      const plan = resolveLensPlan({ mode: 'quick', config });

      assert.equal(plan.length, 3);
      const lensIds = plan.map((p) => p.lensId);
      assert.deepEqual(lensIds, ['correctness', 'security', 'conventions']);

      for (const p of plan) {
        assert.equal(p.tier, 'light');
        assert.equal(p.model, config.tiers.light);
      }
    });

    it('resolves plan for deep mode with heavy tier and high reasoning effort', () => {
      const config = loadConfig();
      const plan = resolveLensPlan({ mode: 'deep', config });

      assert.equal(plan.length, 1);
      assert.equal(plan[0].lensId, 'correctness');
      assert.equal(plan[0].tier, 'heavy');
      assert.equal(plan[0].reasoningEffort, 'high');
      assert.equal(plan[0].model, config.tiers.heavy);
    });

    it('resolves plan for full mode with 6 lenses including tests', () => {
      const config = loadConfig();
      const plan = resolveLensPlan({ mode: 'full', config });

      assert.equal(plan.length, 6);
      const testLens = plan.find((p) => p.lensId === 'tests');
      assert.ok(testLens);
      assert.equal(testLens.tier, 'medium');
      assert.equal(testLens.model, config.tiers.medium);
    });

    it('honors custom model tier overrides from config', () => {
      const customConfig = {
        tiers: {
          light: 'custom-fast',
          medium: 'custom-balanced',
          heavy: 'custom-o3',
        },
        reasoningEfforts: {
          light: 'off',
          medium: 'low',
          heavy: 'high',
        },
      };

      const plan = resolveLensPlan({ mode: 'balanced', config: customConfig });
      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.equal(correctness.model, 'custom-o3');
    });

    it('applies per-lens model and reasoning effort overrides when configured', () => {
      const customConfig = {
        tiers: {
          light: 'gpt-5-mini',
          medium: 'claude-sonnet-5',
          heavy: 'gpt-5.6-terra',
        },
        reasoningEfforts: {
          light: 'off',
          medium: 'off',
          heavy: 'medium',
        },
        lenses: {
          correctness: {
            model: 'gpt-5.6-terra-custom',
            reasoningEffort: 'high',
          },
          security: {
            model: 'claude-opus-5',
            reasoningEffort: 'high',
          },
        },
      };

      const plan = resolveLensPlan({ mode: 'balanced', config: customConfig });

      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.equal(correctness.model, 'gpt-5.6-terra-custom');
      assert.equal(correctness.reasoningEffort, 'high');
      assert.equal(correctness.tier, 'heavy');

      const security = plan.find((p) => p.lensId === 'security');
      assert.equal(security.model, 'claude-opus-5');
      assert.equal(security.reasoningEffort, 'high');
      assert.equal(security.tier, 'heavy');

      // Un-overridden lens keeps tier and default configuration
      const contracts = plan.find((p) => p.lensId === 'contracts');
      assert.equal(contracts.model, 'claude-sonnet-5');
      assert.equal(contracts.tier, 'medium');
      assert.equal(contracts.reasoningEffort, 'off');
    });

    it('applies per-lens tier override and resolves model from that tier unless model is explicitly set', () => {
      const customConfig = {
        tiers: {
          light: 'tier-light-model',
          medium: 'tier-medium-model',
          heavy: 'tier-heavy-model',
        },
        lenses: {
          security: {
            tier: 'medium',
          },
          conventions: {
            tier: 'heavy',
            model: 'explicit-conventions-model',
          },
        },
      };

      const plan = resolveLensPlan({ mode: 'balanced', config: customConfig });

      const security = plan.find((p) => p.lensId === 'security');
      assert.equal(security.tier, 'medium');
      assert.equal(security.model, 'tier-medium-model');

      const conventions = plan.find((p) => p.lensId === 'conventions');
      assert.equal(conventions.tier, 'heavy');
      assert.equal(conventions.model, 'explicit-conventions-model');
    });

    it('honors resolution precedence: lens override -> tier configuration -> plugin defaults', () => {
      // 1. Lens override present: overrides tier config
      const withLensOverride = {
        tiers: { heavy: 'configured-heavy' },
        lenses: { correctness: { model: 'overridden-heavy', reasoningEffort: 'high' } },
      };
      const plan1 = resolveLensPlan({ mode: 'balanced', config: withLensOverride });
      const correctness1 = plan1.find((p) => p.lensId === 'correctness');
      assert.equal(correctness1.model, 'overridden-heavy');
      assert.equal(correctness1.reasoningEffort, 'high');

      // 2. No lens override: falls back to tier config
      const withoutLensOverride = {
        tiers: { heavy: 'configured-heavy' },
        reasoningEfforts: { heavy: 'medium' },
      };
      const plan2 = resolveLensPlan({ mode: 'balanced', config: withoutLensOverride });
      const correctness2 = plan2.find((p) => p.lensId === 'correctness');
      assert.equal(correctness2.model, 'configured-heavy');
      assert.equal(correctness2.reasoningEffort, 'medium');

      // 3. No tier config: falls back to DEFAULT_CONFIG tiers
      const plan3 = resolveLensPlan({ mode: 'balanced' });
      const correctness3 = plan3.find((p) => p.lensId === 'correctness');
      assert.equal(correctness3.model, DEFAULT_CONFIG.tiers.heavy);
      assert.equal(correctness3.reasoningEffort, DEFAULT_LENS_TIERS.correctness.reasoningEffort);
    });

    it('applies per-lens overrides in quick and deep modes', () => {
      const config = {
        lenses: {
          correctness: {
            model: 'custom-lens-model',
            reasoningEffort: 'high',
          },
        },
      };

      const quickPlan = resolveLensPlan({ mode: 'quick', config });
      const quickCorrectness = quickPlan.find((p) => p.lensId === 'correctness');
      assert.equal(quickCorrectness.model, 'custom-lens-model');
      assert.equal(quickCorrectness.reasoningEffort, 'high');

      const deepPlan = resolveLensPlan({ mode: 'deep', config: {
        lenses: {
          correctness: {
            model: 'deep-custom-model',
            reasoningEffort: 'low',
          },
        },
      } });
      const deepCorrectness = deepPlan.find((p) => p.lensId === 'correctness');
      assert.equal(deepCorrectness.model, 'deep-custom-model');
      assert.equal(deepCorrectness.reasoningEffort, 'low');
    });

    it('ignores invalid tier override on lens and keeps mode default tier', () => {
      const config = {
        lenses: {
          correctness: {
            tier: 'ultra-heavy',
          },
        },
      };

      const plan = resolveLensPlan({ mode: 'balanced', config });
      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.equal(correctness.tier, 'heavy');
    });

    it('resolves configured tier fallbacks onto plan items', () => {
      const config = {
        heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o'],
        medium_fallbacks: ['gpt-4o-mini'],
      };

      const plan = resolveLensPlan({ mode: 'balanced', config });
      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.deepEqual(correctness.fallbacks, ['claude-3.5-sonnet', 'gpt-4o']);

      const contracts = plan.find((p) => p.lensId === 'contracts');
      assert.deepEqual(contracts.fallbacks, ['gpt-4o-mini']);
    });

    it('excludes primary model from fallback chain and applies per-lens overrides', () => {
      const config = {
        tiers: {
          heavy: 'claude-3.5-sonnet',
        },
        heavy_fallbacks: ['claude-3.5-sonnet', 'gpt-4o', 'gemini-2.5-pro'],
        lenses: {
          correctness: {
            fallbacks: ['o3', 'gpt-4o'],
          },
        },
      };

      const plan = resolveLensPlan({ mode: 'balanced', config });

      // Correctness uses lens-specific fallbacks
      const correctness = plan.find((p) => p.lensId === 'correctness');
      assert.deepEqual(correctness.fallbacks, ['o3', 'gpt-4o']);

      // Security uses tier fallbacks minus its primary model (claude-3.5-sonnet)
      const security = plan.find((p) => p.lensId === 'security');
      assert.equal(security.model, 'claude-3.5-sonnet');
      assert.deepEqual(security.fallbacks, ['gpt-4o', 'gemini-2.5-pro']);
    });
  });

  describe('dispatchSubagentsParallel', () => {
    const sampleDiff = `diff --git a/src/calc.js b/src/calc.js
index 1111111..2222222 100644
--- a/src/calc.js
+++ b/src/calc.js
@@ -5,3 +5,4 @@ function add(a, b) {
   return a + b;
 }
+const divide = (a, b) => a / b;
`;

    it('executes multiple lenses concurrently', async () => {
      const plan = [
        { lensId: 'correctness', lensDef: LENS_DEFINITIONS.correctness, tier: 'heavy', model: 'm1' },
        { lensId: 'security', lensDef: LENS_DEFINITIONS.security, tier: 'heavy', model: 'm2' },
        { lensId: 'conventions', lensDef: LENS_DEFINITIONS.conventions, tier: 'light', model: 'm3' },
      ];

      const startTimes = {};
      const endTimes = {};

      const runnerFn = async ({ lens }) => {
        startTimes[lens.id] = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 50));
        endTimes[lens.id] = Date.now();

        if (lens.id === 'correctness') {
          return `
### [P1] Missing division by zero check
- **File**: \`src/calc.js:8\`
- **Side**: RIGHT
- **Confidence**: 0.9

Denominator b is not checked for zero.
`;
        }
        return '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>';
      };

      const t0 = Date.now();
      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });
      const totalTime = Date.now() - t0;

      // Because they run concurrently, total time should be close to 50ms, not 150ms
      assert.ok(totalTime < 130, `Expected parallel execution (<130ms), got ${totalTime}ms`);
      assert.equal(output.results.length, 3);
      assert.equal(output.findings.length, 1);
      assert.equal(output.findings[0].severity, 'P1');
      assert.equal(output.findings[0].file, 'src/calc.js');
      assert.equal(output.findings[0].line, 8);
      assert.equal(output.errors.length, 0);
    });

    it('isolates lens errors so other lenses succeed', async () => {
      const plan = [
        { lensId: 'correctness', lensDef: LENS_DEFINITIONS.correctness, tier: 'heavy', model: 'm1' },
        { lensId: 'security', lensDef: LENS_DEFINITIONS.security, tier: 'heavy', model: 'm2' },
      ];

      const runnerFn = async ({ lens }) => {
        if (lens.id === 'correctness') {
          throw new Error('Rate limit exceeded on heavy tier');
        }
        return `
### [P2] Insecure export
- **File**: \`src/calc.js:8\`
- **Side**: RIGHT
- **Confidence**: 0.8

Explanation.
`;
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.equal(output.results.length, 2);
      assert.equal(output.errors.length, 1);
      assert.equal(output.errors[0].lensId, 'correctness');
      assert.match(output.errors[0].error.message, /Rate limit exceeded/);

      // Security lens findings still captured
      assert.equal(output.findings.length, 1);
      assert.equal(output.findings[0].severity, 'P2');
    });

    it('automatically retries failing lens on fallback model when encountering HTTP 429 quota error', async () => {
      const plan = [
        {
          lensId: 'correctness',
          lensDef: LENS_DEFINITIONS.correctness,
          tier: 'heavy',
          model: 'primary-heavy',
          fallbacks: ['fallback-heavy'],
        },
      ];

      const calls = [];
      const runnerFn = async ({ model }) => {
        calls.push(model);
        if (model === 'primary-heavy') {
          const quotaErr = new Error('HTTP 429: Too Many Requests');
          quotaErr.status = 429;
          throw quotaErr;
        }
        return `
### [P1] Null pointer dereference
- **File**: \`src/calc.js:8\`
- **Side**: RIGHT
- **Confidence**: 0.9

Denominator b is zero.
`;
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.deepEqual(calls, ['primary-heavy', 'fallback-heavy']);
      assert.equal(output.errors.length, 0);
      assert.equal(output.findings.length, 1);
      assert.equal(output.findings[0].severity, 'P1');
      assert.equal(output.results[0].fallbackUsed, true);
      assert.equal(output.results[0].model, 'fallback-heavy');
      assert.equal(output.results[0].primaryModel, 'primary-heavy');
      assert.deepEqual(output.results[0].fallbackModelsTried, ['fallback-heavy']);
    });

    it('chains through multiple fallback models until success', async () => {
      const plan = [
        {
          lensId: 'correctness',
          lensDef: LENS_DEFINITIONS.correctness,
          tier: 'heavy',
          model: 'model-a',
          fallbacks: ['model-b', 'model-c'],
        },
      ];

      const calls = [];
      const runnerFn = async ({ model }) => {
        calls.push(model);
        if (model === 'model-a') {
          throw new Error('Quota exceeded for model-a');
        }
        if (model === 'model-b') {
          const err = new Error('Resource has been exhausted');
          err.code = 'RESOURCE_EXHAUSTED';
          throw err;
        }
        return `
### [P2] Inefficient calculation
- **File**: \`src/calc.js:5\`
- **Side**: RIGHT
- **Confidence**: 0.85

Review notes.
`;
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.deepEqual(calls, ['model-a', 'model-b', 'model-c']);
      assert.equal(output.errors.length, 0);
      assert.equal(output.findings.length, 1);
      assert.equal(output.findings[0].severity, 'P2');
      assert.equal(output.results[0].fallbackUsed, true);
      assert.equal(output.results[0].model, 'model-c');
      assert.deepEqual(output.results[0].fallbackModelsTried, ['model-b', 'model-c']);
    });

    it('preserves completed sibling lens passes when one lens fails and retries on fallback', async () => {
      const plan = [
        {
          lensId: 'correctness',
          lensDef: LENS_DEFINITIONS.correctness,
          tier: 'heavy',
          model: 'claude-3.7-sonnet',
          fallbacks: ['gpt-4o'],
        },
        {
          lensId: 'security',
          lensDef: LENS_DEFINITIONS.security,
          tier: 'heavy',
          model: 'claude-3.7-sonnet',
          fallbacks: ['gpt-4o'],
        },
        {
          lensId: 'conventions',
          lensDef: LENS_DEFINITIONS.conventions,
          tier: 'light',
          model: 'claude-3.5-haiku',
          fallbacks: [],
        },
      ];

      const modelCalls = {};
      const runnerFn = async ({ lens, model }) => {
        if (!modelCalls[lens.id]) modelCalls[lens.id] = [];
        modelCalls[lens.id].push(model);

        // Lens 'correctness' hits capacity on primary, succeeds on fallback
        if (lens.id === 'correctness' && model === 'claude-3.7-sonnet') {
          throw new Error('Model claude-3.7-sonnet is overloaded. Please try again later.');
        }

        return `
### [P1] Issue from ${lens.id}
- **File**: \`src/calc.js:8\`
- **Side**: RIGHT
- **Confidence**: 0.9

Issue identified by ${lens.id} using ${model}.
`;
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.equal(output.errors.length, 0);
      assert.equal(output.findings.length, 3);
      assert.deepEqual(modelCalls.correctness, ['claude-3.7-sonnet', 'gpt-4o']);
      assert.deepEqual(modelCalls.security, ['claude-3.7-sonnet']);
      assert.deepEqual(modelCalls.conventions, ['claude-3.5-haiku']);

      const correctnessResult = output.results.find((r) => r.lensId === 'correctness');
      assert.equal(correctnessResult.fallbackUsed, true);
      assert.equal(correctnessResult.model, 'gpt-4o');

      const securityResult = output.results.find((r) => r.lensId === 'security');
      assert.equal(securityResult.fallbackUsed, false);
      assert.equal(securityResult.model, 'claude-3.7-sonnet');
    });

    it('does not retry when encountering non-quota errors (e.g. syntax or runtime errors)', async () => {
      const plan = [
        {
          lensId: 'correctness',
          lensDef: LENS_DEFINITIONS.correctness,
          tier: 'heavy',
          model: 'primary-model',
          fallbacks: ['fallback-model'],
        },
      ];

      let callCount = 0;
      const runnerFn = async () => {
        callCount++;
        throw new TypeError('Cannot read property undefined');
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      // Must fail fast on non-quota error without retrying
      assert.equal(callCount, 1);
      assert.equal(output.errors.length, 1);
      assert.equal(output.errors[0].lensId, 'correctness');
      assert.ok(output.errors[0].error instanceof TypeError);
      assert.equal(output.results[0].fallbackUsed, false);
    });

    it('returns final error when all fallback models in chain fail with quota errors', async () => {
      const plan = [
        {
          lensId: 'correctness',
          lensDef: LENS_DEFINITIONS.correctness,
          tier: 'heavy',
          model: 'primary-model',
          fallbacks: ['fallback-1', 'fallback-2'],
        },
      ];

      const calls = [];
      const runnerFn = async ({ model }) => {
        calls.push(model);
        throw new Error(`Rate limit exceeded for ${model}`);
      };

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.deepEqual(calls, ['primary-model', 'fallback-1', 'fallback-2']);
      assert.equal(output.errors.length, 1);
      assert.equal(output.errors[0].lensId, 'correctness');
      assert.match(output.errors[0].error.message, /Rate limit exceeded for fallback-2/);
      assert.equal(output.results[0].attemptsCount, 3);
      assert.equal(output.findings.length, 0);
    });

    it('recovers findings when a lens returns degraded or malformed JSON envelope', async () => {
      const plan = [
        {
          lensId: 'security',
          lensDef: LENS_DEFINITIONS.security,
          tier: 'heavy',
          model: 'gpt-4o',
        },
      ];

      const runnerFn = async () => `
Thinking: Analyzing diff for security vulnerabilities...
<<<PR_REVIEW_JSON>>>
[
  {
    "title": "SQL Injection vulnerability",
    "severity": "P0",
    "file": "src/user.js",
    "line": 105,
    "confidence": 0.95,
    "body": "User input directly concatenated into SQL query.",
  },
`;

      const output = await dispatchSubagentsParallel({
        plan,
        diffText: sampleDiff,
        runnerFn,
      });

      assert.equal(output.errors.length, 0);
      assert.equal(output.findings.length, 1);
      assert.equal(output.findings[0].title, 'SQL Injection vulnerability');
      assert.equal(output.findings[0].severity, 'P0');
      assert.equal(output.findings[0].filePath, 'src/user.js');
      assert.equal(output.findings[0].line, 105);
      assert.equal(output.findings[0].lens, 'security');
    });
  });

  describe('createSubagentRunner', () => {
    it('creates mock runner when mock: true', async () => {
      const runner = await createSubagentRunner({ mock: true });
      const output = await runner({
        lens: { id: 'correctness', name: 'Correctness' },
        prompt: 'test prompt',
      });
      assert.match(output, /<<<PR_REVIEW_JSON>>>/);
    });

    it('uses injected copilotClient when provided', async () => {
      let createdWith = null;
      let sentPrompt = null;
      let closed = false;

      const mockClient = {
        createSession: async (options) => {
          createdWith = options;
          return {
            send: async (prompt) => {
              sentPrompt = prompt;
              return { text: '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>' };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      };

      const runner = await createSubagentRunner({ copilotClient: mockClient });
      const output = await runner({
        lens: { id: 'security', name: 'Security' },
        prompt: 'Security review prompt',
        tier: 'heavy',
        model: 'claude-3.7-sonnet',
        reasoningEffort: 'medium',
      });

      assert.equal(createdWith.model, 'claude-3.7-sonnet');
      assert.equal(createdWith.reasoningEffort, 'medium');
      assert.equal(sentPrompt, 'Security review prompt');
      assert.equal(closed, true);
      assert.match(output, /<<<PR_REVIEW_JSON>>>/);
    });

    it('passes tools to copilotClient.createSession when provided', async () => {
      let createdSessionOptions = null;
      const mockClient = {
        createSession: async (options) => {
          createdSessionOptions = options;
          return {
            send: async () => ({ text: '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>' }),
            close: async () => {},
          };
        },
      };

      const runner = await createSubagentRunner({ copilotClient: mockClient });
      const dummyTools = [{ name: 'diff_read', description: 'test tool' }];

      await runner({
        lens: { id: 'correctness', name: 'Correctness' },
        prompt: 'test',
        tools: dummyTools,
      });

      assert.ok(createdSessionOptions);
      assert.deepEqual(createdSessionOptions.tools, dummyTools);
    });
  });

  describe('buildSdkReaderTools & Host-Supervised Tools', () => {
    const sampleDiff = `diff --git a/app.js b/app.js
index 1111111..2222222 100644
--- a/app.js
+++ b/app.js
@@ -1,3 +1,4 @@
 function run() {
+  console.log("hello");
   return 1;
 }
`;

    it('builds Copilot SDK compliant tool declarations from supervised reader', async () => {
      const { createHostSupervisedDiffReader } = await import('../src/diff.js');
      const reader = createHostSupervisedDiffReader({ diffText: sampleDiff });
      const tools = buildSdkReaderTools(reader);

      assert.equal(tools.length, 3);
      const names = tools.map((t) => t.name);
      assert.deepEqual(names, ['diff_read', 'diff_grep', 'diff_find']);

      // Execute diff_read handler
      const readTool = tools.find((t) => t.name === 'diff_read');
      const readResult = await readTool.handler({ offset: 0, limit: 50 });
      assert.ok(readResult.content);
      assert.equal(readResult.readsCount, 1);

      // Execute diff_grep handler
      const grepTool = tools.find((t) => t.name === 'diff_grep');
      const grepResult = await grepTool.handler({ query: 'console.log' });
      assert.ok(grepResult.matches);
      assert.equal(grepResult.matches.length, 1);

      // Execute diff_find handler
      const findTool = tools.find((t) => t.name === 'diff_find');
      const findResult = await findTool.handler({ query: 'app.js' });
      assert.ok(findResult.files);
      assert.equal(findResult.files.length, 1);
    });

    it('returns empty array when reader is null or undefined', () => {
      assert.deepEqual(buildSdkReaderTools(null), []);
      assert.deepEqual(buildSdkReaderTools(undefined), []);
    });

    it('dispatchSubagentsParallel auto-detects diff > 200 KB and passes supervised tools', async () => {
      const largeDiff = 'diff --git a/main.js b/main.js\n' + '+line\n'.repeat(40000);
      let passedTools = null;
      let passedTransport = null;

      const mockRunner = async ({ tools, diffTransport }) => {
        passedTools = tools;
        passedTransport = diffTransport;
        return '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>';
      };

      const plan = resolveLensPlan({ mode: 'quick' });
      const result = await dispatchSubagentsParallel({
        plan,
        diffText: largeDiff,
        runnerFn: mockRunner,
      });

      assert.ok(passedTransport);
      assert.equal(passedTransport.isLarge, true);
      assert.ok(Array.isArray(passedTools));
      assert.equal(passedTools.length, 3);
      assert.equal(result.errors.length, 0);
    });
  });

  describe('isQuotaOrCapacityError and Error Classification', () => {
    it('detects HTTP 429 status and statusCode variations', () => {
      assert.equal(isQuotaOrCapacityError({ status: 429 }), true);
      assert.equal(isQuotaOrCapacityError({ statusCode: 429 }), true);
      assert.equal(isQuotaOrCapacityError({ response: { status: 429 } }), true);
      assert.equal(isQuotaOrCapacityError({ response: { statusCode: 429 } }), true);
      assert.equal(isQuotaOrCapacityError({ code: 429 }), true);
      assert.equal(isQuotaOrCapacityError({ code: '429' }), true);
    });

    it('detects quota and capacity error codes', () => {
      assert.equal(isQuotaOrCapacityError({ code: 'RESOURCE_EXHAUSTED' }), true);
      assert.equal(isQuotaOrCapacityError({ code: 'RATE_LIMIT_EXCEEDED' }), true);
      assert.equal(isQuotaOrCapacityError({ code: 'INSUFFICIENT_QUOTA' }), true);
      assert.equal(isQuotaOrCapacityError({ code: 'QUOTA_EXCEEDED' }), true);
      assert.equal(isQuotaOrCapacityError({ code: 'MODEL_CAPACITY_EXCEEDED' }), true);
      assert.equal(isQuotaOrCapacityError({ error: { code: 'insufficient_quota' } }), true);
      assert.equal(isQuotaOrCapacityError({ response: { data: { error: { code: 'rate_limit_exceeded' } } } }), true);
    });

    it('detects quota, rate limit, capacity, and overloaded keywords in messages', () => {
      assert.equal(isQuotaOrCapacityError(new Error('HTTP 429: Too Many Requests')), true);
      assert.equal(isQuotaOrCapacityError(new Error('Quota exceeded for model claude-3.7-sonnet')), true);
      assert.equal(isQuotaOrCapacityError(new Error('You have exceeded your current quota, please check your plan')), true);
      assert.equal(isQuotaOrCapacityError(new Error('Rate limit reached for requests per minute')), true);
      assert.equal(isQuotaOrCapacityError(new Error('Rate-limited by upstream API gateway')), true);
      assert.equal(isQuotaOrCapacityError(new Error('The model is currently overloaded. Please try again later.')), true);
      assert.equal(isQuotaOrCapacityError(new Error('Server capacity exceeded, request dropped')), true);
      assert.equal(isQuotaOrCapacityError(new Error('Resource has been exhausted (e.g. check quota).')), true);
      assert.equal(isQuotaOrCapacityError(new Error('TPM limit exceeded')), true);
      assert.equal(isQuotaOrCapacityError({ status: 503, message: 'Model is overloaded' }), true);
    });

    it('does not classify unrelated runtime, syntax, network, or timeout bugs as quota errors', () => {
      assert.equal(isQuotaOrCapacityError(new Error('Connection timed out after 30000ms')), false);
      assert.equal(isQuotaOrCapacityError(new Error('ETIMEDOUT: connect timed out')), false);
      assert.equal(isQuotaOrCapacityError({ code: 'ETIMEDOUT', message: 'connection timed out' }), false);
      assert.equal(isQuotaOrCapacityError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:80' }), false);
      assert.equal(isQuotaOrCapacityError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.github.com' }), false);
      assert.equal(isQuotaOrCapacityError(new TypeError('Cannot read properties of undefined (reading status)')), false);
      assert.equal(isQuotaOrCapacityError(new SyntaxError('Unexpected token < in JSON at position 0')), false);
      assert.equal(isQuotaOrCapacityError(new ReferenceError('missingVar is not defined')), false);
      assert.equal(isQuotaOrCapacityError(new Error('404 Not Found')), false);
      assert.equal(isQuotaOrCapacityError(new Error('401 Unauthorized: bad credentials')), false);
      assert.equal(isQuotaOrCapacityError(new Error('500 Internal Server Error')), false);
      assert.equal(isQuotaOrCapacityError(null), false);
      assert.equal(isQuotaOrCapacityError(undefined), false);
      assert.equal(isQuotaOrCapacityError(''), false);
    });

    it('isQuotaError is an alias for isQuotaOrCapacityError', () => {
      assert.equal(isQuotaError, isQuotaOrCapacityError);
    });
  });
});
