import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENTATION_CONSISTENCY_TEST,
  selectDocumentationConsistencyCheck,
  formatDocumentationConsistencySummary,
} from '../src/documentation-consistency.js';

const documentationDiff = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-Old
+New
`;

describe('Documentation consistency check selection', () => {
  it('selects the immutable documentation test when documentation changes', () => {
    const result = selectDocumentationConsistencyCheck(documentationDiff);

    assert.equal(result.status, 'selected');
    assert.equal(result.testFile, DOCUMENTATION_CONSISTENCY_TEST);
    assert.deepEqual(result.changedPaths, ['README.md']);
  });

  it('does not select a check for source-only changes', () => {
    const result = selectDocumentationConsistencyCheck(documentationDiff.replaceAll('README.md', 'src/app.js'));

    assert.equal(result.status, 'not_applicable');
    assert.equal(result.testFile, null);
  });

  it('skips execution when the allowlisted test changes in the PR', () => {
    const testDiff = documentationDiff + `diff --git a/tests/skills.test.mjs b/tests/skills.test.mjs
index 1111111..2222222 100644
--- a/tests/skills.test.mjs
+++ b/tests/skills.test.mjs
@@ -1 +1 @@
-Old
+New
`;

    const result = selectDocumentationConsistencyCheck(testDiff);

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'selected_test_changed');
  });

  it('formats a sanitized execution result for the review summary', () => {
    assert.match(
      formatDocumentationConsistencySummary({
        status: 'passed',
        testFile: DOCUMENTATION_CONSISTENCY_TEST,
      }),
      /PASSED.*tests\/skills\.test\.mjs/i
    );
    assert.match(
      formatDocumentationConsistencySummary({
        status: 'skipped',
        testFile: DOCUMENTATION_CONSISTENCY_TEST,
        reason: 'untrusted_fork',
      }),
      /SKIPPED.*untrusted fork/i
    );
  });
});
