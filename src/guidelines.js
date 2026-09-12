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
  if (ext && !ALLOWED_GUIDELINES_EXTENSIONS.includes(ext)) {
    return false;
  }

  return true;
}

const GLOBAL_SECTION_PATTERNS = Object.freeze([
  /^global/i,
  /^general/i,
  /^architectur(?:e|al)/i,
  /^(?:code|coding|codebase)\s+(?:rules|standards|invariants|guidelines)/i,
  /^repository (?:rules|invariants|guidelines|standards)/i,
  /^invariants?$/i,
  /^rules?$/i,
  /^standards?$/i,
  /^overview$/i,
]);

/**
 * Checks if a section heading designates global repository guidelines.
 *
 * @param {string} headingText - Heading title
 * @returns {boolean} True if heading matches global section patterns
 */
export function isGlobalHeading(headingText) {
  if (!headingText) return false;
  const clean = headingText.trim();
  return GLOBAL_SECTION_PATTERNS.some((pattern) => pattern.test(clean));
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
    truncated: false,
    truncationWarning: null,
    path: rel,
    relativePath: rel,
    found: false,
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

  const effectiveMaxBytes = Math.min(
    Math.max(1, Number(maxBytes) || MAX_GUIDELINES_BYTES),
    ABSOLUTE_MAX_GUIDELINES_BYTES
  );

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
      let slice = buf.subarray(0, bytesRead).toString('utf8');
      if (slice.endsWith('\uFFFD')) {
        slice = slice.slice(0, -1);
      }
      const warning = `> ⚠️ [Guidelines truncated: file size (${fileSize} bytes) exceeded maximum allowed limit of ${effectiveMaxBytes} bytes]`;
      return {
        content: `${slice}\n\n${warning}`,
        rawContent: slice,
        byteSize: fileSize,
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

  // Explicit prefix e.g. "Lens: Security", "Role: performance", "Lens - Contracts"
  // Require colon or space-separated hyphen so hyphenated titles like "Role-based" do not match
  const prefixMatch = clean.match(/^(?:lens|role)\s*(?::|\s+-)\s*([a-zA-Z0-9_\-]+)/i);
  if (prefixMatch) {
    return prefixMatch[1].toLowerCase().trim();
  }

  // Direct standard lens name e.g. "Security", "Security & Trust", "Performance / Resources"
  const directMatch = clean.match(/^([a-zA-Z0-9_\-]+)(?:\s*(?:&|\/|,)\s*.*)?$/);
  if (directMatch) {
    const candidate = directMatch[1].toLowerCase();
    if (STANDARD_LENS_IDS.includes(candidate)) {
      return candidate;
    }
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
  const lenses = {};
  const sections = [];

  let currentTargetLens = null;
  let currentLensLevel = 0;
  let currentSection = null;
  let isCurrentGlobal = true; // Initial document preamble is global

  for (const line of lines) {
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
        isCurrentGlobal = true;
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
        if (!lenses[currentTargetLens]) {
          lenses[currentTargetLens] = [];
        }
        lenses[currentTargetLens].push(line);
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
      isCurrentGlobal = isGlobal;

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
      if (!lenses[currentTargetLens]) {
        lenses[currentTargetLens] = [];
      }
      lenses[currentTargetLens].push(line);
    } else if (isCurrentGlobal) {
      globalLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentSection.lines.join('\n').trim();
    delete currentSection.lines;
    sections.push(currentSection);
  }

  const normalizedLenses = {};
  for (const [k, arr] of Object.entries(lenses)) {
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

  const lensSpecific =
    (primaryKey && parsedObj.lenses?.[primaryKey]) ||
    (fallbackKey && parsedObj.lenses?.[fallbackKey]) ||
    null;

  let result = '';
  if (lensSpecific) {
    const header = `### Specific Instructions for ${lensName || lensId || 'Specialist Lens'}:`;
    result = globalText ? `${globalText}\n\n${header}\n${lensSpecific}` : `${header}\n${lensSpecific}`;
  } else {
    result = globalText;
  }

  if (truncationWarning && !result.includes(truncationWarning)) {
    result = result ? `${result}\n\n${truncationWarning}` : truncationWarning;
  }

  // Budget capping to avoid context blowout across parallel specialist calls
  if (typeof maxPromptBytes === 'number' && maxPromptBytes > 0 && Buffer.byteLength(result, 'utf8') > maxPromptBytes) {
    const budgetWarning = `\n\n> ⚠️ [Guidelines truncated: prompt budget (${Math.round(maxPromptBytes / 1024)} KB) exceeded]`;
    const buf = Buffer.from(result, 'utf8');
    let sliced = buf.subarray(0, maxPromptBytes).toString('utf8');
    if (sliced.endsWith('\uFFFD')) {
      sliced = sliced.slice(0, -1);
    }
    result = sliced + budgetWarning;
  }

  return result;
}

/**
 * High-level loader discovering, reading, and parsing repository review guidelines.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Workspace root
 * @param {object} [options.config=null] - Resolved configuration object
 * @param {string} [options.guidelinesPath=null] - Explicit path override
 * @returns {{ enabled: boolean, found: boolean, path: string|null, relativePath: string|null, byteSize: number, truncated: boolean, truncationWarning: string|null, rawContent: string, content: string, parsed: object, formatForLens: (lensId: string, options?: object) => string }}
 */
export function loadGuidelines({ cwd = process.cwd(), config = null, guidelinesPath = null } = {}) {
  const isEnabled = config?.guidelines?.enabled !== false;
  if (!isEnabled) {
    return {
      enabled: false,
      found: false,
      path: null,
      relativePath: null,
      byteSize: 0,
      truncated: false,
      truncationWarning: null,
      rawContent: '',
      content: '',
      parsed: { global: '', lenses: {}, sections: [], raw: '' },
      formatForLens: () => '',
    };
  }

  const customPath =
    guidelinesPath ||
    config?.guidelines?.path ||
    config?.review_guidelines_path ||
    config?.guidelines_path ||
    null;

  const discoveredPath = discoverGuidelinesFile({ cwd, customPath });
  if (!discoveredPath) {
    return {
      enabled: true,
      found: false,
      path: null,
      relativePath: null,
      byteSize: 0,
      truncated: false,
      truncationWarning: null,
      rawContent: '',
      content: '',
      parsed: { global: '', lenses: {}, sections: [], raw: '' },
      formatForLens: () => '',
    };
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
 * @returns {{ enabled: boolean, found: boolean, path: string|null, relativePath: string|null, byteSize: number, truncated: boolean }|null}
 */
export function createGuidelinesSummary(guidelines) {
  if (!guidelines) return null;
  const rel = guidelines.relativePath || (guidelines.path && !path.isAbsolute(guidelines.path) ? guidelines.path : null);
  return {
    enabled: guidelines.enabled !== false,
    found: Boolean(guidelines.found),
    path: rel,
    byteSize: guidelines.byteSize || 0,
    truncated: Boolean(guidelines.truncated),
  };
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
  let activeGuidelines = repoGuidelines || null;
  if (!activeGuidelines) {
    try {
      activeGuidelines = loadGuidelines({
        cwd,
        config,
        guidelinesPath: guidelinesPath || config?.guidelines?.path,
      });
    } catch {
      activeGuidelines = null;
    }
  }
  const guidelinesSummary = createGuidelinesSummary(activeGuidelines);
  return { activeGuidelines, guidelinesSummary };
}

