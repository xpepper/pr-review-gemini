/**
 * src/version.js — Canonical Version Resolution & Manifest Synchronization
 *
 * Provides dynamic version resolution from package.json without hardcoding,
 * SemVer validation, and multi-manifest consistency verification for Agent Plugins 1.0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Reads and parses package.json to obtain canonical runtime metadata.
 */
function readCanonicalPackageJson(rootDir = DEFAULT_ROOT_DIR) {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // Fallback if filesystem read encounters errors
  }
  return { version: '0.1.0', name: 'gem-pr-review' };
}

const canonicalPkg = readCanonicalPackageJson();

/** Canonical plugin and package version string */
export const VERSION = canonicalPkg.version || '0.1.0';

/** Canonical plugin name */
export const PLUGIN_NAME = 'gem-pr-review';

/** Alias for VERSION */
export const PLUGIN_VERSION = VERSION;

/**
 * Formats the CLI version banner string.
 *
 * @param {string} [version=VERSION]
 * @returns {string}
 */
export function formatVersionBanner(version = VERSION) {
  return `${PLUGIN_NAME} v${version}`;
}

/**
 * Prints the CLI version banner to the provided logger.
 *
 * @param {object} [io=console]
 * @param {string} [version=VERSION]
 * @returns {string}
 */
export function printVersionBanner(io = console, version = VERSION) {
  const banner = formatVersionBanner(version);
  io.log(banner);
  return banner;
}

/**
 * Official SemVer 2.0.0 validation regular expression.
 */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Checks if a string conforms to the SemVer 2.0.0 specification.
 *
 * @param {string} v
 * @returns {boolean}
 */
export function isValidSemVer(v) {
  if (typeof v !== 'string' || !v) {
    return false;
  }
  return SEMVER_REGEX.test(v);
}

/**
 * Parses a SemVer string into its semantic components.
 *
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number, prerelease: string|null, build: string|null } | null}
 */
export function parseSemVer(v) {
  if (!isValidSemVer(v)) {
    return null;
  }
  const match = v.match(SEMVER_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    build: match[5] || null,
  };
}

/**
 * Reads versions declared across all 4 manifest files in the repository.
 *
 * @param {string} [rootDir=DEFAULT_ROOT_DIR]
 * @returns {{ packageJson: string|null, pluginJson: string|null, mcpJson: string|null, skillMd: string|null }}
 */
export function getManifestVersions(rootDir = DEFAULT_ROOT_DIR) {
  const result = {
    packageJson: null,
    pluginJson: null,
    mcpJson: null,
    skillMd: null,
  };

  // 1. package.json
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const data = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      result.packageJson = data.version || null;
    }
  } catch {
    result.packageJson = null;
  }

  // 2. plugin.json
  try {
    const pluginPath = path.join(rootDir, 'plugin.json');
    if (fs.existsSync(pluginPath)) {
      const data = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
      result.pluginJson = data.version || null;
    }
  } catch {
    result.pluginJson = null;
  }

  // 3. mcp.json
  try {
    const mcpPath = path.join(rootDir, 'mcp.json');
    if (fs.existsSync(mcpPath)) {
      const data = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      result.mcpJson = data.version || null;
    }
  } catch {
    result.mcpJson = null;
  }

  // 4. skills/gem-pr-review/SKILL.md
  try {
    const skillPath = path.join(rootDir, 'skills', 'gem-pr-review', 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, 'utf8');
      // Look for version: "0.1.0" or version: 0.1.0 in frontmatter
      const match = content.match(/version:\s*["']?([^"'\r\n]+)["']?/);
      if (match) {
        result.skillMd = match[1].trim();
      }
    }
  } catch {
    result.skillMd = null;
  }

  return result;
}

/**
 * Checks that all repository manifests declare identical, valid SemVer versions.
 *
 * @param {string} [rootDir=DEFAULT_ROOT_DIR]
 * @param {object} [options={}]
 * @param {object} [options.mockVersions] - Optional mocked versions for testing
 * @returns {{ inSync: boolean, version: string|null, versions: object, driftDetails: string[], error: string|null }}
 */
export function checkManifestSync(rootDir = DEFAULT_ROOT_DIR, options = {}) {
  const versions = options.mockVersions || getManifestVersions(rootDir);
  const manifestNames = ['packageJson', 'pluginJson', 'mcpJson', 'skillMd'];
  const driftDetails = [];

  const canonicalVersion = versions.packageJson;

  if (!canonicalVersion || !isValidSemVer(canonicalVersion)) {
    driftDetails.push(`package.json version "${canonicalVersion}" is missing or not valid SemVer.`);
  }

  for (const name of manifestNames) {
    const v = versions[name];
    if (!v) {
      driftDetails.push(`Manifest "${name}" is missing a version.`);
    } else if (!isValidSemVer(v)) {
      driftDetails.push(`Manifest "${name}" version "${v}" is not valid SemVer.`);
    } else if (canonicalVersion && v !== canonicalVersion) {
      driftDetails.push(
        `Manifest "${name}" version "${v}" does not match package.json version "${canonicalVersion}".`
      );
    }
  }

  const inSync = driftDetails.length === 0;
  const error = inSync ? null : `Manifest version drift detected:\n- ${driftDetails.join('\n- ')}`;

  return {
    inSync,
    version: inSync ? canonicalVersion : null,
    versions,
    driftDetails,
    error,
  };
}
