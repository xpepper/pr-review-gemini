import fs from 'node:fs';
import path from 'node:path';

/**
 * Default guideline filenames checked in order of priority.
 */
export const DEFAULT_GUIDELINE_FILENAMES = Object.freeze([
  '.github/gem-pr-review.md',
  '.github/review-instructions.md',
]);

/**
 * Maximum guidelines size in bytes (64 KB) to guard against context blowout.
 */
export const MAX_GUIDELINES_BYTES = 64 * 1024;

/**
 * Hard ceiling on guidelines file size (512 KB) to prevent unbounded memory allocation.
 */
export const ABSOLUTE_MAX_GUIDELINES_BYTES = 512 * 1024;

/**
 * Maximum prompt budget for guidelines per specialist lens (24 KB) to avoid context blowout.
 */
export const MAX_PROMPT_GUIDELINES_BYTES = 24 * 1024;

/**
 * Standard review lens IDs recognized directly in markdown section headings.
 */
export const STANDARD_LENS_IDS = Object.freeze([
  'correctness',
  'contracts',
  'security',
  'performance',
  'conventions',
  'tests',
]);

/**
 * Standard lens aliases and display name component keywords mapping to canonical lens IDs.
 */
export const STANDARD_LENS_ALIASES = Object.freeze(
  Object.assign(Object.create(null), {
    correctness: 'correctness',
    concurrency: 'correctness',
    contracts: 'contracts',
    data: 'contracts',
    security: 'security',
    trust: 'security',
    performance: 'performance',
    resources: 'performance',
    conventions: 'conventions',
    maintainability: 'conventions',
    tests: 'tests',
    testability: 'tests',
  })
);

const DISALLOWED_SENSITIVE_PATTERNS = [
  /^\.env/i,
  /\.git([\\/]|$)/i,
  /(^|[\\/])\.(?!github([\\/]|$))[a-z0-9_-]+/i, // hidden folders/files except .github
  /(id_rsa|id_ed25519|id_dsa|id_ecdsa)/i,
  /\.(pem|key|p12|pfx|crt|p7b)$/i,
  /(credential|secret|token|password)/i,
];

const ALLOWED_GUIDELINES_EXTENSIONS = Object.freeze(['.md', '.markdown', '.txt']);

/**
 * Validates that a candidate guidelines path does not target sensitive workspace files,
 * hidden credential directories, or unauthorized file extensions.
 *
 * @param {string} filePath - Path to check
 * @param {string|null} [cwd=null] - Optional workspace root to evaluate relative paths safely
 * @returns {boolean} True if path is safe to load as review guidelines
 */
export function isSafeGuidelinesPath(filePath, cwd = null) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return false;
  let candidate = filePath.trim();

  // If cwd is provided and candidate is absolute, evaluate relative to cwd to avoid
  // false positives on parent directories (e.g. /home/user/token-service/...)
  if (cwd && path.isAbsolute(candidate)) {
    try {
      const rel = path.relative(cwd, candidate);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        candidate = rel;
      } else {
        candidate = path.basename(candidate);
      }
    } catch {
      candidate = path.basename(candidate);
    }
  }

  const normalized = candidate.replace(/\\/g, '/');

  for (const pattern of DISALLOWED_SENSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_GUIDELINES_EXTENSIONS.includes(ext)) {
    return false;
  }

  return true;
}

/**
 * Verifies that a target file path resides strictly within a root directory,
 * resolving all symlinks to protect against traversal attacks and symlink escapes.
 *
 * @param {string} filePath - Path to file to check
 * @param {string} rootDir - Allowed root directory
 * @returns {boolean} True if filePath exists and is confined within rootDir
 */
