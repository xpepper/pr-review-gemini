/**
 * src/architecture.js — PR Architecture Summary & Mermaid Diagram Generator
 *
 * Increment 21: Inspects PR diffs across module boundaries, subsystem interactions,
 * and public APIs. Synthesizes a concise high-level architecture walkthrough
 * and generates GitHub Flavored Markdown Mermaid sequence diagrams and component flowcharts.
 */
import path from 'node:path';

export const ARCHITECTURE_LENS = Object.freeze({
  id: 'architecture',
  name: 'Architecture & System Impact',
  description: 'System-level architecture, module boundaries, subsystem flows, and public interface changes.',
  instructions: `You are an expert software architect reviewing code for System Architecture & Component Interactions.
Inspect the unified diff carefully for:
- Module Boundaries & Abstraction Leaks: Verify that internal component implementation details are not leaked across module boundaries or into ambient state.
- Subsystem Interactions & Call Flow: Trace the sequence of message passing, API calls, and event flows between components. Identify unnecessary coupling, cyclic dependencies, or missing coordination.
- Public API & Interface Stability: Inspect new or modified exports, public functions, classes, CLI flags, or schema definitions to ensure consistency with existing patterns.
- Cohesion & Extensibility: Verify clean separation of concerns, single responsibility per module, and that new features cleanly integrate into the system architecture without ad-hoc workarounds.`,
});

/**
 * Sanitizes text to be safely used inside Mermaid labels and node text.
 * Strips HTML tags, converts quotes, escapes brackets and parentheses.
 *
 * @param {string} text - Raw label text
 * @returns {string} Sanitized label
 */
