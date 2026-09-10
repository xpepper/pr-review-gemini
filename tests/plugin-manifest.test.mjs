import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Plugin Manifest', () => {
  it('loads and validates plugin.json according to Agent Plugins 1.0', () => {
    const raw = fs.readFileSync('plugin.json', 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.name, 'gem-pr-review');
    assert.equal(typeof manifest.version, 'string');
    assert.ok(manifest.$schema.includes('agent-plugins.org'));
    assert.ok(Array.isArray(manifest.keywords));
    assert.ok(manifest.keywords.includes('copilot'));
    assert.ok(manifest.keywords.includes('gem-pr-review'));
  });
});
