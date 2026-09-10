import readline from 'node:readline';

const SEVERITY_RANK = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  NIT: 4,
});

/**
 * Formats a single finding row for console display.
 *
 * @param {Object} finding
 * @param {number} index - 0-based index
 * @returns {string} Formatted single-line string
 */
export function formatFindingRow(finding, index) {
  const num = `[${index + 1}]`.padEnd(4, ' ');
  const sev = `[${finding.severity || 'P2'}]`.padEnd(6, ' ');
  const confVal = finding.confidence !== undefined && finding.confidence !== null
    ? `${Math.round(finding.confidence * 100)}%`
    : '--%';
  const conf = confVal.padStart(4, ' ');

  const file = finding.filePath || finding.file || 'unknown';
  const line = finding.line !== undefined && finding.line !== null ? `:${finding.line}` : '';
  const side = finding.side ? ` (${finding.side})` : '';
  const loc = `${file}${line}${side}`;

  const title = finding.title || '(No title)';

  return `${num} ${sev}  ${conf}  ${loc}  —  ${title}`;
}

/**
 * Formats a list of findings as a structured, human-readable CLI table.
 *
 * @param {Array<Object>} findings
 * @returns {string} Formatted table string
 */
export function formatFindingsTable(findings = []) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return '  (No findings to display)';
  }

  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 };
  for (const f of findings) {
    const s = f.severity?.toLowerCase?.() === 'nit' ? 'nit' : (f.severity || 'P2');
    if (counts[s] !== undefined) counts[s]++;
  }

  const breakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([sev, count]) => `${sev}: ${count}`)
    .join(' | ') || 'None';

  const rows = findings.map((f, i) => formatFindingRow(f, i)).join('\n');

  return `  #   Sev     Conf  Location  —  Title
────────────────────────────────────────────────────────────────────────────
${rows}
────────────────────────────────────────────────────────────────────────────
Total findings: ${findings.length} (${breakdown})`;
}

/**
 * Parses user input for finding selection.
 *
 * Supported syntaxes:
 * - 'all' or '*': selects all [0..totalCount - 1]
 * - 'none': selects none []
 * - numbers: '1, 3, 5' (1-based displayed numbers converted to 0-based indices)
 * - ranges: '2-4'
 * - exclusions: '-3' or '!3' (deselected)
 * - severity filters: 'p0', 'p1', 'p2', 'p3', 'nit'
 * - min severity: 'min:p2' or '>=p2'
 * - 'no-nits' / 'no-nit': selects all except nits
 *
 * @param {string} input - User input string
 * @param {number} totalCount - Total number of available findings
 * @param {Array<Object>} [findings] - Array of findings for severity matching
 * @param {Object} [options]
 * @param {boolean} [options.defaultAll=false] - Return all if input is empty
 * @returns {Array<number>} Sorted unique 0-based indices
 */
export function parseSelectionInput(input, totalCount, findings = [], options = {}) {
  const { defaultAll = false } = options;

  if (totalCount <= 0) return [];

  const raw = (input ?? '').trim();
  if (!raw) {
    return defaultAll ? Array.from({ length: totalCount }, (_, i) => i) : [];
  }

  const clean = raw.toLowerCase();

  if (clean === 'none') {
    return [];
  }

  if (clean === 'all' || clean === '*') {
    return Array.from({ length: totalCount }, (_, i) => i);
  }

  const selectedSet = new Set();
  const excludedSet = new Set();

  // Tokenize by commas and whitespace
  const tokens = clean.split(/[,;\s]+/).filter(Boolean);

  for (const token of tokens) {
    if (token === 'all' || token === '*') {
      for (let i = 0; i < totalCount; i++) selectedSet.add(i);
      continue;
    }

    if (token === 'none') {
      selectedSet.clear();
      continue;
    }

    if (token === 'no-nits' || token === 'no-nit') {
      for (let i = 0; i < totalCount; i++) {
        const sev = findings[i]?.severity?.toUpperCase?.() || 'P2';
        if (sev !== 'NIT') {
          selectedSet.add(i);
        } else {
          excludedSet.add(i);
        }
      }
      continue;
    }

    // Min severity filter: min:p2 or >=p2
    if (token.startsWith('min:') || token.startsWith('>=')) {
      const targetSev = token.replace(/^(min:|>=\s*)/, '').toUpperCase();
      const maxRank = SEVERITY_RANK[targetSev] ?? 2;
      for (let i = 0; i < totalCount; i++) {
        const s = findings[i]?.severity?.toUpperCase?.() || 'P2';
        const rank = SEVERITY_RANK[s] ?? 2;
        if (rank <= maxRank) {
          selectedSet.add(i);
        }
      }
      continue;
    }

    // Severity name filter: p0, p1, p2, p3, nit
    const upperToken = token.toUpperCase();
    if (SEVERITY_RANK[upperToken] !== undefined) {
      for (let i = 0; i < totalCount; i++) {
        const s = findings[i]?.severity?.toUpperCase?.() || 'P2';
        if (s === upperToken) {
          selectedSet.add(i);
        }
      }
      continue;
    }

    // Exclusions: -number or !number
    if (token.startsWith('-') || token.startsWith('!')) {
      const numStr = token.slice(1);
      const num = parseInt(numStr, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= totalCount) {
        excludedSet.add(num - 1);
      }
      continue;
    }

    // Range: 2-4 or 2..4
    const rangeMatch = token.match(/^(\d+)(?:-|\.\.)(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalCount, Math.max(start, end));
        for (let num = min; num <= max; num++) {
          selectedSet.add(num - 1);
        }
      }
      continue;
    }

    // Single number
    const num = parseInt(token, 10);
    if (!Number.isNaN(num)) {
      if (num >= 1 && num <= totalCount) {
        selectedSet.add(num - 1);
      }
      continue;
    }
  }

  // Remove any exclusions
  for (const ex of excludedSet) {
    selectedSet.delete(ex);
  }

  return Array.from(selectedSet).sort((a, b) => a - b);
}

