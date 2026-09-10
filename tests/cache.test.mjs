import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  saveReviewCache,
  getReviewCache,
  invalidateReviewCache,
  listReviewCaches,
  clearAllCaches,
  publishCachedReview,
  getCacheKey,
} from '../src/cache.js';

describe('Review Cache (Publish-Later & Freshness Invalidation)', () => {
  let tempCacheDir;

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-cache-test-'));
    clearAllCaches({ cacheDir: tempCacheDir });
  });

  afterEach(() => {
    clearAllCaches({ cacheDir: tempCacheDir });
    try {
      fs.rmSync(tempCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const sampleFindings = [
    {
      title: 'SQL injection in search handler',
      severity: 'P0',
      file: 'src/search.js',
      line: 42,
      side: 'RIGHT',
      confidence: 0.98,
      body: 'User input directly interpolated into query string.',
    },
    {
      title: 'Trailing whitespace on blank line',
      severity: 'nit',
      file: 'src/style.css',
      line: 3,
      side: 'RIGHT',
      confidence: 0.9,
      body: 'Remove trailing whitespace.',
    },
  ];

  describe('saveReviewCache and getReviewCache', () => {
    it('saves review findings and retrieves them by PR number and head SHA', async () => {
      const saved = await saveReviewCache(
        {
          prNumber: 42,
          headSha: 'abc1234567890abcdef',
          repo: 'xpepper/pr-review-gemini',
          mode: 'balanced',
          findings: sampleFindings,
          summary: 'Review summary for PR #42',
        },
        { cacheDir: tempCacheDir }
      );

      assert.equal(saved.prNumber, 42);
      assert.equal(saved.headSha, 'abc1234567890abcdef');
      assert.equal(saved.findings.length, 2);

      const retrieved = await getReviewCache(
        {
          prNumber: 42,
          headSha: 'abc1234567890abcdef',
          repo: 'xpepper/pr-review-gemini',
        },
        { cacheDir: tempCacheDir }
      );

      assert.ok(retrieved);
      assert.equal(retrieved.prNumber, 42);
      assert.equal(retrieved.headSha, 'abc1234567890abcdef');
      assert.equal(retrieved.findings.length, 2);
      assert.equal(retrieved.findings[0].title, 'SQL injection in search handler');
    });

    it('returns null when no cache exists for the given PR', async () => {
      const result = await getReviewCache(
        { prNumber: 999, headSha: 'deadbeef' },
        { cacheDir: tempCacheDir }
      );
      assert.equal(result, null);
    });

    it('rejects saving without valid prNumber or headSha', async () => {
      await assert.rejects(
        () => saveReviewCache({ prNumber: null, headSha: 'abc' }, { cacheDir: tempCacheDir }),
        /Invalid PR number/
      );

      await assert.rejects(
        () => saveReviewCache({ prNumber: 12, headSha: '' }, { cacheDir: tempCacheDir }),
        /Invalid headSha/
      );
    });
  });

  describe('Freshness & Stale-Head Invalidation', () => {
    it('rejects and invalidates cache when PR head SHA has changed (stale cache)', async () => {
      await saveReviewCache(
        {
          prNumber: 10,
          headSha: 'commit-v1',
          findings: sampleFindings,
          summary: 'Summary v1',
        },
        { cacheDir: tempCacheDir }
      );

      // Attempt to retrieve with currentHeadSha = 'commit-v2' (head has moved)
      await assert.rejects(
        () =>
          getReviewCache(
            {
              prNumber: 10,
              currentHeadSha: 'commit-v2',
            },
            { cacheDir: tempCacheDir, throwOnStale: true }
          ),
        /stale/i
      );

      // Verify that stale cache entry was invalidated
      const freshLookup = await getReviewCache(
        { prNumber: 10, headSha: 'commit-v1' },
        { cacheDir: tempCacheDir }
      );
      assert.equal(freshLookup, null);
    });

    it('returns null instead of throwing when throwOnStale is false', async () => {
      await saveReviewCache(
        {
          prNumber: 11,
          headSha: 'commit-old',
          findings: sampleFindings,
        },
        { cacheDir: tempCacheDir }
      );

      const result = await getReviewCache(
        { prNumber: 11, currentHeadSha: 'commit-new' },
        { cacheDir: tempCacheDir, throwOnStale: false }
      );
      assert.equal(result, null);
    });

    it('allows invalidating cache explicitly via invalidateReviewCache', async () => {
      await saveReviewCache(
        {
          prNumber: 15,
          headSha: 'head15',
          findings: sampleFindings,
        },
        { cacheDir: tempCacheDir }
      );

      const deleted = await invalidateReviewCache(
        { prNumber: 15, headSha: 'head15' },
        { cacheDir: tempCacheDir }
      );
      assert.equal(deleted, true);

      const lookup = await getReviewCache(
        { prNumber: 15, headSha: 'head15' },
        { cacheDir: tempCacheDir }
      );
      assert.equal(lookup, null);
    });
  });

  describe('listReviewCaches', () => {
    it('lists all stored review caches', async () => {
      await saveReviewCache(
        { prNumber: 1, headSha: 'sha1', findings: [sampleFindings[0]] },
        { cacheDir: tempCacheDir }
      );
      await saveReviewCache(
        { prNumber: 2, headSha: 'sha2', findings: sampleFindings },
        { cacheDir: tempCacheDir }
      );

      const list = await listReviewCaches({ cacheDir: tempCacheDir });
      assert.equal(list.length, 2);
      const pr1 = list.find((e) => e.prNumber === 1);
      const pr2 = list.find((e) => e.prNumber === 2);
      assert.ok(pr1 && pr2);
      assert.equal(pr1.findingsCount, 1);
      assert.equal(pr2.findingsCount, 2);
    });
  });

  describe('publishCachedReview', () => {
    const mockDiff = `diff --git a/src/search.js b/src/search.js
index 0000000..1111111 100644
--- a/src/search.js
+++ b/src/search.js
@@ -40,5 +40,5 @@ function query() {
-  return db.raw(sql);
+  return db.query(sql);
 }
`;

    it('publishes cached review findings with selected indices and diff verification', async () => {
      await saveReviewCache(
        {
          prNumber: 50,
          headSha: 'head50',
          repo: 'xpepper/test-repo',
          findings: sampleFindings,
          summary: 'Original review summary',
        },
        { cacheDir: tempCacheDir }
      );

      let publishedPayload = null;
      const mockPublishReviewFn = async (options) => {
        publishedPayload = options;
        return {
          published: true,
          reviewId: 999,
          classification: { inlineComments: [options.findings[0]], demotedFindings: [] },
          reviewBody: options.reviewBody,
        };
      };

      const result = await publishCachedReview({
        prNumber: 50,
        repo: 'xpepper/test-repo',
        headSha: 'head50',
        selectedIndices: [0], // Only select SQL injection finding
        diffText: mockDiff,
        publishReviewFn: mockPublishReviewFn,
        cacheDir: tempCacheDir,
      });

      assert.ok(result.published);
      assert.equal(result.publishedCount, 1);
      assert.equal(result.totalCachedCount, 2);
      assert.ok(publishedPayload);
      assert.equal(publishedPayload.findings.length, 1);
      assert.equal(publishedPayload.findings[0].title, 'SQL injection in search handler');
    });

    it('rejects publishing when cached review does not exist', async () => {
      await assert.rejects(
        () =>
          publishCachedReview({
            prNumber: 404,
            headSha: 'sha',
            cacheDir: tempCacheDir,
          }),
        /No cached review found/
      );
    });

    it('rejects publishing when PR head SHA is stale', async () => {
      await saveReviewCache(
        {
          prNumber: 60,
          headSha: 'head-v1',
          findings: sampleFindings,
        },
        { cacheDir: tempCacheDir }
      );

      // gh api mock returning headRefOid = 'head-v2'
      const mockExecGhFn = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({ headRefOid: 'head-v2' });
        }
        return '';
      };

      await assert.rejects(
        () =>
          publishCachedReview({
            prNumber: 60,
            execGhFn: mockExecGhFn,
            cacheDir: tempCacheDir,
          }),
        /stale/i
      );
    });
  });
});
