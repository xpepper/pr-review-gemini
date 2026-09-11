/**
 * src/semver.js — Conventional Commit SemVer Calculation, Changelog & Manifest Bumping
 *
 * Provides conventional commit analysis, SemVer bump calculation (major/minor/patch),
 * categorized release changelog generation, and atomic multi-manifest synchronization.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  VERSION,
  isValidSemVer,
  parseSemVer,
  getManifestVersions,
  checkManifestSync,
} from './version.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Parses a conventional commit message into structured components.
 *
 * @param {string} rawMessage
 * @param {string} [hash='']
 * @returns {object}
 */
export function parseConventionalCommit(rawMessage = '', hash = '') {
  const trimmed = (rawMessage || '').trim();
  const [firstLine, ...rest] = trimmed.split('\n');
  const subject = (firstLine || '').trim();
  const body = rest.join('\n').trim();

  // Pattern: type(scope)!: description or type!: description or type: description
  const headerMatch = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

  let type = 'other';
  let scope = null;
  let isBreaking = false;
  let description = subject;
  let breakingDescription = null;

  if (headerMatch) {
    type = headerMatch[1].toLowerCase();
    scope = headerMatch[2] || null;
    isBreaking = Boolean(headerMatch[3]);
    description = headerMatch[4].trim();
  }

  // Check for BREAKING CHANGE in body or subject
  const breakingMatch = trimmed.match(/BREAKING[- ]CHANGE:\s*([^\n\r]+(?:\n[^\n\r]+)*)/i);
  if (breakingMatch) {
    isBreaking = true;
    breakingDescription = breakingMatch[1].trim();
  }

  // Extract PR reference (e.g. #24 or (#24))
  const prMatch = trimmed.match(/(?:#|\bgh-|\bpull\/)(\d+)/);
  const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;

  return {
    hash: hash || null,
    shortHash: hash ? hash.slice(0, 7) : null,
    type,
    scope,
    isBreaking,
    breakingDescription,
    description,
    subject,
    body,
    prNumber,
  };
}

/**
 * Evaluates an array of conventional commits and determines the next SemVer bump type.
 * Priority: major (breaking) > minor (feat) > patch (fix/perf/other).
 *
 * @param {Array<object|string>} commits
 * @returns {{ bump: 'major'|'minor'|'patch'|null, reason: string, breakingCount: number, featCount: number, fixCount: number, otherCount: number }}
 */
export function determineSemverBump(commits = []) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return {
      bump: null,
      reason: 'No commits to evaluate',
      breakingCount: 0,
      featCount: 0,
      fixCount: 0,
      otherCount: 0,
    };
  }

  let breakingCount = 0;
  let featCount = 0;
  let fixCount = 0;
  let otherCount = 0;

  for (const item of commits) {
    const c = typeof item === 'string' ? parseConventionalCommit(item) : item;
    if (c.isBreaking) {
      breakingCount++;
    } else if (c.type === 'feat') {
      featCount++;
    } else if (c.type === 'fix' || c.type === 'perf') {
      fixCount++;
    } else {
      otherCount++;
    }
  }

  if (breakingCount > 0) {
    return {
      bump: 'major',
      reason: `${breakingCount} breaking change(s) detected`,
      breakingCount,
      featCount,
      fixCount,
      otherCount,
    };
  }

  if (featCount > 0) {
    return {
      bump: 'minor',
      reason: `${featCount} new feature(s) detected`,
      breakingCount,
      featCount,
      fixCount,
      otherCount,
    };
  }

  if (fixCount > 0) {
    return {
      bump: 'patch',
      reason: `${fixCount} bug fix(es) detected`,
      breakingCount,
      featCount,
      fixCount,
      otherCount,
    };
  }

  return {
    bump: 'patch',
    reason: `${otherCount} maintenance / documentation commit(s) detected`,
    breakingCount,
    featCount,
    fixCount,
    otherCount,
  };
}

/**
 * Calculates the next SemVer string given a current version and bump type.
 *
 * @param {string} currentVersion
 * @param {'major'|'minor'|'patch'|string} bumpType
 * @returns {string}
 */
