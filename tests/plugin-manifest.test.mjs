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

describe('Agent Plugins 1.0 bundle conformance', () => {
  const plugin = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
  const mcp = JSON.parse(fs.readFileSync('mcp.json', 'utf8'));
  const skillContent = fs.readFileSync('skills/gem-pr-review/SKILL.md', 'utf8');
  const skillFrontmatter = skillContent.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

  it('uses one plugin identity across plugin.json, mcp.json, and the skill', () => {
    assert.equal(mcp.name, plugin.name, 'mcp.json name must match plugin.json name');
    assert.match(
      skillFrontmatter,
      new RegExp(`^name:\\s*${plugin.name}\\b`, 'm'),
      'SKILL.md frontmatter name must match plugin.json name',
    );
  });

  it('declares the Agent Plugins 1.0 $schema in every JSON manifest', () => {
    assert.match(plugin.$schema, /agent-plugins\.org/, 'plugin.json must carry the Agent Plugins schema');
    assert.match(mcp.$schema, /agent-plugins\.org/, 'mcp.json must carry the Agent Plugins schema');
  });

  it('carries a SemVer version in every manifest', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
    assert.match(pkg.version, semver, 'package.json version must be SemVer');
    assert.match(plugin.version, semver, 'plugin.json version must be SemVer');
    assert.match(mcp.version, semver, 'mcp.json version must be SemVer');
    const skillVersion = skillFrontmatter.match(/^  version:\s*"?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)"?/m)?.[1];
    assert.ok(skillVersion, 'SKILL.md metadata must carry a version');
    assert.match(skillVersion, semver, 'SKILL.md version must be SemVer');
    assert.equal(plugin.version, pkg.version, 'plugin.json version must match package.json');
    assert.equal(mcp.version, pkg.version, 'mcp.json version must match package.json');
    assert.equal(skillVersion, pkg.version, 'SKILL.md version must match package.json');
  });

  it('keeps every skills/ directory a valid skill named after its directory', () => {
    const dirs = fs
      .readdirSync('skills', { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.ok(dirs.length >= 1, 'skills/ must contain at least one skill');
    for (const dir of dirs) {
      const skillPath = `skills/${dir.name}/SKILL.md`;
      assert.ok(fs.existsSync(skillPath), `${skillPath} must exist`);
      const frontmatter = fs.readFileSync(skillPath, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const name = frontmatter.match(/^name:\s*(\S+)/m)?.[1];
      assert.equal(name, dir.name, `skill name in ${skillPath} must match its directory name`);
    }
  });

  it('mcp.json declares a runnable server pointing at an existing entrypoint', () => {
    assert.equal(mcp.server.command, 'node');
    assert.deepEqual(mcp.server.args, ['server/index.js']);
    assert.ok(fs.existsSync('server/index.js'), 'server/index.js must exist');
    assert.ok(mcp.mcpServers[plugin.name], `mcpServers must expose '${plugin.name}'`);
    assert.equal(mcp.mcpServers[plugin.name].command, 'node');
    assert.deepEqual(mcp.mcpServers[plugin.name].args, ['server/index.js']);
  });
});