export function isConfinedWithinRoot(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  try {
    const realRoot = fs.realpathSync(rootDir);
    const realFile = fs.realpathSync(filePath);
    const rel = path.relative(realRoot, realFile);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/**
 * Sanitizes guideline text to prevent prompt injection and delimiter breakouts
 * when embedding repository-controlled guidelines into reviewer LLM prompts.
 *
 * @param {string} text - Raw guideline text
 * @returns {string} Sanitized guideline text safe for prompt injection
 */
export function sanitizeGuidelinesForPrompt(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<\s*\/?\s*untrusted_repository_guidelines[^>]*>/gi, (match) =>
      match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    )
    .replace(/<<<\s*PR_REVIEW_JSON\s*>>>/gi, '[ESCAPED_PR_REVIEW_JSON]')
    .replace(/<<<\s*END_PR_REVIEW_JSON\s*>>>/gi, '[ESCAPED_END_PR_REVIEW_JSON]');
}

/**
 * Discovers a review guidelines file in the given workspace.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Workspace root directory
 * @param {string|null} [options.customPath=null] - Explicitly configured path
 * @returns {string|null} Absolute path to guidelines file, or null if not found
 */
export function discoverGuidelinesFile({ cwd = process.cwd(), customPath = null } = {}) {
  if (typeof customPath === 'string' && customPath.trim().length > 0) {
    const trimmed = customPath.trim();
    if (!isSafeGuidelinesPath(trimmed, cwd)) {
      return null;
    }
    const candidate = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
    const rel = path.relative(cwd, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }

    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) return null;
      if (!isConfinedWithinRoot(candidate, cwd)) {
        return null;
      }
      return candidate;
    } catch {
      return null;
    }
  }

  for (const filename of DEFAULT_GUIDELINE_FILENAMES) {
    const candidate = path.resolve(cwd, filename);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      if (!isConfinedWithinRoot(candidate, cwd)) {
        continue;
      }
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Computes a sanitized relative path that never leaks machine user directories.
 *
 * @param {string} filePath - Absolute file path
 * @param {string} cwd - Workspace root
 * @returns {string} Safe relative path or basename
 */
function sanitizeRelativePath(filePath, cwd) {
  if (!filePath) return '';
  try {
    const relative = path.relative(cwd, filePath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/');
    }
    return path.basename(filePath);
  } catch {
    return path.basename(filePath);
  }
}

/**
 * Creates an empty/failed guideline read result object.
 *
 * @param {string|null} [filePath=null] - Candidate file path
 * @param {string|null} [cwd=null] - Workspace root
 * @returns {{ content: string, rawContent: string, byteSize: number, truncated: boolean, truncationWarning: null, path: string|null, relativePath: string|null, found: boolean }}
 */
function emptyGuidelinesResult(filePath = null, cwd = null) {
  const rel = filePath && cwd ? sanitizeRelativePath(filePath, cwd) : null;
  return {
    content: '',
    rawContent: '',
    byteSize: 0,
    originalByteSize: 0,
    truncated: false,
    truncationWarning: null,
    path: rel,
    relativePath: rel,
    found: false,
  };
}

/**
 * Safely truncates a string or buffer to maxBytes without splitting multi-byte UTF-8 sequences.
 *
 * @param {string|Buffer} input - String or Buffer to truncate
 * @param {number} maxBytes - Maximum byte length
 * @returns {string} Safe UTF-8 string truncated to <= maxBytes
 */
export function truncateUtf8Safe(input, maxBytes) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
    return '';
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (buf.length <= maxBytes) {
    return buf.toString('utf8');
  }
  let str = buf.subarray(0, maxBytes).toString('utf8');
  if (str.endsWith('\uFFFD')) {
    str = str.slice(0, -1);
  }
  return str;
}

/**
 * Formats a standardized warning banner when guidelines exceed byte limits.
 *
 * @param {number} byteSize - Actual byte size
 * @param {number} maxBytes - Configured byte limit
 * @returns {string} Standard warning markdown block
 */
export function formatTruncationWarning(byteSize, maxBytes) {
  return `> ⚠️ [Guidelines truncated: file size (${byteSize} bytes) exceeded maximum allowed limit of ${maxBytes} bytes]`;
}

/**
 * Resolves the effective maximum guidelines byte limit within safe bounds.
 *
 * @param {number|any} maxBytes - Candidate max bytes
 * @returns {number} Bound max bytes between 1 and ABSOLUTE_MAX_GUIDELINES_BYTES
 */
export function resolveMaxGuidelinesBytes(maxBytes) {
  if (typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0) {
    return Math.min(Math.max(1, Math.floor(maxBytes)), ABSOLUTE_MAX_GUIDELINES_BYTES);
  }
  return MAX_GUIDELINES_BYTES;
}

