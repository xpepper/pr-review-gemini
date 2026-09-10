/**
 * Candidate Finding Recovery Module (Increment 12)
 *
 * Deterministically recovers contract-valid candidate finding blocks from partial,
 * degraded, or malformed model responses (truncated JSON, missing brackets, trailing
 * commas, unclosed objects, unescaped characters) rather than dropping review passes.
 */

export const JSON_ENVELOPE_START = '<<<PR_REVIEW_JSON>>>';
export const JSON_ENVELOPE_END = '<<<END_PR_REVIEW_JSON>>>';

export const VALID_SEVERITIES = ['P0', 'P1', 'P2', 'P3', 'nit'];

const SEVERITY_DESCRIPTIVE_MAP = {
  p0: 'P0',
  blocker: 'P0',
  critical: 'P0',
  fatal: 'P0',
  p1: 'P1',
  high: 'P1',
  major: 'P1',
  severe: 'P1',
  error: 'P1',
  p2: 'P2',
  medium: 'P2',
  moderate: 'P2',
  warn: 'P2',
  warning: 'P2',
  p3: 'P3',
  low: 'P3',
  minor: 'P3',
  info: 'P3',
  informational: 'P3',
  nit: 'nit',
  nits: 'nit',
  cosmetic: 'nit',
  trivial: 'nit',
  style: 'nit',
};

/**
 * Normalizes a severity string to standard P0-nit vocabulary, including descriptive labels.
 *
 * @param {string | null | undefined} raw
 * @returns {'P0' | 'P1' | 'P2' | 'P3' | 'nit'}
 */
export function normalizeSeverity(raw) {
  if (!raw || typeof raw !== 'string') return 'P2';
  const trimmed = raw.trim().toLowerCase();
  if (SEVERITY_DESCRIPTIVE_MAP[trimmed]) {
    return SEVERITY_DESCRIPTIVE_MAP[trimmed];
  }
  const upper = raw.trim().toUpperCase();
  if (VALID_SEVERITIES.includes(upper)) {
    return upper === 'NIT' ? 'nit' : upper;
  }
  return 'P2';
}

/**
 * Normalizes confidence score into a float between 0.0 and 1.0.
 *
 * @param {number | string | null | undefined} raw
 * @returns {number}
 */
