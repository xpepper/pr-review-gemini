import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LENS_TIERS,
  resolveLensPlan,
  dispatchSubagentsParallel,
  createSubagentRunner,
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
  });
});