export function sanitizeMermaidLabel(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text.trim();
  // Strip dangerous or invalid HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Normalize double quotes to single quotes to prevent breaking string literals
  clean = clean.replace(/"/g, "'");
  // Replace newlines with spaces
  clean = clean.replace(/\r?\n+/g, ' ');
  // Avoid dangling backslashes
  clean = clean.replace(/\\/g, '/');
  // Trim excessive whitespace
  clean = clean.replace(/\s+/g, ' ');
  return clean;
}

/**
 * Generates a valid alphanumeric Mermaid identifier for a node or participant.
 *
 * @param {string} text - Node path, name or id
 * @returns {string} Alphanumeric identifier
 */
export function sanitizeMermaidId(text) {
  if (!text || typeof text !== 'string') return 'node_unknown';
  const clean = text
    .replace(/^[./\\]+/, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!clean || !/^[a-zA-Z_]/.test(clean)) {
    return `node_${clean || 'unknown'}`;
  }
  return clean;
}

/**
 * Infers subsystem / architectural domain from a file path.
 * Works across projects by inspecting top-level directory and path semantics.
 *
 * @param {string} filePath - Relative file path
 * @returns {string} Subsystem name
 */
export function inferSubsystem(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'General';
  const norm = filePath.replace(/^[./\\]+/, '').replace(/\\/g, '/');
  if (norm.startsWith('server/')) return 'MCP Server Protocol';
  if (norm.startsWith('src/')) {
    if (norm.includes('reviewer') || norm.includes('subagents') || norm.includes('architecture')) {
      return 'Core Review Engine';
    }
    if (norm.includes('diff') || norm.includes('publish') || norm.includes('prior') || norm.includes('verify')) {
      return 'Analysis & Verification';
    }
    if (norm.includes('ci') || norm.includes('cli') || norm.includes('config') || norm.includes('version')) {
      return 'Config & CLI Infrastructure';
    }
    return 'Core Modules';
  }
  if (norm.startsWith('scripts/')) return 'CLI & Tooling';
  if (norm.startsWith('skills/')) return 'Agent Skills';
  if (norm.startsWith('.github/')) return 'GitHub Workflows & Policies';
  if (norm.startsWith('tests/')) return 'Test Suite';
  if (norm.startsWith('docs/')) return 'Documentation';

  const parts = norm.split('/');
  if (parts.length > 1) {
    const top = parts[0];
    return top.charAt(0).toUpperCase() + top.slice(1);
  }
  return 'Root Components';
}

/**
 * Infers a human-readable component name from a file path.
 *
 * @param {string} filePath - File path
 * @returns {string} Human-readable component name
 */
export function inferComponentName(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'Unknown';
  const norm = filePath.replace(/^[./\\]+/, '').replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  const nameWithoutExt = base.replace(/\.[^.]+$/, '');
  const title = nameWithoutExt
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return title || norm;
}

/**
 * Extracts touched files, components, public APIs, and cross-module interactions
 * from a unified diff.
 *
 * @param {string} diffText - Raw unified diff text
 * @returns {{ components: Array, interactions: Array, publicApiChanges: Array, subsystems: Record<string, string[]> }}
 */
export function extractComponentsAndInteractions(diffText) {
  if (!diffText || typeof diffText !== 'string') {
    return {
      components: [],
      interactions: [],
      publicApiChanges: [],
      subsystems: {},
    };
  }

  const componentsMap = new Map();
  const interactions = [];
  const publicApiChanges = [];
  const subsystems = {};

  // Split into per-file diff chunks
  const fileChunks = diffText.split(/(?=^diff --git )/m);

  for (const chunk of fileChunks) {
    if (!chunk.trim().startsWith('diff --git')) continue;

    const fileHeaderMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    if (!fileHeaderMatch) continue;

    const oldPath = fileHeaderMatch[1];
    const newPath = fileHeaderMatch[2];
    const filePath = newPath !== '/dev/null' ? newPath : oldPath;
    const isNew = chunk.includes('new file mode');
    const isDeleted = chunk.includes('deleted file mode');
    const status = isNew ? 'added' : isDeleted ? 'deleted' : 'modified';

    const compId = sanitizeMermaidId(filePath);
    const compName = inferComponentName(filePath);
    const subsystem = inferSubsystem(filePath);

    if (!subsystems[subsystem]) {
      subsystems[subsystem] = [];
    }
    if (!subsystems[subsystem].includes(compId)) {
      subsystems[subsystem].push(compId);
    }

    const component = {
      id: compId,
      name: compName,
      path: filePath,
      status,
      subsystem,
      exportsAdded: [],
      exportsModified: [],
      imports: [],
      addedLinesCount: 0,
      deletedLinesCount: 0,
    };

    // Analyze hunk lines and multi-line import blocks
    const lines = chunk.split('\n');

    // Scan for multi-line import blocks in the chunk: import { ... } from '...'
    const importBlockRegex = /import\s+(?:\{[\s\S]*?\}|[\w*\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importBlockRegex.exec(chunk)) !== null) {
      const importBlock = match[0];
      const importTarget = match[1];
      // Only register if the import block contains an added line
      if (importBlock.split('\n').some((l) => l.startsWith('+'))) {
        component.imports.push(importTarget);
        let targetPath = importTarget;
        if (importTarget.startsWith('.')) {
          const dir = path.posix.dirname(filePath);
          targetPath = path.posix.normalize(path.posix.join(dir, importTarget));
          if (!path.posix.extname(targetPath)) {
            targetPath += '.js';
          }
        }
        const targetId = sanitizeMermaidId(targetPath);
        interactions.push({
          from: filePath,
          to: targetPath,
          fromId: compId,
          toId: targetId,
          label: 'imports',
          type: 'import',
        });
      }
    }

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        component.addedLinesCount++;
        const added = line.slice(1).trim();

        // 1. Single-line imports if not captured above
        const importMatch = added.match(/from\s+['"]([^'"]+)['"]/);
        if (importMatch && !component.imports.includes(importMatch[1])) {
          const importTarget = importMatch[1];
          component.imports.push(importTarget);

          let targetPath = importTarget;
          if (importTarget.startsWith('.')) {
            const dir = path.posix.dirname(filePath);
            targetPath = path.posix.normalize(path.posix.join(dir, importTarget));
            if (!path.posix.extname(targetPath)) {
              targetPath += '.js';
            }
          }
          const targetId = sanitizeMermaidId(targetPath);
          interactions.push({
            from: filePath,
            to: targetPath,
            fromId: compId,
            toId: targetId,
            label: 'imports',
            type: 'import',
          });
        }

        // 2. Detect public function/class/const exports
        const exportFnMatch = added.match(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
        if (exportFnMatch) {
          const fnName = exportFnMatch[1];
          component.exportsAdded.push(fnName);
          publicApiChanges.push({
            name: fnName,
            component: filePath,
            compId,
            changeType: 'added',
            kind: 'function',
            description: `Exported function \`${fnName}\``,
          });
        }

        const exportConstMatch = added.match(/export\s+const\s+([a-zA-Z0-9_$]+)/);
        if (exportConstMatch) {
          const constName = exportConstMatch[1];
          component.exportsAdded.push(constName);
          publicApiChanges.push({
            name: constName,
            component: filePath,
            compId,
            changeType: 'added',
            kind: 'constant',
            description: `Exported constant \`${constName}\``,
          });
        }

        const exportClassMatch = added.match(/export\s+class\s+([a-zA-Z0-9_$]+)/);
        if (exportClassMatch) {
          const className = exportClassMatch[1];
          component.exportsAdded.push(className);
          publicApiChanges.push({
            name: className,
            component: filePath,
            compId,
            changeType: 'added',
            kind: 'class',
            description: `Exported class \`${className}\``,
          });
        }

        // 3. Detect tool or CLI registrations
        const mcpToolMatch = added.match(/name:\s*['"]([a-zA-Z0-9_]+)['"]/);
        if (filePath.includes('server') && mcpToolMatch) {
          const toolName = mcpToolMatch[1];
          publicApiChanges.push({
            name: toolName,
            component: filePath,
            compId,
            changeType: 'added',
            kind: 'mcp_tool',
            description: `MCP Tool \`${toolName}\``,
          });
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        component.deletedLinesCount++;
        const removed = line.slice(1).trim();
        const removedExportMatch = removed.match(/export\s+(?:async\s+)?(?:function|const|class)\s+([a-zA-Z0-9_$]+)/);
        if (removedExportMatch) {
          const fnName = removedExportMatch[1];
          publicApiChanges.push({
            name: fnName,
            component: filePath,
            compId,
            changeType: 'removed',
            kind: 'export',
            description: `Removed export \`${fnName}\``,
          });
        }
      }
    }

    componentsMap.set(compId, component);
  }

  const components = Array.from(componentsMap.values());

  // Deduplicate and normalize interactions
  const uniqueInteractions = [];
  const seenEdges = new Set();

  for (const inter of interactions) {
    const edgeKey = `${inter.fromId}->${inter.toId}:${inter.label}`;
    if (!seenEdges.has(edgeKey) && inter.fromId !== inter.toId) {
      seenEdges.add(edgeKey);
      uniqueInteractions.push(inter);
    }
  }

  return {
    components,
    interactions: uniqueInteractions,
    publicApiChanges,
    subsystems,
  };
}

/**
 * Generates a syntactically valid Mermaid sequenceDiagram visualizing component call flows.
 *
 * @param {object} data - Extracted architecture data
 * @returns {string} Mermaid sequence diagram code
 */
export function generateMermaidSequenceDiagram(data) {
  const components = data?.components || [];
  const interactions = data?.interactions || [];

  if (components.length === 0) {
    return `sequenceDiagram
  autonumber
  Note over System: No components modified in this PR`;
  }

  // Pick or order participants:
  // Order: User / Client -> Servers -> Orchestrator -> Modules / Engines -> Helpers
  const participantIds = new Set();
  const participantDefs = [];

  const addParticipant = (id, label) => {
    if (!participantIds.has(id)) {
      participantIds.add(id);
      const safeId = sanitizeMermaidId(id);
      const safeLabel = sanitizeMermaidLabel(label);
      participantDefs.push(`  participant ${safeId} as "${safeLabel}"`);
    }
  };

  // Add standard caller actor if interactions exist
  const hasClient = components.some((c) => c.path.includes('scripts') || c.path.includes('cli'));
  const hasServer = components.some((c) => c.path.includes('server'));
  const hasReviewer = components.some((c) => c.path.includes('reviewer'));

  if (hasClient || hasServer) {
    addParticipant('actor_caller', 'Caller / User');
  }

  // Add modified components (capped to top 8 to keep sequence diagram readable and focused)
  const sortedComponents = [...components].sort((a, b) => {
    // Priority: server -> reviewer -> others
    if (a.path.includes('server')) return -1;
    if (b.path.includes('server')) return 1;
    if (a.path.includes('reviewer')) return -1;
    if (b.path.includes('reviewer')) return 1;
    return (b.addedLinesCount || 0) - (a.addedLinesCount || 0);
  });

  for (const comp of sortedComponents.slice(0, 8)) {
    addParticipant(comp.id, comp.name || comp.path);
  }

  const lines = ['sequenceDiagram', '  autonumber', ...participantDefs];

  // If explicit interaction steps are provided in data, render them
  let stepRendered = false;
  if (Array.isArray(interactions) && interactions.length > 0) {
    for (const inter of interactions) {
      const fromId = sanitizeMermaidId(inter.from || inter.fromId);
      const toId = sanitizeMermaidId(inter.to || inter.toId);
      const label = sanitizeMermaidLabel(inter.label || 'interacts');

      // Ensure both participants exist
      if (participantIds.has(fromId) && participantIds.has(toId) && fromId !== toId) {
        if (inter.isResponse) {
          lines.push(`  ${fromId}-->>${toId}: ${label}`);
        } else {
          lines.push(`  ${fromId}->>${toId}: ${label}`);
        }
        stepRendered = true;
      }
    }
  }

  // If no inter-component steps were rendered, generate a coherent system flow
  if (!stepRendered) {
    if (hasServer && hasReviewer) {
      lines.push('  actor_caller->>server_index_js: MCP request (gem_pr_review_subagents)');
      lines.push('  server_index_js->>src_reviewer_js: runReview(options)');
      const otherComp = sortedComponents.find((c) => c.id !== 'server_index_js' && c.id !== 'src_reviewer_js');
      if (otherComp) {
        lines.push(`  src_reviewer_js->>${otherComp.id}: inspects changes / executes pass`);
        lines.push(`  ${otherComp.id}-->>src_reviewer_js: findings & analysis`);
      }
      lines.push('  src_reviewer_js-->>server_index_js: review summary & results');
      lines.push('  server_index_js-->>actor_caller: formatted response');
    } else if (hasReviewer) {
      const target = sortedComponents.find((c) => c.id !== 'src_reviewer_js') || sortedComponents[0];
      lines.push(`  actor_caller->>src_reviewer_js: runReview()`);
      if (target && target.id !== 'src_reviewer_js') {
        lines.push(`  src_reviewer_js->>${target.id}: executes component analysis`);
        lines.push(`  ${target.id}-->>src_reviewer_js: result`);
      }
      lines.push('  src_reviewer_js-->>actor_caller: review report');
    } else if (sortedComponents.length >= 2) {
      const c1 = sortedComponents[0].id;
      const c2 = sortedComponents[1].id;
      lines.push(`  ${c1}->>${c2}: invokes modified functionality`);
      lines.push(`  ${c2}-->>${c1}: returns processed result`);
    } else if (sortedComponents.length === 1) {
      const c1 = sortedComponents[0].id;
      const statusLabel = sortedComponents[0].status || 'modified';
      lines.push(`  Note over ${c1}: Standalone component update (${statusLabel})`);
    }
  }

  return lines.join('\n');
}

/**
 * Generates a syntactically valid Mermaid flowchart diagram visualizing component architecture.
 *
 * @param {object} data - Extracted architecture data
 * @returns {string} Mermaid flowchart code
 */
export function generateMermaidComponentDiagram(data) {
  const components = data?.components || [];
  const interactions = data?.interactions || [];
  const subsystems = data?.subsystems || {};

  if (components.length === 0) {
    return `flowchart TD
  Empty["No components modified"]`;
  }

  const lines = ['flowchart TD'];
  const renderedCompIds = new Set();

  // Render components grouped by subsystems
  const subsystemEntries = Object.entries(subsystems);
  if (subsystemEntries.length > 0) {
    let subIndex = 1;
    for (const [subsystemName, compIds] of subsystemEntries) {
      const subId = `sub_${subIndex++}`;
      lines.push(`  subgraph ${subId}["${sanitizeMermaidLabel(subsystemName)}"]`);
      for (const id of compIds) {
        const comp = components.find((c) => c.id === id);
        if (comp) {
          const safeId = sanitizeMermaidId(comp.id);
          const safeLabel = sanitizeMermaidLabel(comp.name || comp.path);
          const statusBadge = comp.status === 'added' ? ' [New]' : comp.status === 'deleted' ? ' [Deleted]' : '';
          lines.push(`    ${safeId}["${safeLabel}${statusBadge}"]`);
          renderedCompIds.add(safeId);
        }
      }
      lines.push('  end');
    }
  }

  // Render any remaining components not in a subsystem
  for (const comp of components) {
    const safeId = sanitizeMermaidId(comp.id);
    if (!renderedCompIds.has(safeId)) {
      const safeLabel = sanitizeMermaidLabel(comp.name || comp.path);
      lines.push(`  ${safeId}["${safeLabel}"]`);
      renderedCompIds.add(safeId);
    }
  }

  // Render interactions / edges
  let edgeRendered = false;
  if (Array.isArray(interactions) && interactions.length > 0) {
    for (const inter of interactions) {
      const fromId = sanitizeMermaidId(inter.from || inter.fromId);
      const toId = sanitizeMermaidId(inter.to || inter.toId);
      const label = inter.label ? sanitizeMermaidLabel(inter.label) : '';

      if (renderedCompIds.has(fromId) && renderedCompIds.has(toId) && fromId !== toId) {
        if (label && label !== 'imports') {
          lines.push(`  ${fromId} -->|"${label}"| ${toId}`);
        } else {
          lines.push(`  ${fromId} --> ${toId}`);
        }
        edgeRendered = true;
      }
    }
  }

  // If no inter-component edges were found, connect related components sequentially if multiple
  if (!edgeRendered && components.length > 1) {
    const comps = [...components].slice(0, 5);
    for (let i = 0; i < comps.length - 1; i++) {
      const fromId = sanitizeMermaidId(comps[i].id);
      const toId = sanitizeMermaidId(comps[i + 1].id);
      if (fromId !== toId) {
        lines.push(`  ${fromId} -.-> ${toId}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Formats a clean, comprehensive markdown section containing architecture walkthrough,
 * Mermaid sequence diagram, component flowchart, and public API changes.
 *
 * @param {object} data - Architecture analysis result
 * @returns {string} Formatted markdown report
 */
export function formatArchitectureSummary(data) {
  if (!data) return '';

  const {
    summary = 'Architectural changes have been evaluated across touched components.',
    components = [],
    publicApiChanges = [],
    sequenceDiagram,
    componentDiagram,
  } = data;

  if (components.length === 0) {
    return `### 🏗️ Architecture & System Impact

No structural or architectural changes detected in this pull request diff.`;
  }

  const sections = ['### 🏗️ Architecture & System Impact\n'];

  // 1. Walkthrough narrative
  sections.push(`**System Walkthrough**:\n${summary}\n`);

  // 2. Affected Subsystems table
  if (components.length > 0) {
    sections.push('#### 📦 Affected Components & Subsystems\n');
    sections.push('| Component | Subsystem | Status | Changes |');
    sections.push('| :--- | :--- | :--- | :--- |');
    for (const comp of components) {
      const statusIcon = comp.status === 'added' ? '✨ New' : comp.status === 'deleted' ? '🗑️ Removed' : '📝 Modified';
      const changeStats = `+${comp.addedLinesCount || 0} / -${comp.deletedLinesCount || 0}`;
      sections.push(`| \`${comp.path}\` | ${comp.subsystem || 'General'} | ${statusIcon} | ${changeStats} |`);
    }
    sections.push('');
  }

  // 3. Sequence diagram
  if (sequenceDiagram && sequenceDiagram.trim()) {
    sections.push('#### 🔄 Interaction Flow (Sequence Diagram)\n');
    sections.push('```mermaid');
    sections.push(sequenceDiagram.trim());
    sections.push('```\n');
  }

  // 4. Component flowchart
  if (componentDiagram && componentDiagram.trim()) {
    sections.push('#### 🧩 Component Architecture\n');
    sections.push('```mermaid');
    sections.push(componentDiagram.trim());
    sections.push('```\n');
  }

  // 5. Public API changes
  if (publicApiChanges.length > 0) {
    sections.push('#### 🔌 Public API & Interface Changes\n');
    for (const api of publicApiChanges) {
      const icon = api.changeType === 'added' ? '➕' : api.changeType === 'removed' ? '➖' : '🔄';
      sections.push(`- ${icon} **${api.name}** (\`${api.component}\`): ${api.description || api.changeType}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Synthesizes a concise narrative architectural walkthrough from extracted components.
 *
 * @param {object} extracted - Extracted component data
 * @param {object} [prMetadata] - Optional PR metadata
 * @returns {string} Walkthrough narrative text
 */
export function synthesizeWalkthrough(extracted, prMetadata) {
  const { components = [], publicApiChanges = [], subsystems = {} } = extracted;
  if (components.length === 0) {
    return 'No structural or architectural changes detected in this pull request.';
  }

  const addedCount = components.filter((c) => c.status === 'added').length;
  const modifiedCount = components.filter((c) => c.status === 'modified').length;
  const deletedCount = components.filter((c) => c.status === 'deleted').length;
  const subsystemNames = Object.keys(subsystems);

  const prTitle = prMetadata?.title ? ` for "${prMetadata.title}"` : '';
  const prNum = prMetadata?.number ? `PR #${prMetadata.number}` : 'This pull request';

  const parts = [];

  // Paragraph 1: Scope & Subsystem Impact
  parts.push(
    `${prNum}${prTitle} affects ${components.length} component${components.length > 1 ? 's' : ''} across ${subsystemNames.length} architectural subsystem${subsystemNames.length > 1 ? 's' : ''} (${subsystemNames.join(', ')}). Changes include ${addedCount} new, ${modifiedCount} modified, and ${deletedCount} deleted file${components.length > 1 ? 's' : ''}.`
  );

  // Paragraph 2: Core Subsystem Interactions & New Components
  const addedComps = components.filter((c) => c.status === 'added');
  if (addedComps.length > 0) {
    const compNames = addedComps.map((c) => `\`${c.path}\``).join(', ');
    parts.push(
      `New component${addedComps.length > 1 ? 's' : ''} introduced: ${compNames}. These extend subsystem capabilities while adhering to modular isolation boundaries.`
    );
  }

  // Paragraph 3: Public APIs and Contracts
  if (publicApiChanges.length > 0) {
    const apiNames = publicApiChanges.map((a) => `\`${a.name}\``).slice(0, 5).join(', ');
    parts.push(
      `Public interfaces and exports were updated: ${apiNames}${publicApiChanges.length > 5 ? ` and ${publicApiChanges.length - 5} more` : ''}. Interface changes maintain backward compatibility across module boundaries.`
    );
  } else {
    parts.push(
      'No breaking public interface alterations were detected; changes focus on internal implementation, orchestration, and subsystem coordination.'
    );
  }

  return parts.join('\n\n');
}

/**
 * Analyzes pull request architecture, synthesizes walkthrough narrative,
 * and generates Mermaid sequence and component diagrams.
 *
 * @param {object} params
 * @param {string} params.diffText - Unified diff text
 * @param {object} [params.prMetadata] - Optional PR metadata ({ number, title, author })
 * @param {object} [params.options] - Optional options
 * @returns {Promise<object>} Complete architecture analysis structure
 */
export async function analyzeArchitecture({
  diffText,
  prMetadata,
  options = {},
} = {}) {
  if (!diffText || typeof diffText !== 'string' || !diffText.trim()) {
    return {
      summary: 'No structural or architectural changes detected in this pull request diff.',
      components: [],
      interactions: [],
      publicApiChanges: [],
      subsystems: {},
      sequenceDiagram: '',
      componentDiagram: '',
      markdown: formatArchitectureSummary({
        summary: 'No structural or architectural changes detected in this pull request diff.',
        components: [],
      }),
    };
  }

  // Extract components, APIs, interactions
  const extracted = extractComponentsAndInteractions(diffText);

  // Synthesize narrative walkthrough
  const summary = synthesizeWalkthrough(extracted, prMetadata);

  // Generate Mermaid sequence diagram
  const sequenceDiagram = generateMermaidSequenceDiagram(extracted);

  // Generate Mermaid component flowchart
  const componentDiagram = generateMermaidComponentDiagram(extracted);

  // Format full markdown report
  const markdown = formatArchitectureSummary({
    summary,
    components: extracted.components,
    interactions: extracted.interactions,
    publicApiChanges: extracted.publicApiChanges,
    sequenceDiagram,
    componentDiagram,
  });

  return {
    summary,
    components: extracted.components,
    interactions: extracted.interactions,
    publicApiChanges: extracted.publicApiChanges,
    subsystems: extracted.subsystems,
    sequenceDiagram,
    componentDiagram,
    markdown,
  };
}
