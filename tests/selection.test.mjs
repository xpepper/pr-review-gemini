import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import {
  formatFindingRow,
  formatFindingsTable,
  parseSelectionInput,
  filterFindings,
  promptFindingSelection,
} from '../src/selection.js';

describe('Finding Selection & Table Formatting', () => {
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
      title: 'Unhandled null reference on profile',
      severity: 'P1',
      file: 'src/user.js',
      line: 88,
      side: 'RIGHT',
      confidence: 0.92,
      body: 'profile may be undefined for guest users.',
    },
    {
      title: 'Unclosed stream handle on error',
      severity: 'P2',
      file: 'src/stream.js',
      line: 15,
      side: 'RIGHT',
      confidence: 0.85,
      body: 'Stream handle remains open when exception is thrown.',
    },
    {
      title: 'Variable name could be more descriptive',
      severity: 'P3',
      file: 'src/utils.js',
      line: 104,
      side: 'RIGHT',
      confidence: 0.75,
      body: 'Consider renaming `tmp` to `sanitizedBuffer`.',
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

  describe('formatFindingRow', () => {
    it('formats finding row with index, severity, confidence, location, and title', () => {
      const row = formatFindingRow(sampleFindings[0], 0);
      assert.match(row, /\[1\]/);
      assert.match(row, /\[P0\]/);
      assert.match(row, /98%/);
      assert.match(row, /src\/search\.js:42/);
      assert.match(row, /SQL injection in search handler/);
    });

    it('handles findings without line or confidence gracefully', () => {
      const finding = {
        title: 'Global invariant broken',
        severity: 'P2',
        file: 'README.md',
      };
      const row = formatFindingRow(finding, 4);
      assert.match(row, /\[5\]/);
      assert.match(row, /\[P2\]/);
      assert.match(row, /README\.md/);
      assert.match(row, /Global invariant broken/);
    });
  });

  describe('formatFindingsTable', () => {
    it('returns empty message when findings list is empty', () => {
      const output = formatFindingsTable([]);
      assert.match(output, /No findings to display/i);
    });

    it('formats a clean table with headers, summary counts, and all rows', () => {
      const output = formatFindingsTable(sampleFindings);
      assert.match(output, /#\s+Sev\s+Conf\s+Location\s+—\s+Title/);
      assert.match(output, /SQL injection/);
      assert.match(output, /Trailing whitespace/);
      assert.match(output, /Total findings: 5/);
      assert.match(output, /P0: 1/);
      assert.match(output, /nit: 1/);
    });
  });

  describe('parseSelectionInput', () => {
    it('parses "all" or "*" to all indices', () => {
      const res = parseSelectionInput('all', 5, sampleFindings);
      assert.deepEqual(res, [0, 1, 2, 3, 4]);

      const resStar = parseSelectionInput('*', 3, sampleFindings);
      assert.deepEqual(resStar, [0, 1, 2]);
    });

    it('parses empty string to all indices when default is all', () => {
      const res = parseSelectionInput('', 4, sampleFindings, { defaultAll: true });
      assert.deepEqual(res, [0, 1, 2, 3]);
    });

    it('parses "none" to empty array', () => {
      const res = parseSelectionInput('none', 5, sampleFindings);
      assert.deepEqual(res, []);
    });

    it('parses comma-separated numbers (1-based to 0-based)', () => {
      const res = parseSelectionInput('1, 3, 5', 5, sampleFindings);
      assert.deepEqual(res, [0, 2, 4]);
    });

    it('parses ranges like 2-4', () => {
      const res = parseSelectionInput('2-4', 5, sampleFindings);
      assert.deepEqual(res, [1, 2, 3]);
    });

    it('parses mixed ranges and numbers', () => {
      const res = parseSelectionInput('1, 3-5', 5, sampleFindings);
      assert.deepEqual(res, [0, 2, 3, 4]);
    });

    it('ignores out-of-bounds indices', () => {
      const res = parseSelectionInput('0, 2, 6, 99', 5, sampleFindings);
      assert.deepEqual(res, [1]);
    });

    it('supports exclusions with negative numbers or exclamation mark', () => {
      const res = parseSelectionInput('1-5, -2, !4', 5, sampleFindings);
      assert.deepEqual(res, [0, 2, 4]);
    });

    it('supports severity filters by name (e.g. p0, p1)', () => {
      const res = parseSelectionInput('p0, p1', 5, sampleFindings);
      assert.deepEqual(res, [0, 1]);
    });

    it('supports min severity filters (e.g. min:p2 or >=p2)', () => {
      const res = parseSelectionInput('min:p2', 5, sampleFindings);
      // P0 (index 0), P1 (index 1), P2 (index 2)
      assert.deepEqual(res, [0, 1, 2]);

      const resGte = parseSelectionInput('>=p1', 5, sampleFindings);
      assert.deepEqual(resGte, [0, 1]);
    });

    it('supports "no-nits" / "no-nit" filter', () => {
      const res = parseSelectionInput('no-nits', 5, sampleFindings);
      assert.deepEqual(res, [0, 1, 2, 3]);
    });
  });

  describe('filterFindings', () => {
    it('returns all findings when selection is null or "all"', () => {
      const res = filterFindings(sampleFindings, 'all');
      assert.equal(res.length, 5);

      const resNull = filterFindings(sampleFindings, null);
      assert.equal(resNull.length, 5);
    });

    it('filters findings by index array', () => {
      const res = filterFindings(sampleFindings, [0, 2]);
      assert.equal(res.length, 2);
      assert.equal(res[0].severity, 'P0');
      assert.equal(res[1].severity, 'P2');
    });

    it('filters findings using string selector', () => {
      const res = filterFindings(sampleFindings, 'p0, p1');
      assert.equal(res.length, 2);
      assert.equal(res[0].title, 'SQL injection in search handler');
      assert.equal(res[1].title, 'Unhandled null reference on profile');
    });
  });

  describe('promptFindingSelection', () => {
    it('returns empty when findings array is empty', async () => {
      const res = await promptFindingSelection({ findings: [], isInteractive: false });
      assert.deepEqual(res.selectedFindings, []);
      assert.deepEqual(res.selectedIndices, []);
      assert.equal(res.cancelled, false);
    });

    it('returns all findings directly when not interactive', async () => {
      const res = await promptFindingSelection({
        findings: sampleFindings,
        isInteractive: false,
        defaultAll: true,
      });
      assert.equal(res.selectedFindings.length, 5);
      assert.deepEqual(res.selectedIndices, [0, 1, 2, 3, 4]);
      assert.equal(res.cancelled, false);
    });

    it('handles interactive selection via input stream', async () => {
      const inputStream = new Readable({
        read() {
          this.push('1, 3\n');
          this.push(null);
        },
      });

      let outputText = '';
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          outputText += chunk.toString();
          callback();
        },
      });

      const res = await promptFindingSelection({
        findings: sampleFindings,
        input: inputStream,
        output: outputStream,
        isInteractive: true,
      });

      assert.equal(res.cancelled, false);
      assert.deepEqual(res.selectedIndices, [0, 2]);
      assert.equal(res.selectedFindings.length, 2);
      assert.match(outputText, /Total findings: 5/);
      assert.match(outputText, /Selected 2 of 5 findings/);
    });

    it('handles interactive cancellation with "q" or "cancel"', async () => {
      const inputStream = new Readable({
        read() {
          this.push('q\n');
          this.push(null);
        },
      });

      let outputText = '';
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          outputText += chunk.toString();
          callback();
        },
      });

      const res = await promptFindingSelection({
        findings: sampleFindings,
        input: inputStream,
        output: outputStream,
        isInteractive: true,
      });

      assert.equal(res.cancelled, true);
      assert.deepEqual(res.selectedFindings, []);
      assert.match(outputText, /Publishing cancelled/);
    });
  });
});
