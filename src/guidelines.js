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
    const candidate = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
    const rel = path.relative(cwd, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }

    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) return null;

      // Verify realpath to guard against symlink path traversal escapes
      const realCwd = fs.realpathSync(cwd);
      const realCandidate = fs.realpathSync(candidate);
      const realRel = path.relative(realCwd, realCandidate);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
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

      // Ensure candidate does not escape cwd via symlinks
      const realCwd = fs.realpathSync(cwd);
      const realCandidate = fs.realpathSync(candidate);
      const realRel = path.relative(realCwd, realCandidate);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
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
 * Reads a guideline file with size bounding and relative path resolution.
 *
 * @param {string} filePath - Path to guideline file
 * @param {object} [options]
 * @param {number} [options.maxBytes=MAX_GUIDELINES_BYTES] - Maximum allowed bytes
 * @param {string} [options.cwd=process.cwd()] - Current working directory
 * @returns {{ content: string, rawContent: string, byteSize: number, truncated: boolean, path: string|null, relativePath: string|null, found: boolean }}
 */
export function readGuidelinesFile(filePath, { maxBytes = MAX_GUIDELINES_BYTES, cwd = process.cwd() } = {}) {
  if (!filePath) {
    return {
      content: '',
      rawContent: '',
      byteSize: 0,
      truncated: false,
      path: null,
      relativePath: null,
      found: false,
    };
  }

  const relativePath = sanitizeRelativePath(filePath, cwd);

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {
        content: '',
        rawContent: '',
        byteSize: 0,
        truncated: false,
        path: relativePath,
        relativePath,
        found: false,
      };
    }

    const fileSize = stat.size;

    if (fileSize > maxBytes) {
      // Read ONLY up to maxBytes to avoid reading multi-MB files into memory
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(maxBytes);
      let slice = '';
      try {
        const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
        slice = buf.subarray(0, bytesRead).toString('utf8');
        if (slice.endsWith('\uFFFD')) {
          slice = slice.slice(0, -1);
        }
      } finally {
        fs.closeSync(fd);
      }
      const warning = `\n\n> ⚠️ [Guidelines truncated: file size (${fileSize} bytes) exceeded maximum allowed limit of ${maxBytes} bytes]`;
      return {
        content: slice + warning,
        rawContent: slice,
        byteSize: fileSize,
        truncated: true,
        path: relativePath,
        relativePath,
        found: true,
      };
    }

    const rawContent = fs.readFileSync(filePath, 'utf8');
    const byteSize = Buffer.byteLength(rawContent, 'utf8');
    return {
      content: rawContent,
      rawContent,
      byteSize,
      truncated: false,
      path: relativePath,
      relativePath,
      found: true,
    };
  } catch {
    return {
      content: '',
      rawContent: '',
      byteSize: 0,
      truncated: false,
      path: relativePath,
      relativePath,
      found: false,
    };
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

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

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

      const targetLens = extractTargetLensId(headingText);
      currentTargetLens = targetLens;
      currentLensLevel = targetLens ? level : 0;
      currentSection = {
        heading: headingText,
        level,
        lensId: targetLens,
        lines: [],
      };

      if (!targetLens) {
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
    } else {
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
export function resolveGuidelinesForLens({ parsed, lensId, roleId, lensName } = {}) {
  if (!parsed) return '';

  const parsedObj = typeof parsed === 'string' ? parseGuidelines(parsed) : parsed;
  const globalText = parsedObj.global || '';
  const lensKey = (lensId || roleId || '').toLowerCase().trim();

  const lensSpecific =
    (lensKey && parsedObj.lenses?.[lensKey]) ||
    (roleId && parsedObj.lenses?.[roleId.toLowerCase().trim()]) ||
    null;

  if (lensSpecific) {
    const header = `### Specific Instructions for ${lensName || lensId || 'Specialist Lens'}:`;
    if (globalText) {
      return `${globalText}\n\n${header}\n${lensSpecific}`;
    }
    return `${header}\n${lensSpecific}`;
  }

  return globalText;
}

/**
 * High-level loader discovering, reading, and parsing repository review guidelines.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Workspace root
 * @param {object} [options.config=null] - Resolved configuration object
 * @param {string} [options.guidelinesPath=null] - Explicit path override
 * @returns {{ enabled: boolean, found: boolean, path: string|null, relativePath: string|null, byteSize: number, truncated: boolean, rawContent: string, content: string, parsed: object, formatForLens: (lensId: string, options?: object) => string }}
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
      rawContent: '',
      content: '',
      parsed: { global: '', lenses: {}, sections: [], raw: '' },
      formatForLens: () => '',
    };
  }

  const maxBytes = config?.guidelines?.max_bytes || MAX_GUIDELINES_BYTES;
  const fileResult = readGuidelinesFile(discoveredPath, { maxBytes, cwd });
  const parsed = parseGuidelines(fileResult.content);

  return {
    enabled: true,
    found: fileResult.found,
    path: fileResult.path,
    relativePath: fileResult.relativePath,
    byteSize: fileResult.byteSize,
    truncated: fileResult.truncated,
    rawContent: fileResult.rawContent,
    content: fileResult.content,
    parsed,
    formatForLens: (lensId, opts = {}) =>
      resolveGuidelinesForLens({ parsed, lensId, ...opts }),
  };
}

/**
 * Creates a sanitized, public-safe guidelines summary object without local machine paths.
 *
 * @param {object|null} guidelines - Guidelines object from loadGuidelines
 * @returns {{ enabled: boolean, found: boolean, path: string|null, byteSize: number, truncated: boolean }|null}
 */
export function createGuidelinesSummary(guidelines) {
  if (!guidelines) return null;
  return {
    enabled: guidelines.enabled !== false,
    found: Boolean(guidelines.found),
    path: guidelines.relativePath || null,
    byteSize: guidelines.byteSize || 0,
    truncated: Boolean(guidelines.truncated),
  };
}