/**
 * Applies size limits to guidelines content string, safely truncating and formatting a warning banner if needed.
 *
 * @param {string} rawContent - Raw guidelines content
 * @param {number} [maxBytes] - Optional byte limit
 * @returns {{ content: string, rawContent: string, byteSize: number, truncated: boolean, truncationWarning: string|null }}
 */
export function applyGuidelinesContentLimit(rawContent, maxBytes) {
  const effectiveMax = resolveMaxGuidelinesBytes(maxBytes);
  const text = typeof rawContent === 'string' ? rawContent : '';
  const totalBytes = Buffer.byteLength(text, 'utf8');
  const isTruncated = totalBytes > effectiveMax;
  const safeContent = isTruncated ? truncateUtf8Safe(text, effectiveMax) : text;
  const truncationWarning = isTruncated ? formatTruncationWarning(totalBytes, effectiveMax) : null;
  return {
    rawContent: safeContent,
    content: truncationWarning ? `${safeContent}\n\n${truncationWarning}` : safeContent,
    byteSize: Buffer.byteLength(safeContent, 'utf8'),
    originalByteSize: totalBytes,
    truncated: isTruncated,
    truncationWarning,
  };
}

/**
 * Reads a guideline file with size bounding and relative path resolution.
 *
 * @param {string} filePath - Path to guideline file
 * @param {object} [options]
 * @param {number} [options.maxBytes=MAX_GUIDELINES_BYTES] - Maximum allowed bytes
 * @param {string} [options.cwd=process.cwd()] - Current working directory
 * @returns {{ content: string, rawContent: string, byteSize: number, truncated: boolean, truncationWarning: string|null, path: string|null, relativePath: string|null, found: boolean }}
 */
