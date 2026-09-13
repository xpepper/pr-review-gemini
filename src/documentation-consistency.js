import { parseUnifiedDiff } from './diff.js';

export const DOCUMENTATION_CONSISTENCY_TEST = 'tests/skills.test.mjs';

const DOCUMENTATION_PATH_PATTERNS = [
  /^README\.md$/i,
  /^docs\//i,
  /^\.github\/workflows\//i,
];

const SKIP_REASONS = {
  selected_test_changed: 'the selected test changed in this pull request',
  untrusted_fork: 'untrusted fork pull request',
  origin_unverified: 'pull request origin could not be verified',
};

export function getChangedPaths(diffText) {
  return [...new Set(
    parseUnifiedDiff(diffText)
      .flatMap((file) => [file.oldPath, file.newPath])
      .filter(Boolean)
  )].sort();
}

export function isDocumentationImpactPath(filePath) {
  return DOCUMENTATION_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function selectDocumentationConsistencyCheck(diffText) {
  const changedPaths = getChangedPaths(diffText);
  const hasDocumentationImpact = changedPaths.some(isDocumentationImpactPath);

  if (!hasDocumentationImpact) {
    return {
      status: 'not_applicable',
      testFile: null,
      changedPaths,
    };
  }

  if (changedPaths.includes(DOCUMENTATION_CONSISTENCY_TEST)) {
    return {
      status: 'skipped',
      testFile: DOCUMENTATION_CONSISTENCY_TEST,
      changedPaths,
      reason: 'selected_test_changed',
    };
  }

  return {
    status: 'selected',
    testFile: DOCUMENTATION_CONSISTENCY_TEST,
    changedPaths,
  };
}

export function formatDocumentationConsistencySummary(result) {
  if (!result || result.status === 'not_applicable') {
    return '';
  }

  const testLabel = result.testFile ? ` \`${result.testFile}\`` : '';
  if (result.status === 'passed') {
    return `- **Documentation Consistency Check**: \`PASSED\`${testLabel}`;
  }
  if (result.status === 'failed') {
    return `- **Documentation Consistency Check**: \`FAILED\`${testLabel}`;
  }
  if (result.status === 'skipped') {
    return `- **Documentation Consistency Check**: \`SKIPPED\`${testLabel} — ${SKIP_REASONS[result.reason] || 'not eligible for execution'}`;
  }
  return `- **Documentation Consistency Check**: \`NOT RUN\`${testLabel}`;
}