export function normalizeConfidence(raw) {
  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return Math.max(0, Math.min(1, raw));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.endsWith('%')) {
      const parsedPct = parseFloat(trimmed.slice(0, -1));
      if (!Number.isNaN(parsedPct)) return Math.max(0, Math.min(1, parsedPct / 100));
    }
    const parsed = parseFloat(trimmed);
    if (!Number.isNaN(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return 1.0;
}

/**
 * Normalizes a line number to a positive integer or null.
 *
 * @param {number | string | null | undefined} raw
 * @returns {number | null}
 */
export function normalizeLine(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const match = raw.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      if (Number.isInteger(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Strips git diff prefixes ('a/' or 'b/') from file paths.
 *
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function cleanFilePath(path) {
  if (!path || typeof path !== 'string') return '';
  let cleaned = path.trim().replace(/^`+|`+$/g, '');
  if (cleaned.startsWith('a/') || cleaned.startsWith('b/')) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Normalizes an arbitrary candidate object into standard finding schema.
 *
 * @param {object} item
 * @returns {object}
 */
export function normalizeFindingCandidate(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const loc = item.location && typeof item.location === 'object' ? item.location : {};
  const rawPath = item.filePath || item.file || item.path || loc.path || loc.file;
  const rawLine = item.line ?? item.endLine ?? item.startLine ?? loc.endLine ?? loc.startLine ?? loc.line;
  const rawSide = item.side || loc.side;

  return {
    title: (item.title || item.name || '').trim(),
    severity: normalizeSeverity(item.severity),
    confidence: normalizeConfidence(item.confidence),
    filePath: cleanFilePath(rawPath),
    line: normalizeLine(rawLine),
    side: String(rawSide || '').toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT',
    commentary: (
      item.commentary ||
      item.body ||
      item.description ||
      item.actual ||
      item.details ||
      [item.trigger, item.expected, item.actual].filter(Boolean).join('\n\n') ||
      ''
    ).trim(),
  };
}

/**
 * Checks whether an object satisfies minimum candidate finding requirements.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isValidFindingCandidate(item) {
  if (!item || typeof item !== 'object') return false;

  const loc = item.location && typeof item.location === 'object' ? item.location : {};
  const hasPath = Boolean(cleanFilePath(item.filePath || item.file || item.path || loc.path || loc.file));
  const hasLine = normalizeLine(item.line ?? item.endLine ?? item.startLine ?? loc.endLine ?? loc.startLine ?? loc.line) !== null;
  const hasSeverity = Boolean(item.severity && typeof item.severity === 'string');
  const hasTitle = Boolean(item.title && typeof item.title === 'string' && item.title.trim());
  const hasBody = Boolean(
    (item.body || item.commentary || item.actual || item.description) &&
    typeof (item.body || item.commentary || item.actual || item.description) === 'string' &&
    (item.body || item.commentary || item.actual || item.description).trim()
  );

  // Must have at least a path or line
  if (!hasPath && !hasLine) {
    return false;
  }

  // And must have a finding indicator (severity, title, or body)
  return hasSeverity || hasTitle || hasBody;
}

/**
 * Strips code fences (e.g. ```json ... ```) from a text string.
 *
 * @param {string} text
 * @returns {string}
 */
function stripFences(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```\s*$/i, '');
  return cleaned.trim();
}

/**
 * Resiliently extracts JSON payload from text containing <<<PR_REVIEW_JSON>>> delimiters
 * or fenced markdown blocks, even if closing tags or delimiters are missing.
 *
 * @param {string} text
 * @returns {string} Extracted JSON candidate string or empty string
 */
export function extractJsonEnvelope(text) {
  if (!text || typeof text !== 'string') return '';

  const raw = text.trim();

  // 1. Delimited envelope <<<PR_REVIEW_JSON>>>
  if (raw.includes(JSON_ENVELOPE_START)) {
    const startIndex = raw.indexOf(JSON_ENVELOPE_START) + JSON_ENVELOPE_START.length;
    let endIndex = -1;
    if (raw.includes(JSON_ENVELOPE_END)) {
      endIndex = raw.indexOf(JSON_ENVELOPE_END, startIndex);
    }

    const jsonSegment = endIndex !== -1 ? raw.slice(startIndex, endIndex) : raw.slice(startIndex);
    return stripFences(jsonSegment);
  }

  // 2. Fenced ```json ... ``` code blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/i;
  const match = jsonCodeBlockRegex.exec(raw);
  if (match) {
    return match[1].trim();
  }

  // 3. Unclosed ```json ...
  const unclosedMatch = /```(?:json)?\s*([\s\S]+)$/i.exec(raw);
  if (unclosedMatch && (unclosedMatch[1].includes('{') || unclosedMatch[1].includes('['))) {
    return unclosedMatch[1].trim();
  }

  // 4. Raw JSON array or object
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    return raw;
  }

  // 5. Look for finding keys within brackets if prose surrounds it
  const firstBracket = raw.indexOf('[');
  const firstBrace = raw.indexOf('{');
  const startIdx =
    firstBracket !== -1 && firstBrace !== -1
      ? Math.min(firstBracket, firstBrace)
      : firstBracket !== -1
      ? firstBracket
      : firstBrace;

  if (startIdx !== -1 && (raw.includes('"severity"') || raw.includes('"file"') || raw.includes('"path"') || raw.includes('"title"'))) {
    const lastBracket = raw.lastIndexOf(']');
    const lastBrace = raw.lastIndexOf('}');
    const endIdx = Math.max(lastBracket, lastBrace);
    if (endIdx > startIdx) {
      return raw.slice(startIdx, endIdx + 1).trim();
    }
    return raw.slice(startIdx).trim();
  }

  return '';
}

/**
 * Repairs malformed JSON string (trailing commas, unclosed brackets/braces, unescaped newlines, comments, smart quotes).
 *
 * @param {string} jsonText
 * @returns {string} Repaired JSON text
 */
export function repairJsonString(jsonText) {
  if (!jsonText || typeof jsonText !== 'string') return '';

  let s = jsonText.trim();

  // 1. Normalize smart quotes to standard quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // 2. Tokenize / parse character by character to strip comments and escape literal newlines in strings
  let out = '';
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < s.length) {
    const char = s[i];

    if (inString) {
      if (escape) {
        out += char;
        escape = false;
      } else if (char === '\\') {
        out += char;
        escape = true;
      } else if (char === '"') {
        out += char;
        inString = false;
      } else if (char === '\n') {
        // Escape literal newline inside JSON string literal
        out += '\\n';
      } else if (char === '\r') {
        // Escape literal carriage return
        out += '\\r';
      } else if (char === '\t') {
        out += '\\t';
      } else {
        out += char;
      }
      i++;
      continue;
    }

    // Outside string
    if (char === '"') {
      out += char;
      inString = true;
      i++;
      continue;
    }

    // Single line comment // ...
    if (char === '/' && s[i + 1] === '/') {
      i += 2;
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }

    // Multi-line comment /* ... */
    if (char === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += char;
    i++;
  }

  // If string was left open at EOF, close it
  if (inString) {
    out += '"';
  }

  // 3. Remove trailing commas before closing } or ]
  out = out.replace(/,\s*([}\]])/g, '$1');

  // 4. Check if it parses immediately
  try {
    JSON.parse(out);
    return out;
  } catch {
    // Continue repairing structure
  }

  // 5. Balance unclosed braces/brackets
  // First, check if there is a truncated trailing element after the last comma:
  // e.g. `[ { "title": "Valid" }, { "title": "Incomplete cut off", "file"`
  // If parsing fails, try pruning the incomplete tail back to the last valid comma!
  const tryParseOrPrune = (candidateStr) => {
    // Attempt closing current open braces/brackets
    const balanced = balanceBrackets(candidateStr);
    try {
      JSON.parse(balanced);
      return balanced;
    } catch {
      // If candidate has a comma, try dropping the fragment after the last comma
      const lastComma = candidateStr.lastIndexOf(',');
      if (lastComma !== -1) {
        const pruned = candidateStr.slice(0, lastComma);
        const prunedBalanced = balanceBrackets(pruned);
        try {
          JSON.parse(prunedBalanced);
          return prunedBalanced;
        } catch {
          // keep trying
        }
      }
      return balanced;
    }
  };

  return tryParseOrPrune(out);
}

/**
 * Balances unclosed brackets and braces at the end of a JSON string.
 *
 * @param {string} str
 * @returns {string}
 */
function balanceBrackets(str) {
  let inString = false;
  let escape = false;
  const stack = [];

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') {
        stack.pop();
      }
    } else if (char === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        stack.pop();
      }
    }
  }

  let suffix = '';
  if (inString) {
    suffix += '"';
  }

  while (stack.length > 0) {
    const open = stack.pop();
    if (open === '{') suffix += '}';
    else if (open === '[') suffix += ']';
  }

  return str + suffix;
}

/**
 * Heuristically extracts individual fields from a malformed/truncated object text snippet via regex.
 *
 * @param {string} slice
 * @returns {object | null}
 */
function extractFieldsFromSlice(slice) {
  const titleMatch = slice.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/i) || slice.match(/"title"\s*:\s*"([^"\r\n]*)/i);
  const sevMatch = slice.match(/"severity"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  const fileMatch =
    slice.match(/"(?:filePath|file|path)"\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
    slice.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  const lineMatch = slice.match(/"(?:line|endLine|startLine)"\s*:\s*(\d+)/i);
  const sideMatch = slice.match(/"side"\s*:\s*"(RIGHT|LEFT)"/i);
  const confMatch = slice.match(/"confidence"\s*:\s*([0-9.]+%?)/i);
  const bodyMatch =
    slice.match(/"(?:body|commentary|actual|description)"\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
    slice.match(/"(?:body|commentary|actual|description)"\s*:\s*"([^"\r\n]*)/i);

  if (!fileMatch && !lineMatch && !titleMatch) {
    return null;
  }

  return {
    title: titleMatch?.[1] || '',
    severity: sevMatch?.[1] || 'P2',
    filePath: fileMatch?.[1] || '',
    line: lineMatch ? parseInt(lineMatch[1], 10) : null,
    side: sideMatch?.[1]?.toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT',
    confidence: confMatch?.[1] || 1.0,
    commentary: bodyMatch?.[1] || '',
  };
}

/**
 * Scans text for candidate JSON objects { ... }, handling unclosed braces, corrupt arrays,
 * or arbitrary text in between objects.
 *
 * @param {string} text
 * @returns {Array<object>} List of parsed candidate objects
 */
export function extractCandidateObjects(text) {
  if (!text || typeof text !== 'string') return [];

  const candidates = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        startIdx = i;
      }
      depth++;
    } else if (char === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const chunk = text.slice(startIdx, i + 1);
          processChunk(chunk, candidates);
          startIdx = -1;
        }
      }
    }
  }

  // Handle unclosed final object chunk due to truncation
  if (depth > 0 && startIdx !== -1) {
    const chunk = text.slice(startIdx);
    // Try regex-based field recovery for truncated object
    const recovered = extractFieldsFromSlice(chunk);
    if (recovered && isValidFindingCandidate(recovered)) {
      candidates.push(recovered);
    }
  }

  return candidates;
}

/**
 * Attempts to parse an individual chunk and add valid findings to candidates list.
 *
 * @param {string} chunk
 * @param {Array<object>} candidates
 */
function processChunk(chunk, candidates) {
  let parsed = null;
  try {
    parsed = JSON.parse(chunk);
  } catch {
    try {
      const repaired = repairJsonString(chunk);
      parsed = JSON.parse(repaired);
    } catch {
      parsed = extractFieldsFromSlice(chunk);
    }
  }

  if (!parsed || typeof parsed !== 'object') return;

  // If object contains candidates or findings array, unwrap
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.candidates)
    ? parsed.candidates
    : Array.isArray(parsed.findings)
    ? parsed.findings
    : [parsed];

  for (const item of items) {
    if (isValidFindingCandidate(item)) {
      candidates.push(item);
    }
  }
}

/**
 * Orchestrates candidate finding recovery from degraded or malformed model output.
 *
 * @param {string | Array<object>} input
 * @returns {Array<object>} Normalized finding objects
 */
export function recoverFindingsFromText(input) {
  if (!input) return [];

  // If already array of objects, normalize each
  if (Array.isArray(input)) {
    return input.filter(isValidFindingCandidate).map(normalizeFindingCandidate);
  }

  if (typeof input !== 'string' || !input.trim()) {
    return [];
  }

  const raw = input.trim();

  // 1. Extract JSON envelope or code block
  const envelopeText = extractJsonEnvelope(raw);
  const textToTry = envelopeText || raw;

  // 2. Direct JSON.parse
  try {
    const parsed = JSON.parse(textToTry);
    const items = Array.isArray(parsed)
      ? parsed
      : parsed.candidates || parsed.findings || parsed.decisions || [];

    if (Array.isArray(items) && items.length > 0) {
      const findings = items.filter(isValidFindingCandidate).map(normalizeFindingCandidate);
      if (findings.length > 0) return findings;
    }
  } catch {
    // Fall through to repair
  }

  // 3. Try repairJsonString
  try {
    const repaired = repairJsonString(textToTry);
    const parsed = JSON.parse(repaired);
    const items = Array.isArray(parsed)
      ? parsed
      : parsed.candidates || parsed.findings || parsed.decisions || [];

    if (Array.isArray(items) && items.length > 0) {
      const findings = items.filter(isValidFindingCandidate).map(normalizeFindingCandidate);
      if (findings.length > 0) return findings;
    }
  } catch {
    // Fall through to candidate object extraction
  }

  // 4. Extract individual candidate objects via balanced-brace and regex recovery
  const candidateObjects = extractCandidateObjects(textToTry);
  if (candidateObjects.length > 0) {
    const findings = candidateObjects.filter(isValidFindingCandidate).map(normalizeFindingCandidate);
    if (findings.length > 0) return findings;
  }

  // If textToTry was envelopeText, also try searching the whole raw input
  if (textToTry !== raw) {
    const rawCandidates = extractCandidateObjects(raw);
    if (rawCandidates.length > 0) {
      const findings = rawCandidates.filter(isValidFindingCandidate).map(normalizeFindingCandidate);
      if (findings.length > 0) return findings;
    }
  }

  return [];
}