export function readGuidelinesFile(filePath, { maxBytes = MAX_GUIDELINES_BYTES, cwd = process.cwd() } = {}) {
  if (!filePath) {
    return emptyGuidelinesResult();
  }

  if (typeof filePath === 'string' && !isSafeGuidelinesPath(filePath, cwd)) {
    return emptyGuidelinesResult(filePath, cwd);
  }

  const target = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

  let realCwd;
  let realTarget;
  try {
    realCwd = fs.realpathSync(cwd);
    realTarget = fs.realpathSync(target);
  } catch {
    return emptyGuidelinesResult(target, cwd);
  }

  const realRel = path.relative(realCwd, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    return emptyGuidelinesResult(realTarget, realCwd);
  }

  // Prevent symlink bypass to sensitive files (e.g. symlink pointing to .env)
  if (!isSafeGuidelinesPath(realRel, realCwd) || !isSafeGuidelinesPath(realTarget, realCwd)) {
    return emptyGuidelinesResult(realTarget, realCwd);
  }

  const relativePath = sanitizeRelativePath(realTarget, realCwd);
  const effectiveMaxBytes = resolveMaxGuidelinesBytes(maxBytes);

  let fd;
  try {
    // Open the fully resolved target with O_NOFOLLOW to ensure it cannot be replaced by a symlink
    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(realTarget, openFlags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return emptyGuidelinesResult(realTarget, realCwd);
    }

    const fileSize = stat.size;

    if (fileSize > effectiveMaxBytes) {
      const buf = Buffer.alloc(effectiveMaxBytes);
      const bytesRead = fs.readSync(fd, buf, 0, effectiveMaxBytes, 0);
      const slice = truncateUtf8Safe(buf.subarray(0, bytesRead), effectiveMaxBytes);
      const warning = formatTruncationWarning(fileSize, effectiveMaxBytes);
      const truncatedByteSize = Buffer.byteLength(slice, 'utf8');
      return {
        content: `${slice}\n\n${warning}`,
        rawContent: slice,
        byteSize: truncatedByteSize,
        originalByteSize: fileSize,
        truncated: true,
        truncationWarning: warning,
        path: relativePath,
        relativePath,
        found: true,
      };
    }

    const buf = Buffer.alloc(fileSize);
    const bytesRead = fs.readSync(fd, buf, 0, fileSize, 0);
    const rawContent = buf.subarray(0, bytesRead).toString('utf8');
    return {
      content: rawContent,
      rawContent,
      byteSize: fileSize,
      originalByteSize: fileSize,
      truncated: false,
      truncationWarning: null,
      path: relativePath,
      relativePath,
      found: true,
    };
  } catch {
    return emptyGuidelinesResult(realTarget, realCwd);
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

/**
 * Extracts a target lens/role ID from a markdown heading if present.
 *
 * @param {string} headingText - Markdown heading text (without '#' prefix)
 * @returns {string|null} Normalized lens/role ID or null
 */
function extractTargetLensId(headingText) {
  if (!headingText) return null;
  const clean = headingText.trim();

  // Strip optional "Lens:" or "Role:" prefix (e.g. "Lens: Security", "Role - Performance")
  const prefixMatch = clean.match(/^(?:lens|role)\s*(?::|\s+-)\s*(.+)$/i);
  const target = prefixMatch ? prefixMatch[1].trim() : clean;

  // Direct word match against standard lens IDs or display aliases (e.g. "Security & Trust", "Concurrency")
  const firstWordMatch = target.match(/^([a-zA-Z0-9_\-]+)/);
  if (firstWordMatch) {
    const candidate = firstWordMatch[1].toLowerCase();
    if (STANDARD_LENS_IDS.includes(candidate)) {
      return candidate;
    }
    if (Object.prototype.hasOwnProperty.call(STANDARD_LENS_ALIASES, candidate)) {
      return STANDARD_LENS_ALIASES[candidate];
    }
  }

  // If explicit prefix was used (e.g. "Role: custom-role" or "Role: Database Optimizer"),
  // return normalized kebab-case identifier
  if (prefixMatch) {
    return target
      .toLowerCase()
      .replace(/[^a-z0-9_\-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  return null;
}

/**
 * Parses markdown review guidelines into global instructions and per-lens/role sections.
 *
 * @param {string} markdown - Raw markdown guidelines text
 * @returns {{ global: string, lenses: Record<string, string>, sections: Array<{ heading: string, level: number, lensId: string|null, content: string }>, raw: string }}
 */
export function parseGuidelines(markdown) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return {
      global: '',
      lenses: {},
      sections: [],
      raw: markdown || '',
    };
  }

  const lines = markdown.split(/\r?\n/);
  const globalLines = [];
  const lenses = new Map();
  const sections = [];

  let inCodeBlock = false;
  let codeBlockFence = null;
  let currentTargetLens = null;
  let currentLensLevel = 0;
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const fence = trimmed.slice(0, 3);
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockFence = fence;
      } else if (trimmed.startsWith(codeBlockFence)) {
        inCodeBlock = false;
        codeBlockFence = null;
      }
    }

    if (inCodeBlock) {
      if (currentSection) {
        currentSection.lines.push(line);
      }
      if (currentTargetLens) {
        if (!lenses.has(currentTargetLens)) {
          lenses.set(currentTargetLens, []);
        }
        lenses.get(currentTargetLens).push(line);
      } else {
        globalLines.push(line);
      }
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const targetLens = extractTargetLensId(headingText);

      // Top-level document title (# ...) is part of document preamble / global ONLY if not a lens section
      if (level === 1 && !targetLens) {
        if (currentSection) {
          currentSection.content = currentSection.lines.join('\n').trim();
          delete currentSection.lines;
          sections.push(currentSection);
        }
        currentTargetLens = null;
        currentLensLevel = 0;
        currentSection = {
          heading: headingText,
          level,
          lensId: null,
          isGlobal: true,
          lines: [],
        };
        globalLines.push(line);
        continue;
      }

      // If already inside a lens section and heading is a nested subsection (level > currentLensLevel),
      // preserve it within the active lens section!
      if (currentTargetLens && level > currentLensLevel) {
        if (currentSection) {
          currentSection.lines.push(line);
        }
        if (!lenses.has(currentTargetLens)) {
          lenses.set(currentTargetLens, []);
        }
        lenses.get(currentTargetLens).push(line);
        continue;
      }

      // Close the previous section
      if (currentSection) {
        currentSection.content = currentSection.lines.join('\n').trim();
        delete currentSection.lines;
        sections.push(currentSection);
      }

      const isGlobal = !targetLens;

      currentTargetLens = targetLens;
      currentLensLevel = targetLens ? level : 0;

      currentSection = {
        heading: headingText,
        level,
        lensId: targetLens,
        isGlobal,
        lines: [],
      };

      if (isGlobal) {
        globalLines.push(line);
      }
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    }

    if (currentTargetLens) {
      if (!lenses.has(currentTargetLens)) {
        lenses.set(currentTargetLens, []);
      }
      lenses.get(currentTargetLens).push(line);
    } else {
      globalLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentSection.lines.join('\n').trim();
    delete currentSection.lines;
    sections.push(currentSection);
  }

  const normalizedLenses = Object.create(null);
  for (const [k, arr] of lenses.entries()) {
    if (k === '__proto__') continue;
    const text = arr.join('\n').trim();
    if (text.length > 0) {
      normalizedLenses[k] = text;
    }
  }

  return {
    global: globalLines.join('\n').trim(),
    lenses: normalizedLenses,
    sections,
    raw: markdown,
  };
}

/**
 * Resolves formatted guidelines text for a specific review lens.
 * Combines global repository guidelines with lens-specific section instructions.
 *
 * @param {object} options
 * @param {object|string} options.parsed - Parsed guidelines object or markdown string
 * @param {string} options.lensId - Lens or role identifier
 * @param {string} [options.roleId] - Optional role identifier
 * @param {string} [options.lensName] - Optional display name for the lens
 * @returns {string} Formatted guidelines block
 */
export function resolveGuidelinesForLens({
  parsed,
  lensId,
  roleId,
  lensName,
  truncationWarning = null,
  maxPromptBytes = MAX_PROMPT_GUIDELINES_BYTES,
} = {}) {
  if (!parsed) return '';

  const parsedObj = typeof parsed === 'string' ? parseGuidelines(parsed) : parsed;
  const globalText = parsedObj.global || '';
  const primaryKey = (lensId || '').toLowerCase().trim();
  const fallbackKey = (roleId || '').toLowerCase().trim();

  const lensesObj = parsedObj.lenses;
  const lensSpecific =
    (primaryKey && lensesObj && Object.prototype.hasOwnProperty.call(lensesObj, primaryKey)
      ? lensesObj[primaryKey]
      : null) ||
    (fallbackKey && lensesObj && Object.prototype.hasOwnProperty.call(lensesObj, fallbackKey)
      ? lensesObj[fallbackKey]
      : null) ||
    null;

  let result = '';
  const header = lensSpecific
    ? `### Specific Instructions for ${lensName || lensId || 'Specialist Lens'}:`
    : '';
  const lensBlock = lensSpecific ? `${header}\n${lensSpecific}` : '';

  const exceedsBudget =
    typeof maxPromptBytes === 'number' &&
    maxPromptBytes > 0 &&
    Buffer.byteLength(globalText + (lensBlock ? `\n\n${lensBlock}` : ''), 'utf8') > maxPromptBytes;

  if (exceedsBudget) {
    const budgetWarning = `\n\n> ⚠️ [Guidelines truncated: prompt budget (${Math.round(maxPromptBytes / 1024)} KB) exceeded]`;
    const warningBytes = Buffer.byteLength(budgetWarning, 'utf8');
    const contentBudget = Math.max(10, maxPromptBytes - warningBytes);

    if (lensBlock) {
      // Ensure lens-specific instructions are preserved and not crowded out by global instructions
      const maxLensBytes = Math.max(10, Math.floor(contentBudget * 0.5));
      const trimmedLensBlock =
        Buffer.byteLength(lensBlock, 'utf8') > maxLensBytes
          ? truncateUtf8Safe(lensBlock, maxLensBytes)
          : lensBlock;

      const remainingForGlobal = Math.max(
        0,
        contentBudget - Buffer.byteLength(trimmedLensBlock, 'utf8') - 2
      );
      const trimmedGlobal = remainingForGlobal > 0 ? truncateUtf8Safe(globalText, remainingForGlobal) : '';
      result = trimmedGlobal ? `${trimmedGlobal}\n\n${trimmedLensBlock}` : trimmedLensBlock;
    } else {
      result = truncateUtf8Safe(globalText, contentBudget);
    }
    result = `${result}${budgetWarning}`;
  } else {
    if (lensBlock) {
      result = globalText ? `${globalText}\n\n${lensBlock}` : lensBlock;
    } else {
      result = globalText;
    }

    if (truncationWarning && !result.includes(truncationWarning)) {
      result = result ? `${result}\n\n${truncationWarning}` : truncationWarning;
    }
  }

  return result;
}

/**
 * Formats guidelines text for a specific lens from a guidelines object, raw string, or fallback.
 *
 * @param {object|string|null} repoGuidelines - Guidelines object or string
 * @param {string} lensId - Target lens ID
 * @param {object} [options] - Options passed to formatForLens (e.g. lensName)
 * @returns {string} Formatted guidelines text
 */
export function formatGuidelinesForLens(repoGuidelines, lensId, options = {}) {
  if (!repoGuidelines) return '';
  if (typeof repoGuidelines === 'string') return repoGuidelines;
  if (typeof repoGuidelines.formatForLens === 'function') {
    return repoGuidelines.formatForLens(lensId, options);
  }
  return repoGuidelines.content || '';
}

/**
 * Creates a standardized empty guidelines object.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {boolean} [options.found=false]
 * @param {string|null} [options.path=null]
 * @param {string|null} [options.relativePath=null]
 * @param {boolean} [options.untrustedInPr=false]
 * @returns {object}
 */
export function createEmptyGuidelines({
  enabled = true,
  found = false,
  path: targetPath = null,
  relativePath: targetRelativePath = null,
  untrustedInPr = false,
} = {}) {
  const resolvedPath = targetRelativePath || targetPath || null;
  return {
    enabled,
    found,
    path: resolvedPath,
    relativePath: resolvedPath,
    byteSize: 0,
    originalByteSize: 0,
    truncated: false,
    truncationWarning: null,
    rawContent: '',
    content: '',
    parsed: { global: '', lenses: {}, sections: [], raw: '' },
    formatForLens: () => '',
    ...(untrustedInPr ? { untrustedInPr: true } : {}),
  };
}

/**
 * Builds an active guidelines descriptor from base ref raw content.
 *
 * @param {string} rawContent - Guidelines content from base ref
 * @param {string} filePath - Candidate guideline file path
 * @param {number} [maxBytes] - Optional byte limit
 * @returns {object} Guidelines descriptor
 */
export function buildBaseRefGuidelines(rawContent, filePath, maxBytes) {
  const limited = applyGuidelinesContentLimit(rawContent, maxBytes);
  const parsed = parseGuidelines(limited.rawContent);
  return {
    enabled: true,
    found: true,
    path: filePath,
    relativePath: filePath,
    byteSize: limited.byteSize,
    originalByteSize: limited.originalByteSize,
    truncated: limited.truncated,
    truncationWarning: limited.truncationWarning,
    rawContent: limited.rawContent,
    content: limited.content,
    parsed,
    formatForLens: (lensId, opts = {}) =>
      resolveGuidelinesForLens({ parsed, lensId, truncationWarning: limited.truncationWarning, ...opts }),
    source: 'base_ref',
  };
}

/**
 * High-level loader discovering, reading, and parsing repository review guidelines.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Workspace root
 * @param {object} [options.config=null] - Resolved configuration object
 * @param {string} [options.guidelinesPath=null] - Explicit path override
 * @returns {{ enabled: boolean, found: boolean, path: string|null, relativePath: string|null, byteSize: number, originalByteSize: number, truncated: boolean, truncationWarning: string|null, rawContent: string, content: string, parsed: object, formatForLens: (lensId: string, options?: object) => string }}
 */
export function loadGuidelines({ cwd = process.cwd(), config = null, guidelinesPath = null } = {}) {
  const isEnabled = config?.guidelines?.enabled !== false;
  if (!isEnabled) {
    return createEmptyGuidelines({ enabled: false, found: false });
  }

  const customPath =
    guidelinesPath ||
    config?.guidelines?.path ||
    config?.review_guidelines_path ||
    config?.guidelines_path ||
    null;

  const discoveredPath = discoverGuidelinesFile({ cwd, customPath });
  if (!discoveredPath) {
    return createEmptyGuidelines({ enabled: true, found: false });
  }

  const configuredMax = config?.guidelines?.max_bytes;
  const maxBytes =
    typeof configuredMax === 'number' && Number.isFinite(configuredMax) && configuredMax > 0
      ? Math.min(configuredMax, ABSOLUTE_MAX_GUIDELINES_BYTES)
      : MAX_GUIDELINES_BYTES;
  const fileResult = readGuidelinesFile(discoveredPath, { maxBytes, cwd });
  const parsed = parseGuidelines(fileResult.rawContent || fileResult.content);

  return {
    enabled: true,
    found: fileResult.found,
    path: fileResult.path,
    relativePath: fileResult.relativePath,
    byteSize: fileResult.byteSize,
    originalByteSize: fileResult.originalByteSize,
    truncated: fileResult.truncated,
    truncationWarning: fileResult.truncationWarning,
    rawContent: fileResult.rawContent,
    content: fileResult.content,
    parsed,
    formatForLens: (lensId, opts = {}) =>
      resolveGuidelinesForLens({ parsed, lensId, truncationWarning: fileResult.truncationWarning, ...opts }),
  };
}

/**
 * Creates a sanitized, public-safe guidelines summary object without local machine paths.
 *
 * @param {object|null} guidelines - Guidelines object from loadGuidelines
 * @returns {{ enabled: boolean, found: boolean, path: string|null, relativePath: string|null, byteSize: number, originalByteSize: number, truncated: boolean }|null}
 */
export function createGuidelinesSummary(guidelines) {
  if (!guidelines) return null;
  let rel = null;
  const rawRel = guidelines.relativePath || guidelines.path;
  if (rawRel && typeof rawRel === 'string') {
    if (!path.isAbsolute(rawRel)) {
      rel = rawRel.replace(/\\/g, '/');
    } else {
      rel = path.basename(rawRel);
    }
  }
  return {
    enabled: guidelines.enabled !== false,
    found: Boolean(guidelines.found),
    path: rel,
    relativePath: rel,
    byteSize: guidelines.byteSize || 0,
    truncated: Boolean(guidelines.truncated),
    ...(guidelines.untrustedInPr ? { untrustedInPr: true } : {}),
  };
}

/**
 * Formats a sanitized, standardized guidelines line for review summaries.
 *
 * @param {object|null} guidelines - Guidelines object or summary
 * @returns {string} Formatted markdown line or empty string
 */
export function formatGuidelinesSummaryLine(guidelines) {
  if (!guidelines || !guidelines.found) return '';
  const rawPath = guidelines.relativePath || guidelines.path;
  if (!rawPath || typeof rawPath !== 'string') return '';
  const gPath = !path.isAbsolute(rawPath) ? rawPath.replace(/\\/g, '/') : path.basename(rawPath);
  let suffix = '';
  if (guidelines.untrustedInPr) {
    suffix = ' ⚠️ (modified in PR; excluded from prompt to prevent injection)';
  } else if (guidelines.truncated) {
    suffix = ' ⚠️ (truncated)';
  }
  return `- **Repository Guidelines**: \`${gPath}\`${suffix}`;
}

/**
 * Centrally resolves and loads active repository review guidelines.
 * Used by runReview (PR review) and runSelfReview (local self-review)
 * to maintain consistent precedence, error handling, and summary shapes.
 *
 * @param {object} [options]
 * @param {object|string|null} [options.repoGuidelines=null] - Pre-supplied guidelines object/string
 * @param {string|null} [options.guidelinesPath=null] - Explicit path override
 * @param {object|null} [options.config=null] - Loaded configuration
 * @param {string} [options.cwd=process.cwd()] - Current working directory
 * @returns {{ activeGuidelines: object|null, guidelinesSummary: object|null }}
 */
export function resolveActiveGuidelines({
  repoGuidelines = null,
  guidelinesPath = null,
  config = null,
  cwd = process.cwd(),
} = {}) {
  let activeGuidelines = null;
  if (typeof repoGuidelines === 'string') {
    activeGuidelines = buildBaseRefGuidelines(
      repoGuidelines,
      guidelinesPath || '.github/gem-pr-review.md',
      config?.guidelines?.max_bytes
    );
  } else if (repoGuidelines && typeof repoGuidelines === 'object') {
    activeGuidelines = repoGuidelines;
  } else {
    try {
      activeGuidelines = loadGuidelines({
        cwd,
        config,
        guidelinesPath: guidelinesPath || config?.guidelines?.path,
      });
    } catch {
      activeGuidelines = createEmptyGuidelines({
        enabled: config?.guidelines?.enabled !== false,
        found: false,
      });
    }
  }
  const guidelinesSummary = createGuidelinesSummary(activeGuidelines);
  return { activeGuidelines, guidelinesSummary };
}

