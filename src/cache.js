import fs from 'node:fs';
import path from 'node:path';
import { filterFindings } from './selection.js';
import { publishReview } from './publish.js';
import { getPrDiff } from './diff.js';

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
  const cleanSha = headSha && typeof headSha === 'string'
    ? headSha.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 7)
    : '';
  const shaSuffix = cleanSha.length > 0 ? `_${cleanSha}` : '';
  return `${repoPrefix}pr_${cleanPr}${shaSuffix}`;
}

/**
 * Resolves the cache directory path.
 *
 * @param {Object} [options]
 * @param {string} [options.cacheDir]
 * @param {string} [options.cwd]
 * @returns {string}
 */
export function resolveCacheDir(options = {}) {
  if (options.cacheDir && typeof options.cacheDir === 'string') {
    return options.cacheDir;
  }
  const root = options.cwd && typeof options.cwd === 'string' ? options.cwd : process.cwd();
  return path.join(root, '.gem-pr-cache');
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
  const prKey = getCacheKey(prNumber, null, data.repo);

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
  memoryCache.set(prKey, record);

  // 2. Persist to disk
  const filePath = path.join(cacheDir, `${cacheKey}.json`);
  writeJsonSafely(filePath, record);
  if (cacheKey !== prKey) {
    const prFilePath = path.join(cacheDir, `${prKey}.json`);
    writeJsonSafely(prFilePath, record);
  }

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
  const currentHead = query.currentHeadSha || null;
  const requestedHead = query.headSha || null;
  const expectedHead = currentHead || requestedHead;
  const shaKey = expectedHead ? getCacheKey(prNumber, expectedHead, query.repo) : null;
  const prKey = getCacheKey(prNumber, null, query.repo);

  // 1. Check sha-specific key first
  let record = shaKey ? memoryCache.get(shaKey) : null;
  if (!record && shaKey) {
    const filePath = path.join(cacheDir, `${shaKey}.json`);
    record = readJsonSafely(filePath);
    if (record) {
      memoryCache.set(shaKey, record);
    }
  }

  // 2. Fall back to PR canonical key
  if (!record) {
    record = memoryCache.get(prKey);
    if (!record) {
      const filePath = path.join(cacheDir, `${prKey}.json`);
      record = readJsonSafely(filePath);
      if (record) {
        memoryCache.set(prKey, record);
      }
    }
  }

  if (!record) return null;

  // If a specific headSha was requested and does not match the record found (e.g. from canonical key),
  // it is simply a cache miss for that specific commit (do not invalidate the newer/unrelated entry).
  if (requestedHead && record.headSha !== requestedHead) {
    return null;
  }

  // 3. Freshness check against current PR head
  if (currentHead && record.headSha !== currentHead) {
    // Invalidate only the specific stale record's entries, preserving newer concurrent entries
    await invalidateReviewCache({ prNumber, headSha: record.headSha, repo: query.repo }, options);

    if (options.throwOnStale) {
      throw new Error(
        `Cached review for PR #${prNumber} is stale: cached commit ${record.headSha.slice(0, 7)} does not match current PR head ${currentHead.slice(0, 7)}.`
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
 * @param {string} [query.headSha]
 * @param {string} [query.repo]
 * @param {Object} [options]
 * @returns {Promise<boolean>} True if cache entry was deleted
 */
export async function invalidateReviewCache(query, options = {}) {
  const prNumber = Number(query?.prNumber);
  if (!prNumber) return false;

  const cacheDir = resolveCacheDir(options);
  const repoPrefix = query.repo ? `${query.repo.replace(/[/\\:]/g, '__')}__` : '';
  const prefix = `${repoPrefix}pr_${prNumber}`;
  const targetSha = query.headSha && typeof query.headSha === 'string' && query.headSha.trim().length > 0
    ? query.headSha.trim().slice(0, 7)
    : null;

  let inMemoryDeleted = false;
  for (const k of Array.from(memoryCache.keys())) {
    if (targetSha) {
      if (k === `${prefix}_${targetSha}`) {
        memoryCache.delete(k);
        inMemoryDeleted = true;
      } else if (k === prefix) {
        const rec = memoryCache.get(k);
        if (!rec?.headSha || rec.headSha.startsWith(targetSha)) {
          memoryCache.delete(k);
          inMemoryDeleted = true;
        }
      }
    } else {
      if (k === prefix || k.startsWith(`${prefix}_`)) {
        memoryCache.delete(k);
        inMemoryDeleted = true;
      }
    }
  }

  let fileDeleted = false;
  try {
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        if (targetSha) {
          if (file === `${prefix}_${targetSha}.json`) {
            try {
              fs.rmSync(path.join(cacheDir, file), { force: true });
              fileDeleted = true;
            } catch {
              // Ignore file removal errors
            }
          } else if (file === `${prefix}.json`) {
            try {
              const rec = readJsonSafely(path.join(cacheDir, file));
              if (!rec?.headSha || rec.headSha.startsWith(targetSha)) {
                fs.rmSync(path.join(cacheDir, file), { force: true });
                fileDeleted = true;
              }
            } catch {
              // Ignore file removal errors
            }
          }
        } else {
          if (file === `${prefix}.json` || file.startsWith(`${prefix}_`)) {
            try {
              fs.rmSync(path.join(cacheDir, file), { force: true });
              fileDeleted = true;
            } catch {
              // Ignore file removal errors
            }
          }
        }
      }
    }
  } catch {
    // Ignore directory read errors
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
    // Ignore cleanup error
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
            const dedupeKey = `${content.repo || ''}#${content.prNumber}#${content.headSha || ''}`;
            results.set(dedupeKey, {
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
  for (const [, val] of memoryCache.entries()) {
    const dedupeKey = `${val.repo || ''}#${val.prNumber}#${val.headSha || ''}`;
    if (!results.has(dedupeKey)) {
      results.set(dedupeKey, {
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
      headSha,
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
