import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonEnvelope,
  repairJsonString,
  extractCandidateObjects,
  normalizeFindingCandidate,
  isValidFindingCandidate,
  recoverFindingsFromText,
} from '../src/recovery.js';

describe('Candidate Finding Recovery (Increment 12)', () => {
  describe('extractJsonEnvelope', () => {
    it('extracts standard well-formed JSON envelope', () => {
      const text = `
Prose before envelope.
<<<PR_REVIEW_JSON>>>
[
  { "title": "Bug", "severity": "P1", "file": "src/a.js", "line": 10 }
]
<<<END_PR_REVIEW_JSON>>>
Prose after envelope.
`;
      const result = extractJsonEnvelope(text);
      assert.ok(result);
      assert.match(result, /"title": "Bug"/);
      assert.doesNotMatch(result, /<<<PR_REVIEW_JSON>>>/);
      assert.doesNotMatch(result, /<<<END_PR_REVIEW_JSON>>>/);
    });

    it('extracts truncated envelope missing <<<END_PR_REVIEW_JSON>>>', () => {
      const text = `
Here is my review:
<<<PR_REVIEW_JSON>>>
[
  { "title": "Memory leak", "severity": "P0", "file": "src/leak.js", "line": 42, "body": "Never freed." }
`;
      const result = extractJsonEnvelope(text);
      assert.ok(result);
      assert.match(result, /"title": "Memory leak"/);
    });

    it('strips markdown json code fences inside the envelope', () => {
      const text = `
<<<PR_REVIEW_JSON>>>
\`\`\`json
[
  { "title": "Issue", "severity": "P2", "file": "src/b.js", "line": 5 }
]
\`\`\`
<<<END_PR_REVIEW_JSON>>>
`;
      const result = extractJsonEnvelope(text);
      assert.ok(result);
      assert.doesNotMatch(result, /```/);
      assert.match(result, /"title": "Issue"/);
    });

    it('extracts fenced code block when envelope delimiter is absent', () => {
      const text = `
I reviewed the code:
\`\`\`json
[
  { "title": "Fenced issue", "severity": "P1", "file": "src/c.js", "line": 20 }
]
\`\`\`
`;
      const result = extractJsonEnvelope(text);
      assert.ok(result);
      assert.match(result, /"title": "Fenced issue"/);
      assert.doesNotMatch(result, /```/);
    });

    it('returns raw text if it appears to be raw JSON array or object', () => {
      const text = `[ { "title": "Direct JSON", "severity": "P1", "file": "src/d.js", "line": 1 } ]`;
      const result = extractJsonEnvelope(text);
      assert.equal(result, text);
    });

    it('returns empty string when no JSON or envelope is found', () => {
      const text = `Looks great to me! No findings or JSON here.`;
      const result = extractJsonEnvelope(text);
      assert.equal(result, '');
    });
  });

  describe('repairJsonString', () => {
    it('removes trailing commas from objects and arrays', () => {
      const badJson = `[ { "title": "A", "file": "f.js", "line": 1, }, ]`;
      const repaired = repairJsonString(badJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].title, 'A');
    });

    it('closes unclosed array brackets', () => {
      const badJson = `[ { "title": "Unclosed", "severity": "P1", "file": "a.js", "line": 12 }`;
      const repaired = repairJsonString(badJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed[0].title, 'Unclosed');
    });

    it('handles unescaped literal newlines in string properties', () => {
      const badJson = `[
  {
    "title": "Multiline body",
    "severity": "P2",
    "file": "a.js",
    "line": 10,
    "body": "Line 1
Line 2
Line 3"
  }
]`;
      const repaired = repairJsonString(badJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.match(parsed[0].body, /Line 1\nLine 2/);
    });

    it('strips single-line and multi-line comments', () => {
      const badJson = `[
  // This is a comment
  {
    "title": "Comment test", /* inline comment */
    "severity": "P2",
    "file": "a.js",
    "line": 10
  }
]`;
      const repaired = repairJsonString(badJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed[0].title, 'Comment test');
    });

    it('normalizes smart quotes to standard double quotes', () => {
      const badJson = `[ { “title”: “Smart quote”, “severity”: “P1”, “file”: “x.js”, “line”: 5 } ]`;
      const repaired = repairJsonString(badJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed[0].title, 'Smart quote');
    });

    it('trims truncated trailing object fragment at end of array', () => {
      const truncatedJson = `[
  { "title": "Valid complete", "severity": "P1", "file": "a.js", "line": 10 },
  { "tit`;
      const repaired = repairJsonString(truncatedJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].title, 'Valid complete');
    });

    it('salvages valid properties of object when cut off midway through subsequent key', () => {
      const truncatedJson = `[
  { "title": "Valid complete", "severity": "P1", "file": "a.js", "line": 10 },
  { "title": "Incomplete cut off", "severity": "P0", "file": "b.js", "line`;
      const repaired = repairJsonString(truncatedJson);
      assert.doesNotThrow(() => JSON.parse(repaired));
      const parsed = JSON.parse(repaired);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].title, 'Valid complete');
      assert.equal(parsed[1].title, 'Incomplete cut off');
      assert.equal(parsed[1].file, 'b.js');
    });
  });

  describe('extractCandidateObjects', () => {
    it('extracts all valid objects even when array delimiter is missing or corrupt', () => {
      const corruptText = `
Here are the findings:
{ "title": "First defect", "severity": "P1", "file": "src/first.js", "line": 10 }
Some arbitrary commentary in between
{ "title": "Second defect", "severity": "P2", "file": "src/second.js", "line": 20 }
`;
      const candidates = extractCandidateObjects(corruptText);
      assert.equal(candidates.length, 2);
      assert.equal(candidates[0].title, 'First defect');
      assert.equal(candidates[1].title, 'Second defect');
    });

    it('recovers truncated final object if it contains essential fields', () => {
      const truncatedText = `
{ "title": "Complete defect", "severity": "P1", "file": "src/a.js", "line": 10 }
{ "title": "Cutoff defect", "severity": "P0", "file": "src/b.js", "line": 99, "body": "This was cut off mid`;
      const candidates = extractCandidateObjects(truncatedText);
      assert.equal(candidates.length, 2);
      assert.equal(candidates[0].title, 'Complete defect');
      assert.equal(candidates[1].title, 'Cutoff defect');
      assert.equal(candidates[1].line, 99);
    });

    it('ignores non-finding objects like arbitrary metadata or tool configs', () => {
      const text = `
{ "config": { "debug": true, "timeout": 5000 } }
{ "title": "Real defect", "severity": "P1", "file": "src/real.js", "line": 15 }
`;
      const candidates = extractCandidateObjects(text);
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].title, 'Real defect');
    });
  });

  describe('normalizeFindingCandidate & isValidFindingCandidate', () => {
    it('normalizes valid candidate matching contract', () => {
      const raw = {
        title: 'Buffer overflow risk',
        severity: 'p0',
        file: 'b/src/native.c',
        line: '42',
        side: 'right',
        confidence: '95%',
        body: 'Check bounds before memcpy.',
      };
      assert.ok(isValidFindingCandidate(raw));
      const normalized = normalizeFindingCandidate(raw);
      assert.equal(normalized.title, 'Buffer overflow risk');
      assert.equal(normalized.severity, 'P0');
      assert.equal(normalized.filePath, 'src/native.c');
      assert.equal(normalized.line, 42);
      assert.equal(normalized.side, 'RIGHT');
      assert.equal(normalized.confidence, 0.95);
      assert.equal(normalized.commentary, 'Check bounds before memcpy.');
    });

    it('maps descriptive severity labels to standard P-levels', () => {
      assert.equal(normalizeFindingCandidate({ severity: 'critical', file: 'a.js', line: 1 }).severity, 'P0');
      assert.equal(normalizeFindingCandidate({ severity: 'blocker', file: 'a.js', line: 1 }).severity, 'P0');
      assert.equal(normalizeFindingCandidate({ severity: 'high', file: 'a.js', line: 1 }).severity, 'P1');
      assert.equal(normalizeFindingCandidate({ severity: 'major', file: 'a.js', line: 1 }).severity, 'P1');
      assert.equal(normalizeFindingCandidate({ severity: 'medium', file: 'a.js', line: 1 }).severity, 'P2');
      assert.equal(normalizeFindingCandidate({ severity: 'warning', file: 'a.js', line: 1 }).severity, 'P2');
      assert.equal(normalizeFindingCandidate({ severity: 'minor', file: 'a.js', line: 1 }).severity, 'P3');
      assert.equal(normalizeFindingCandidate({ severity: 'cosmetic', file: 'a.js', line: 1 }).severity, 'nit');
    });

    it('handles alternative location formats (e.g. location.path, location.endLine)', () => {
      const raw = {
        title: 'Nested location',
        severity: 'P2',
        location: {
          path: 'src/nested.js',
          endLine: 88,
          side: 'LEFT',
        },
        actual: 'Unexpected state.',
      };
      assert.ok(isValidFindingCandidate(raw));
      const normalized = normalizeFindingCandidate(raw);
      assert.equal(normalized.filePath, 'src/nested.js');
      assert.equal(normalized.line, 88);
      assert.equal(normalized.side, 'LEFT');
      assert.equal(normalized.commentary, 'Unexpected state.');
    });

    it('rejects candidates missing both file and line when no meaningful content exists', () => {
      assert.equal(isValidFindingCandidate({}), false);
      assert.equal(isValidFindingCandidate({ foo: 'bar' }), false);
      assert.equal(isValidFindingCandidate(null), false);
    });
  });

  describe('recoverFindingsFromText (End-to-End Recovery)', () => {
    it('recovers findings from envelope with truncated closing delimiter and trailing comma', () => {
      const degradedOutput = `
Here is my review pass:
<<<PR_REVIEW_JSON>>>
[
  {
    "title": "Uncaught promise rejection",
    "severity": "P1",
    "file": "src/api.js",
    "line": 54,
    "confidence": 0.9,
    "body": "Need a catch block on the async fetch call.",
  },
`;
      const findings = recoverFindingsFromText(degradedOutput);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].title, 'Uncaught promise rejection');
      assert.equal(findings[0].severity, 'P1');
      assert.equal(findings[0].filePath, 'src/api.js');
      assert.equal(findings[0].line, 54);
      assert.equal(findings[0].confidence, 0.9);
    });

    it('recovers multiple findings when output was cut off during the second finding', () => {
      const truncatedOutput = `
<<<PR_REVIEW_JSON>>>
[
  {
    "title": "SQL injection",
    "severity": "P0",
    "file": "src/db.js",
    "line": 12,
    "body": "Use parameterized query."
  },
  {
    "title": "Missing validation",
    "severity": "P1",
    "file": "src/handler.js",
    "line": 34,
    "body": "Body was trunca
`;
      const findings = recoverFindingsFromText(truncatedOutput);
      assert.ok(findings.length >= 1);
      assert.equal(findings[0].title, 'SQL injection');
      assert.equal(findings[0].severity, 'P0');
      if (findings.length > 1) {
        assert.equal(findings[1].title, 'Missing validation');
        assert.equal(findings[1].filePath, 'src/handler.js');
      }
    });

    it('recovers findings from wrapped object { "candidates": [ ... ] } with markdown prose', () => {
      const output = `
<<<PR_REVIEW_JSON>>>
{
  "candidates": [
    {
      "title": "XSS Vulnerability",
      "severity": "P0",
      "file": "src/render.js",
      "line": 105,
      "confidence": 0.95,
      "body": "Unsanitized innerHTML assignment."
    }
  ]
}
<<<END_PR_REVIEW_JSON>>>
`;
      const findings = recoverFindingsFromText(output);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].title, 'XSS Vulnerability');
      assert.equal(findings[0].severity, 'P0');
      assert.equal(findings[0].filePath, 'src/render.js');
      assert.equal(findings[0].line, 105);
    });

    it('returns empty array when output contains no findings or valid candidates', () => {
      const emptyText = `<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>`;
      assert.deepEqual(recoverFindingsFromText(emptyText), []);
      assert.deepEqual(recoverFindingsFromText('Everything looks clean, no defects found.'), []);
      assert.deepEqual(recoverFindingsFromText(''), []);
      assert.deepEqual(recoverFindingsFromText(null), []);
    });
  });
});