/**
 * Filters findings by selection criteria (index array, string selector, or 'all').
 *
 * @param {Array<Object>} findings
 * @param {Array<number>|string|null|undefined} selection
 * @returns {Array<Object>} Filtered findings
 */
export function filterFindings(findings = [], selection) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }

  if (selection === null || selection === undefined || selection === 'all') {
    return [...findings];
  }

  let indices = [];
  if (Array.isArray(selection)) {
    indices = selection;
  } else if (typeof selection === 'string') {
    indices = parseSelectionInput(selection, findings.length, findings, { defaultAll: true });
  }

  const result = [];
  for (const idx of indices) {
    if (findings[idx]) {
      result.push(findings[idx]);
    }
  }
  return result;
}

/**
 * Interactively prompts reviewer to select findings to publish.
 *
 * @param {Object} options
 * @param {Array<Object>} options.findings - Array of candidate findings
 * @param {stream.Readable} [options.input] - Input stream (defaults to process.stdin)
 * @param {stream.Writable} [options.output] - Output stream (defaults to process.stdout)
 * @param {boolean} [options.isInteractive=false] - Whether to prompt interactively
 * @param {boolean} [options.defaultAll=true] - If non-interactive, whether to select all
 * @returns {Promise<{ selectedFindings: Array<Object>, selectedIndices: Array<number>, cancelled: boolean }>}
 */
export async function promptFindingSelection({
  findings = [],
  input = process.stdin,
  output = process.stdout,
  isInteractive = false,
  defaultAll = true,
}) {
  if (!findings || findings.length === 0) {
    return { selectedFindings: [], selectedIndices: [], cancelled: false };
  }

  if (!isInteractive) {
    const indices = defaultAll ? Array.from({ length: findings.length }, (_, i) => i) : [];
    return {
      selectedFindings: indices.map((i) => findings[i]),
      selectedIndices: indices,
      cancelled: false,
    };
  }

  const table = formatFindingsTable(findings);
  output.write(`\n🔍 Review Findings for Triage:\n\n${table}\n\n`);

  const rl = readline.createInterface({ input, output, terminal: false });

  return new Promise((resolve) => {
    rl.question(
      'Select findings to publish [all, none, 1-3, p0-p1, q to cancel] (default: all): ',
      (answer) => {
        rl.close();
        const trimmed = (answer || '').trim();

        if (trimmed.toLowerCase() === 'q' || trimmed.toLowerCase() === 'cancel' || trimmed.toLowerCase() === 'abort') {
          output.write('⚠️ Publishing cancelled by user.\n');
          resolve({ selectedFindings: [], selectedIndices: [], cancelled: true });
          return;
        }

        const indices = parseSelectionInput(trimmed, findings.length, findings, { defaultAll: true });
        const selected = indices.map((i) => findings[i]);

        output.write(`✓ Selected ${selected.length} of ${findings.length} findings for publication.\n`);
        resolve({ selectedFindings: selected, selectedIndices: indices, cancelled: false });
      }
    );
  });
}
