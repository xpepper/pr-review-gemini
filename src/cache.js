import fs from 'node:fs';
import path from 'node:path';
import { filterFindings } from './selection.js';
import { publishReview } from './publish.js';
import { getPrDiff } from './diff.js';

const DEFAULT_CACHE_DIR = path.join(process.cwd(), '.gem-pr-cache');

const SEVERITY_RANK = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  NIT: 4,
});

/**
 * In-memory fallback / session cache.
 */
const memoryCache = new Map();

/**
 * Generates a sanitized cache key for a PR and repository.
 *
 * @param {number|string} prNumber
 * @param {string|null} [headSha]
 * @param {string|null} [repo]
 * @returns {string} Cache key
 */
export function getCacheKey(prNumber, headSha, repo) {
  const cleanPr = Number(prNumber);
  const repoPrefix = repo ? `${repo.replace(/[/\\:]/g, '__')}__` : '';
  return `${repoPrefix}pr_${cleanPr}`;
}

/**
 * Resolves the cache directory path.
 *
 * @param {Object} [options]
 * @returns {string}
 */
function resolveCacheDir(options = {}) {
  return options.cacheDir || DEFAULT_CACHE_DIR;
}

/**
 * Reads a JSON file safely from disk.
 */
function readJsonSafely(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Writes a JSON file safely to disk.
 */
function writeJsonSafely(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves review findings and summary to cache.
 *
 * @param {Object} data
 * @param {number} data.prNumber
 * @param {string} data.headSha
 * @param {string} [data.repo]
 * @param {string} [data.mode]
 * @param {Array<Object>} [data.findings]
 * @param {string} [data.summary]
 * @param {Object} [options]
 * @returns {Promise<Object>} Cached record
 */
export async function saveReviewCache(data, options = {}) {
  const prNumber = Number(data?.prNumber);
  if (!prNumber || prNumber <= 0 || !Number.isInteger(prNumber)) {
    throw new Error(`Invalid PR number for cache: ${data?.prNumber}`);
  }

  const headSha = typeof data?.headSha === 'string' ? data.headSha.trim() : '';
  if (!headSha) {
    throw new Error(`Invalid headSha for cache on PR #${prNumber}`);
  }

  const cacheDir = resolveCacheDir(options);
  const cacheKey = getCacheKey(prNumber, headSha, data.repo);

  const record = {
    prNumber,
    headSha,
    repo: data.repo || null,
    mode: data.mode || 'balanced',
    findings: Array.isArray(data.findings) ? data.findings : [],
    rawFindingsCount: data.rawFindingsCount ?? (Array.isArray(data.findings) ? data.findings.length : 0),
    summary: data.summary || '',
    lensesExecuted: data.lensesExecuted || [],
    diffTransport: data.diffTransport || null,
    revalidation: data.revalidation || null,
    createdAt: new Date().toISOString(),
  };

  // 1. Store in memory
  memoryCache.set(cacheKey, record);

  // 2. Persist to disk
  const filePath = path.join(cacheDir, `${cacheKey}.json`);
  writeJsonSafely(filePath, record);

  return record;
}

/**
 * Retrieves cached review findings and validates freshness against head SHA.
 *
 * @param {Object} query
 * @param {number} query.prNumber
 * @param {string} [query.headSha]
 * @param {string} [query.currentHeadSha]
 * @param {string} [query.repo]
 * @param {Object} [options]
 * @param {boolean} [options.throwOnStale=false]
 * @returns {Promise<Object|null>} Cached record or null
 */
export async function getReviewCache(query, options = {}) {
  const prNumber = Number(query?.prNumber);
  if (!prNumber || prNumber <= 0) return null;

  const cacheDir = resolveCacheDir(options);
  const cacheKey = getCacheKey(prNumber, null, query.repo);

  // 1. Check memory cache, then file
  let record = memoryCache.get(cacheKey);
  if (!record) {
    const filePath = path.join(cacheDir, `${cacheKey}.json`);
    record = readJsonSafely(filePath);
    if (record) {
      memoryCache.set(cacheKey, record);
    }
  }

  if (!record) return null;

  const expectedHead = query.currentHeadSha || query.headSha;

  // 2. Freshness check
  if (expectedHead && record.headSha !== expectedHead) {
    // Invalidate stale cache
    await invalidateReviewCache({ prNumber, repo: query.repo }, options);

    if (options.throwOnStale) {
      throw new Error(
        `Cached review for PR #${prNumber} is stale: cached commit ${record.headSha.slice(0, 7)} does not match current PR head ${expectedHead.slice(0, 7)}.`
      );
    }
    return null;
  }

  return record;
}

/**
 * Invalidates (deletes) cached review findings.
 *
 * @param {Object} query
 * @param {number} query.prNumber
 * @param {string} [query.repo]
 * @param {Object} [options]
 * @returns {Promise<boolean>} True if cache entry was deleted
 */
export async function invalidateReviewCache(query, options = {}) {
  const prNumber = Number(query?.prNumber);
  if (!prNumber) return false;

  const cacheDir = resolveCacheDir(options);
  const cacheKey = getCacheKey(prNumber, null, query.repo);

  const inMemoryDeleted = memoryCache.delete(cacheKey);

  const filePath = path.join(cacheDir, `${cacheKey}.json`);
  let fileDeleted = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      fileDeleted = true;
    }
  } catch {
    // Ignore file removal errors
  }

  return inMemoryDeleted || fileDeleted;
}

