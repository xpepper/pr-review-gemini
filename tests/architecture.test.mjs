import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeMermaidLabel,
  sanitizeMermaidId,
  extractComponentsAndInteractions,
  generateMermaidSequenceDiagram,
  generateMermaidComponentDiagram,
  analyzeArchitecture,
  formatArchitectureSummary,
  ARCHITECTURE_LENS,
} from '../src/architecture.js';

describe('Architecture & Mermaid Diagram Generator (Increment 21)', () => {
  describe('Sanitization & Helpers', () => {
    it('sanitizes labels to prevent Mermaid syntax rendering errors', () => {
      assert.equal(sanitizeMermaidLabel('Normal Label'), 'Normal Label');
      assert.equal(sanitizeMermaidLabel('Label with "quotes"'), 'Label with \'quotes\'');
      assert.equal(sanitizeMermaidLabel('Component (v1.0) [Core]'), 'Component (v1.0) [Core]');
      // Unescaped brackets inside labels that could break flowchart node definitions
      const sanitized = sanitizeMermaidLabel('Dangerous <script>alert(1)</script> & "quotes" [brackets]');
      assert.ok(!sanitized.includes('<script>'), 'HTML tags should be stripped or escaped');
      assert.ok(!sanitized.includes('"'), 'Double quotes should be converted or stripped');
    });

    it('generates safe Mermaid node identifiers from file paths and names', () => {
      assert.equal(sanitizeMermaidId('src/reviewer.js'), 'src_reviewer_js');
      assert.equal(sanitizeMermaidId('server/index.js'), 'server_index_js');
      assert.equal(sanitizeMermaidId('scripts/dogfood-pr.mjs'), 'scripts_dogfood_pr_mjs');
      assert.equal(sanitizeMermaidId(''), 'node_unknown');
    });
  });

  describe('Diff Component & Interaction Extraction', () => {
    const sampleDiff = `diff --git a/src/reviewer.js b/src/reviewer.js
index 1111111..2222222 100644
--- a/src/reviewer.js
+++ b/src/reviewer.js
@@ -10,6 +10,8 @@ import {
   getPrDiff,
 } from './diff.js';
+import { analyzeArchitecture } from './architecture.js';
+import { resolveReviewThreads } from './prior.js';
@@ -200,6 +202,12 @@ export async function runReview(options) {
+  const arch = await analyzeArchitecture(options);
+  return { arch };
 }
+export function getReviewArchitecturePlan() {
+  return {};
+}
diff --git a/src/architecture.js b/src/architecture.js
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/architecture.js
@@ -0,0 +1,15 @@
+import { parseUnifiedDiff } from './diff.js';
+export function analyzeArchitecture(diffText) {
+  return {};
+}
+export function formatArchitectureSummary(data) {
+  return '';
+}
diff --git a/server/index.js b/server/index.js
index 4444444..5555555 100644
--- a/server/index.js
+++ b/server/index.js
@@ -25,6 +25,7 @@ import {
   runReview,
+  analyzeArchitecture,
 } from '../src/reviewer.js';
`;

    it('extracts touched components and classifications from unified diff', () => {
      const extracted = extractComponentsAndInteractions(sampleDiff);
      assert.ok(Array.isArray(extracted.components));
      assert.ok(extracted.components.length >= 3);

      const reviewerComp = extracted.components.find((c) => c.path === 'src/reviewer.js');
      assert.ok(reviewerComp, 'src/reviewer.js should be detected');
      assert.equal(reviewerComp.status, 'modified');

      const archComp = extracted.components.find((c) => c.path === 'src/architecture.js');
      assert.ok(archComp, 'src/architecture.js should be detected');
      assert.equal(archComp.status, 'added');

      const serverComp = extracted.components.find((c) => c.path === 'server/index.js');
      assert.ok(serverComp, 'server/index.js should be detected');
      assert.equal(serverComp.status, 'modified');
    });

    it('extracts cross-module interactions and import dependencies', () => {
      const extracted = extractComponentsAndInteractions(sampleDiff);
      assert.ok(Array.isArray(extracted.interactions));
      assert.ok(extracted.interactions.length > 0);

      // reviewer imports architecture
      const reviewerToArch = extracted.interactions.find(
        (i) => (i.from === 'src/reviewer.js' || i.from === 'src_reviewer_js') &&
               (i.to === 'src/architecture.js' || i.to === 'src_architecture_js' || i.to === './architecture.js')
      );
      assert.ok(reviewerToArch, 'Interaction between reviewer and architecture should be detected');

      // server imports reviewer
      const serverToReviewer = extracted.interactions.find(
        (i) => (i.from === 'server/index.js' || i.from === 'server_index_js') &&
               (i.to === 'src/reviewer.js' || i.to === 'src_reviewer_js' || i.to === '../src/reviewer.js')
      );
      assert.ok(serverToReviewer, 'Interaction between server and reviewer should be detected');
    });

    it('extracts added and modified public exports and APIs', () => {
      const extracted = extractComponentsAndInteractions(sampleDiff);
      assert.ok(Array.isArray(extracted.publicApiChanges));
      assert.ok(extracted.publicApiChanges.length >= 2);

      const exportedNames = extracted.publicApiChanges.map((a) => a.name);
      assert.ok(exportedNames.includes('getReviewArchitecturePlan') || exportedNames.includes('analyzeArchitecture'));
    });
  });

  describe('Mermaid Sequence Diagram Generation', () => {
    it('generates syntactically valid Mermaid sequenceDiagram', () => {
      const extracted = {
        components: [
          { id: 'server', name: 'MCP Server', path: 'server/index.js' },
          { id: 'reviewer', name: 'Review Orchestrator', path: 'src/reviewer.js' },
          { id: 'arch', name: 'Architecture Analyzer', path: 'src/architecture.js' },
        ],
        interactions: [
          { from: 'server', to: 'reviewer', label: 'runReview(options)' },
          { from: 'reviewer', to: 'arch', label: 'analyzeArchitecture(diff)' },
          { from: 'arch', to: 'reviewer', label: 'architectureResult', isResponse: true },
          { from: 'reviewer', to: 'server', label: 'reviewSummary', isResponse: true },
        ],
      };

      const diagram = generateMermaidSequenceDiagram(extracted);
      assert.ok(diagram.startsWith('sequenceDiagram'), 'Should start with sequenceDiagram');
      assert.match(diagram, /autonumber/);
      assert.match(diagram, /participant/);
      assert.match(diagram, /server->>reviewer:/);
      assert.match(diagram, /reviewer->>arch:/);
      assert.match(diagram, /arch-->>reviewer:/);
      assert.match(diagram, /reviewer-->>server:/);
    });

    it('handles single-component or standalone diffs gracefully without breaking syntax', () => {
      const extracted = {
        components: [{ id: 'config', name: 'Config Module', path: 'src/config.js' }],
        interactions: [],
      };
      const diagram = generateMermaidSequenceDiagram(extracted);
      assert.ok(diagram.startsWith('sequenceDiagram'));
      assert.match(diagram, /participant/);
      assert.ok(!diagram.includes('undefined'));
    });
  });

  describe('Mermaid Component Flowchart Diagram Generation', () => {
    it('generates syntactically valid Mermaid flowchart with sanitized node labels', () => {
      const extracted = {
        components: [
          { id: 'client', name: 'CLI Client', path: 'scripts/dogfood-review.mjs', status: 'modified' },
          { id: 'reviewer', name: 'Review Orchestrator', path: 'src/reviewer.js', status: 'modified' },
          { id: 'arch', name: 'Architecture (Analyzer)', path: 'src/architecture.js', status: 'added' },
        ],
        interactions: [
          { from: 'client', to: 'reviewer', label: 'invokes review' },
          { from: 'reviewer', to: 'arch', label: 'extracts architecture' },
        ],
        subsystems: {
          'CLI & Tooling': ['client'],
          'Core Review Engine': ['reviewer', 'arch'],
        },
      };

      const diagram = generateMermaidComponentDiagram(extracted);
      assert.ok(diagram.startsWith('flowchart TD') || diagram.startsWith('flowchart LR') || diagram.startsWith('graph TD'));
      assert.match(diagram, /client\[".*"\]/);
      assert.match(diagram, /reviewer\[".*"\]/);
      assert.match(diagram, /arch\[".*"\]/);
      assert.match(diagram, /-->/);
      // Ensure no raw unbalanced or unescaped characters in labels
      assert.ok(!diagram.includes('("'));
      assert.ok(!diagram.includes('undefined'));
    });
  });

  describe('Architecture Analyzer Orchestrator & Markdown Summary', () => {
    const prDiff = `diff --git a/src/architecture.js b/src/architecture.js
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/architecture.js
@@ -0,0 +1,10 @@
+export function analyzeArchitecture() {
+  return { status: 'ok' };
+}
diff --git a/src/reviewer.js b/src/reviewer.js
index 2222222..3333333 100644
--- a/src/reviewer.js
+++ b/src/reviewer.js
@@ -10,2 +10,3 @@
+import { analyzeArchitecture } from './architecture.js';
`;

    it('analyzes diff and returns complete architecture analysis structure', async () => {
      const result = await analyzeArchitecture({
        diffText: prDiff,
        prMetadata: { number: 21, title: 'Auto-Generated PR Architecture Summary' },
      });

      assert.ok(result);
      assert.ok(typeof result.summary === 'string');
      assert.ok(Array.isArray(result.components));
      assert.ok(Array.isArray(result.interactions));
      assert.ok(typeof result.sequenceDiagram === 'string');
      assert.ok(typeof result.componentDiagram === 'string');
      assert.ok(typeof result.markdown === 'string');

      assert.ok(result.markdown.includes('### 🏗️ Architecture & System Impact'));
      assert.ok(result.markdown.includes('```mermaid'));
      assert.ok(result.markdown.includes('sequenceDiagram'));
    });

    it('formats clean markdown report with formatArchitectureSummary', () => {
      const mockData = {
        summary: 'This PR introduces architecture diagrams generation to the reviewer.',
        components: [
          { id: 'arch', name: 'src/architecture.js', status: 'added' },
          { id: 'rev', name: 'src/reviewer.js', status: 'modified' },
        ],
        interactions: [{ from: 'rev', to: 'arch', label: 'calls' }],
        publicApiChanges: [{ name: 'analyzeArchitecture', component: 'src/architecture.js', changeType: 'added' }],
        sequenceDiagram: 'sequenceDiagram\n  autonumber\n  rev->>arch: calls',
        componentDiagram: 'flowchart TD\n  rev["src/reviewer.js"] --> arch["src/architecture.js"]',
      };

      const md = formatArchitectureSummary(mockData);
      assert.ok(md.includes('### 🏗️ Architecture & System Impact'));
      assert.ok(md.includes('sequenceDiagram'));
      assert.ok(md.includes('flowchart TD'));
      assert.ok(md.includes('Public API & Interface Changes'));
      assert.ok(md.includes('analyzeArchitecture'));
    });

    it('handles empty diffs gracefully with placeholder message', async () => {
      const result = await analyzeArchitecture({ diffText: '' });
      assert.ok(result);
      assert.ok(result.markdown.includes('No structural or architectural changes detected'));
    });

    it('exports ARCHITECTURE_LENS definition for specialist review role', () => {
      assert.ok(ARCHITECTURE_LENS);
      assert.equal(ARCHITECTURE_LENS.id, 'architecture');
      assert.ok(ARCHITECTURE_LENS.name);
      assert.ok(ARCHITECTURE_LENS.instructions);
    });
  });
});