export function calculateNextVersion(currentVersion, bumpType) {
  if (typeof bumpType === 'string' && isValidSemVer(bumpType)) {
    return bumpType.trim();
  }

  const parsed = parseSemVer(currentVersion);
  if (!parsed) {
    throw new Error(`Invalid current version: "${currentVersion}"`);
  }

  const normalizedBump = (bumpType || '').trim().toLowerCase();

  switch (normalizedBump) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      throw new Error(`Invalid bump type or version: "${bumpType}". Must be 'major', 'minor', 'patch', or a valid SemVer string.`);
  }
}

/**
 * Generates a categorized release changelog in Markdown format.
 *
 * @param {object} params
 * @param {string} params.version
 * @param {string} [params.previousVersion]
 * @param {Array<object|string>} params.commits
 * @param {Date|string} [params.date=new Date()]
 * @returns {string}
 */
export function generateChangelog({
  version,
  previousVersion = null,
  commits = [],
  date = new Date(),
}) {
  const dateStr =
    typeof date === 'string'
      ? date
      : date instanceof Date
      ? date.toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

  const parsedCommits = commits.map((item) =>
    typeof item === 'string' ? parseConventionalCommit(item) : item
  );

  const categories = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    test: [],
    chore: [],
  };

  for (const c of parsedCommits) {
    if (c.isBreaking) {
      categories.breaking.push(c);
    } else if (c.type === 'feat') {
      categories.feat.push(c);
    } else if (c.type === 'fix') {
      categories.fix.push(c);
    } else if (c.type === 'perf') {
      categories.perf.push(c);
    } else if (c.type === 'refactor') {
      categories.refactor.push(c);
    } else if (c.type === 'docs') {
      categories.docs.push(c);
    } else if (c.type === 'test') {
      categories.test.push(c);
    } else {
      categories.chore.push(c);
    }
  }

  const lines = [];
  lines.push(`## [${version}] - ${dateStr}`);
  lines.push('');

  const formatItem = (c) => {
    const scopePrefix = c.scope ? `**${c.scope}:** ` : '';
    const desc = c.description || c.subject;
    const prPart = c.prNumber ? ` ([#${c.prNumber}](pull/${c.prNumber}))` : '';
    const hashPart = c.shortHash ? ` (\`${c.shortHash}\`)` : '';
    let entry = `- ${scopePrefix}${desc}${prPart}${hashPart}`;
    if (c.breakingDescription) {
      entry += `\n  - **BREAKING**: ${c.breakingDescription}`;
    }
    return entry;
  };

  const sections = [
    { key: 'breaking', title: '### ⚠️ Breaking Changes' },
    { key: 'feat', title: '### 🚀 Features' },
    { key: 'fix', title: '### 🐛 Bug Fixes' },
    { key: 'perf', title: '### ⚡ Performance Improvements' },
    { key: 'refactor', title: '### ♻️ Refactoring' },
    { key: 'docs', title: '### 📝 Documentation' },
    { key: 'test', title: '### 🧪 Tests' },
    { key: 'chore', title: '### 🔧 Maintenance & Chores' },
  ];

  for (const sec of sections) {
    const list = categories[sec.key];
    if (list && list.length > 0) {
      lines.push(sec.title);
      lines.push('');
      for (const item of list) {
        lines.push(formatItem(item));
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Retrieves git commits since the latest git tag, or all commits if no tag exists.
 *
 * @param {object} [options={}]
 * @param {string} [options.tag] - Explicit git tag boundary
 * @param {string} [options.cwd=DEFAULT_ROOT_DIR]
 * @param {Function} [options.execGitFn]
 * @returns {Promise<{ latestTag: string|null, commits: Array<object> }>}
 */
export async function getGitCommitsSinceTag(options = {}) {
  const cwd = options.cwd || DEFAULT_ROOT_DIR;
  const execGit =
    options.execGitFn ||
    ((args) => execFileAsync('git', args, { cwd }).then((res) => res.stdout.trim()));

  let tag = options.tag || null;

  if (!tag) {
    try {
      const tagOutput = await execGit(['describe', '--tags', '--abbrev=0']);
      if (tagOutput) {
        tag = tagOutput.trim();
      }
    } catch {
      tag = null;
    }
  }

  const logArgs = ['log'];
  if (tag) {
    logArgs.push(`${tag}..HEAD`);
  }
  // Format: Hash, delimiter (0x1f), Subject, delimiter (0x1f), Body, record separator (0x1e)
  logArgs.push('--pretty=format:%H%x1f%s%x1f%b%x1e');

  const rawLog = await execGit(logArgs);

  if (!rawLog) {
    return { latestTag: tag, commits: [] };
  }

  const rawRecords = rawLog.split('\x1e').filter((r) => r.trim());
  const commits = [];

  for (const record of rawRecords) {
    const [hash, subject, body] = record.split('\x1f');
    if (hash && subject) {
      const fullText = body ? `${subject}\n\n${body}` : subject;
      commits.push(parseConventionalCommit(fullText, hash));
    }
  }

  return {
    latestTag: tag,
    commits,
  };
}

/**
 * Atomically updates version across all 4 manifest files:
 * - package.json
 * - plugin.json
 * - mcp.json
 * - skills/gem-pr-review/SKILL.md
 *
 * @param {object} params
 * @param {string} params.newVersion - Target SemVer version
 * @param {string} [params.rootDir=DEFAULT_ROOT_DIR]
 * @param {boolean} [params.dryRun=false]
 * @returns {{ success: boolean, newVersion: string, previousVersion: string, dryRun: boolean, updatedFiles: string[] }}
 */
export function bumpManifestVersions({
  newVersion,
  rootDir = DEFAULT_ROOT_DIR,
  dryRun = false,
}) {
  if (!isValidSemVer(newVersion)) {
    throw new Error(
      `Invalid SemVer version string: "${newVersion}". Must match SemVer format (e.g. 1.0.0).`
    );
  }

  const files = {
    packageJson: path.join(rootDir, 'package.json'),
    pluginJson: path.join(rootDir, 'plugin.json'),
    mcpJson: path.join(rootDir, 'mcp.json'),
    skillMd: path.join(rootDir, 'skills', 'gem-pr-review', 'SKILL.md'),
  };

  // Verify all files exist
  for (const [name, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cannot bump version: required manifest "${name}" not found at ${filePath}`);
    }
  }

  // 1. package.json
  const packageContent = fs.readFileSync(files.packageJson, 'utf8');
  const packageData = JSON.parse(packageContent);
  const previousVersion = packageData.version || '0.1.0';
  packageData.version = newVersion;
  const newPackageContent = JSON.stringify(packageData, null, 2) + '\n';

  // 2. plugin.json
  const pluginContent = fs.readFileSync(files.pluginJson, 'utf8');
  const pluginData = JSON.parse(pluginContent);
  pluginData.version = newVersion;
  const newPluginContent = JSON.stringify(pluginData, null, 2) + '\n';

  // 3. mcp.json
  const mcpContent = fs.readFileSync(files.mcpJson, 'utf8');
  const mcpData = JSON.parse(mcpContent);
  mcpData.version = newVersion;
  const newMcpContent = JSON.stringify(mcpData, null, 2) + '\n';

  // 4. skills/gem-pr-review/SKILL.md
  const skillContent = fs.readFileSync(files.skillMd, 'utf8');
  if (!/version:\s*["']?[^"'\r\n]+["']?/.test(skillContent)) {
    throw new Error(
      `Cannot bump version: metadata.version not found in ${files.skillMd}`
    );
  }
  const newSkillContent = skillContent.replace(
    /version:\s*["']?[^"'\r\n]+["']?/,
    `version: "${newVersion}"`
  );

  const updatedFiles = Object.values(files);

  if (!dryRun) {
    fs.writeFileSync(files.packageJson, newPackageContent, 'utf8');
    fs.writeFileSync(files.pluginJson, newPluginContent, 'utf8');
    fs.writeFileSync(files.mcpJson, newMcpContent, 'utf8');
    fs.writeFileSync(files.skillMd, newSkillContent, 'utf8');
  }

  return {
    success: true,
    newVersion,
    previousVersion,
    dryRun: Boolean(dryRun),
    updatedFiles,
  };
}