/**
 * Clears all cached review data from memory and disk.
 *
 * @param {Object} [options]
 */
export function clearAllCaches(options = {}) {
  memoryCache.clear();
  const cacheDir = resolveCacheDir(options);
  try {
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          fs.rmSync(path.join(cacheDir, f), { force: true });
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Lists all stored review caches.
 *
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>} Array of cache summaries
 */
export async function listReviewCaches(options = {}) {
  const cacheDir = resolveCacheDir(options);
  const results = new Map();

  // 1. Read files
  try {
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = readJsonSafely(path.join(cacheDir, file));
          if (content?.prNumber) {
            results.set(file.replace(/\.json$/, ''), {
              prNumber: content.prNumber,
              headSha: content.headSha,
              repo: content.repo || null,
              mode: content.mode || 'balanced',
              findingsCount: content.findings?.length || 0,
              createdAt: content.createdAt,
            });
          }
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  // 2. Merge memory cache
  for (const [key, val] of memoryCache.entries()) {
    if (!results.has(key)) {
      results.set(key, {
        prNumber: val.prNumber,
        headSha: val.headSha,
        repo: val.repo || null,
        mode: val.mode || 'balanced',
        findingsCount: val.findings?.length || 0,
        createdAt: val.createdAt,
      });
    }
  }

  return Array.from(results.values());
}

/**
 * Publishes previously cached review findings to GitHub with safety gates.
 *
 * @param {Object} options
 * @param {number} options.prNumber
 * @param {string} [options.repo]
 * @param {string} [options.headSha]
 * @param {Array<number>} [options.selectedIndices]
 * @param {string|Array<number>} [options.selection]
 * @param {string} [options.minSeverity]
 * @param {string} [options.reviewBody]
 * @param {string} [options.diffText]
 * @param {Object} [options.config]
 * @param {Function} [options.execGhFn]
 * @param {Function} [options.execFileFn]
 * @param {string} [options.cwd]
 * @param {Function} [options.publishReviewFn]
 * @param {Function} [options.getPrDiffFn]
 * @param {string} [options.cacheDir]
 * @returns {Promise<Object>} Review publication result
 */
export async function publishCachedReview(options = {}) {
  const prNumber = Number(options.prNumber);
  if (!prNumber || prNumber <= 0) {
    throw new Error(`Invalid PR number: ${options.prNumber}`);
  }

  const {
    repo,
    headSha,
    selectedIndices,
    selection,
    minSeverity,
    reviewBody,
    diffText,
    config,
    execGhFn,
    execFileFn,
    cwd = process.cwd(),
    publishReviewFn = publishReview,
    getPrDiffFn = getPrDiff,
    cacheDir,
  } = options;

  // 1. If headSha is not passed, fetch current head SHA from GitHub
  let currentHeadSha = headSha || null;
  if (!currentHeadSha && execGhFn) {
    try {
      const ghArgs = ['pr', 'view', String(prNumber), '--json', 'headRefOid'];
      if (repo) ghArgs.push('--repo', repo);
      const raw = await execGhFn(ghArgs, { cwd });
      if (raw && raw.trim()) {
        const meta = JSON.parse(raw);
        currentHeadSha = meta.headRefOid || null;
      }
    } catch {
      // Fallback
    }
  }

  // 2. Fetch cached review with freshness verification
  const cached = await getReviewCache(
    {
      prNumber,
      headSha: currentHeadSha,
      currentHeadSha,
      repo,
    },
    { cacheDir, throwOnStale: true }
  );

  if (!cached) {
    throw new Error(
      `No cached review found for PR #${prNumber}. Run an analysis pass first before publishing.`
    );
  }

  // 3. Filter findings based on selection
  let findingsToPublish = [...cached.findings];

  if (Array.isArray(selectedIndices)) {
    findingsToPublish = filterFindings(cached.findings, selectedIndices);
  } else if (selection !== undefined && selection !== null) {
    findingsToPublish = filterFindings(cached.findings, selection);
  }

  if (minSeverity && SEVERITY_RANK[minSeverity.toUpperCase()] !== undefined) {
    const maxRank = SEVERITY_RANK[minSeverity.toUpperCase()];
    findingsToPublish = findingsToPublish.filter((f) => {
      const s = (f.severity || 'P2').toUpperCase();
      const r = SEVERITY_RANK[s] ?? 2;
      return r <= maxRank;
    });
  }

  // 4. Retrieve PR unified diff if not provided
  let diff = diffText;
  if (!diff) {
    diff = await getPrDiffFn({
      prNumber,
      repo,
      execGhFn,
      execFileFn,
      cwd,
    });
  }

  // 5. Publish review through host-gated publishReview
  const pubResult = await publishReviewFn({
    prNumber,
    reviewBody: reviewBody || cached.summary,
    findings: findingsToPublish,
    diffText: diff,
    expectedHeadSha: currentHeadSha || cached.headSha,
    config,
    execGhFn,
    execFileFn,
    cwd,
    repo,
  });

  return {
    ...pubResult,
    cachedReview: cached,
    publishedCount: findingsToPublish.length,
    totalCachedCount: cached.findings.length,
    selectedIndices: selectedIndices || null,
  };
}
