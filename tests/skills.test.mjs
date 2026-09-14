import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Agent Skill: gem-pr-review (Agent Plugins 1.0)', () => {
  const skillPath = path.resolve('skills/gem-pr-review/SKILL.md');
  const readmePath = path.resolve('README.md');
  const cliReferencePath = path.resolve('docs/cli.md');
  const actionReferencePath = path.resolve('docs/github-action.md');
  const pluginReferencePath = path.resolve('docs/plugin.md');

  it('skill file exists at skills/gem-pr-review/SKILL.md', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md should exist');
  });

  it('contains valid YAML frontmatter with name and description', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch, 'SKILL.md must start with YAML frontmatter delimited by ---');

    const frontmatter = frontmatterMatch[1];
    assert.match(frontmatter, /^name:\s*gem-pr-review\b/m, 'Frontmatter must have name: gem-pr-review');
    assert.match(frontmatter, /^description:\s*.+/m, 'Frontmatter must have a description');
  });

  it('documents all review modes: balanced, quick, full, deep', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');

    assert.ok(content.includes('--balanced') || content.includes('balanced'), 'Should document balanced mode');
    assert.ok(content.includes('--quick') || content.includes('quick'), 'Should document quick mode');
    assert.ok(content.includes('--full') || content.includes('full'), 'Should document full mode');
    assert.ok(content.includes('--deep') || content.includes('deep'), 'Should document deep mode');
  });

  it('documents specialist lenses and structured findings contract', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');

    // Specialist lenses
    assert.match(content, /correctness/i, 'Should document correctness lens');
    assert.match(content, /security/i, 'Should document security lens');
    assert.match(content, /performance/i, 'Should document performance lens');

    // Structured findings contract
    assert.match(content, /P0/i, 'Should mention P0 severity');
    assert.match(content, /P1/i, 'Should mention P1 severity');
    assert.match(content, /P2/i, 'Should mention P2 severity');
    assert.match(content, /confidence/i, 'Should mention confidence scoring');
    assert.match(content, /host-gated/i, 'Should mention host-gated publishing');
  });

  it('documents incremental re-reviews and prior findings revalidation', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes('--incremental') || content.includes('incremental'), 'Should document incremental mode');
    assert.match(content, /revalidation|revalidate/i, 'Should document finding revalidation');
    assert.match(content, /resolved/i, 'Should document resolved status');
    assert.match(content, /still open/i, 'Should document still open status');
  });

  it('does not contain local machine absolute paths (security rule)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.doesNotMatch(content, /\/Users\//, 'Must not expose /Users/ machine paths');
    assert.doesNotMatch(content, /\/home\//, 'Must not expose /home/ machine paths');
  });

  it('documents large-diff transport and host-supervised reader tools', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /200\s*KB/i, 'Should document 200 KB threshold');
    assert.match(content, /file-backed/i, 'Should document file-backed transport');
    assert.match(content, /manifest/i, 'Should document changed-file manifest');
    assert.match(content, /diff_read|read/i, 'Should document read tool');
    assert.match(content, /diff_grep|grep/i, 'Should document grep tool');
    assert.match(content, /diff_find|find/i, 'Should document find tool');
    assert.match(content, /640\s*KB/i, 'Should document 640 KB budget');
  });

  it('documents interactive finding selection and cached publish-later', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /interactive/i, 'Should document interactive finding selection');
    assert.match(content, /--all/i, 'Should document --all flag');
    assert.match(content, /--publish-cached|publish_cached/i, 'Should document publish-cached');
    assert.match(content, /gem_pr_review_publish_cached/i, 'Should document MCP tool gem_pr_review_publish_cached');
    assert.match(content, /freshness|stale/i, 'Should document head freshness / stale check');
  });

  it('documents automatic fallback model retry on quota errors and zero timeouts', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /fallback/i, 'Should document fallback model retry');
    assert.match(content, /quota|429|capacity/i, 'Should document quota/capacity error detection');
    assert.match(content, /timeout/i, 'Should document zero timeout execution');
  });

  it('documents one-shot coding-task self-review (gem_self_review) and fail-closed safety gate', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /gem_self_review/i, 'Should document gem_self_review');
    assert.match(content, /self-review/i, 'Should document self-review');
    assert.match(content, /fail-closed/i, 'Should document fail-closed safety gate');
    assert.match(content, /worktree/i, 'Should document local worktree diff acquisition');
    assert.match(content, /synthetic/i, 'Should document synthetic diffs for untracked files');
    assert.match(content, /scripts\/self-review\.mjs/i, 'Should document self-review script');
  });

  it('documents candidate finding recovery from degraded or malformed model output', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Candidate Finding Recovery/i, 'Should document candidate finding recovery');
    assert.match(content, /repairJsonString/i, 'Should mention repairJsonString');
    assert.match(content, /extractCandidateObjects/i, 'Should mention extractCandidateObjects');
    assert.match(content, /extractJsonEnvelope/i, 'Should mention extractJsonEnvelope');
    assert.match(content, /normalizeFindingCandidate/i, 'Should mention normalizeFindingCandidate');
  });

  it('documents reusable GitHub Action and automated CI review workflow (action.yml)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /action\.yml|GitHub Action/i, 'Should document action.yml or GitHub Action');
    assert.match(content, /fail_on/i, 'Should document fail_on input');
    assert.match(content, /synchronize/i, 'Should document synchronize event auto-detection');
    assert.match(content, /starter workflow|\.github\/workflows\/gem-pr-review\.yml/i, 'Should document starter workflow');
  });

  it('documents pluggable custom review roles and flexible role composition', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /custom_roles|custom review roles/i, 'Should document custom review roles');
    assert.match(content, /replace_standard_roles/i, 'Should document replace_standard_roles');
    assert.match(content, /enabled_roles/i, 'Should document enabled_roles');
    assert.match(content, /--role/i, 'Should document --role CLI flag');
    assert.match(content, /--replace-standard-roles/i, 'Should document --replace-standard-roles CLI flag');
    assert.match(content, /reasoningEffort/i, 'Should document reasoningEffort');
  });

  it('documents semantic versioning, release management, and manifest synchronization', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /semantic versioning|bump-version/i, 'Should document semantic versioning');
    assert.match(content, /bump-version\.mjs/i, 'Should mention scripts/bump-version.mjs');
    assert.match(content, /--version|-v/i, 'Should mention --version flag');
    assert.match(content, /manifest/i, 'Should mention manifest synchronization');
  });

  it('documents calibrated language-agnostic review checklists (Increment 16)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Where the argument breaks down/i, 'Should mention where the argument breaks down');
    assert.match(content, /Landing Surface Invariants/i, 'Should mention landing surface invariants');
    assert.match(content, /Ambient State Coupling/i, 'Should mention ambient state coupling');
    assert.match(content, /Data Exposure/i, 'Should mention data exposure');
    assert.match(content, /Redundant Work/i, 'Should mention redundant work');
    assert.match(content, /Dead Code & Phantom Logic/i, 'Should mention dead code and phantom logic');
    assert.match(content, /Single Source of Truth/i, 'Should mention single source of truth');
    assert.match(content, /Evidence Before Completion/i, 'Should mention evidence before completion');
  });

  it('documents model catalog auto fallback resilience and streamlined dogfood:pr command (Increment 16)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Model Catalog & Auto Fallback Resilience/i, 'Should document model catalog resilience');
    assert.match(content, /isModelUnavailableError/i, 'Should mention isModelUnavailableError');
    assert.match(content, /fallback_to_auto/i, 'Should mention fallback_to_auto setting');
    assert.match(content, /npm run dogfood:pr/i, 'Should document npm run dogfood:pr');
    assert.match(content, /scripts\/dogfood-pr\.mjs/i, 'Should document scripts/dogfood-pr.mjs');
    assert.match(content, /--model auto/i, 'Should document default --model auto');
  });

  it('links first-time users to the CLI reference for advanced CLI usage', () => {
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    assert.ok(fs.existsSync(cliReferencePath), 'docs/cli.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    const cliContent = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(readmeContent, /\(docs\/cli\.md\)/, 'README should link to the CLI reference');
    assert.match(cliContent, /npm run dogfood:pr/i, 'CLI reference should document npm run dogfood:pr');
  });

  it('links first-time users to the plugin reference and plugin identity', () => {
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.match(readmeContent, /\(docs\/plugin\.md\)/, 'README should link to the plugin reference');
    assert.match(readmeContent, /Agent Plugins 1\.0/, 'README should state the Agent Plugins identity');
    assert.match(readmeContent, /copilot plugin install/, 'README should show the Copilot plugin install');
  });

  it('documents the plugin shape in the focused plugin reference', () => {
    assert.ok(fs.existsSync(pluginReferencePath), 'docs/plugin.md must exist');
    const content = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(content, /agent-plugins\.org/, 'Plugin reference should link the Agent Plugins spec');
    assert.match(content, /copilot plugin install/, 'Plugin reference should document install');
    assert.match(content, /Copilot CLI runtime/, 'Plugin reference should document the runtime requirement');
    assert.match(content, /\/gem-pr-review /, 'Plugin reference should document skill invocation');
    assert.match(content, /gem_pr_review_subagents/, 'Plugin reference should document MCP tools');
    assert.match(content, /marketplace add xpepper\/copilot-plugins/, 'Plugin reference should document marketplace install');
    assert.match(content, /copilot plugin install gem-pr-review@xpepper-copilot-plugins/, 'Plugin reference should document the marketplace install command');
  });

  it('names the registered pr_review_ MCP tool aliases in the plugin reference', () => {
    assert.ok(fs.existsSync(pluginReferencePath), 'docs/plugin.md must exist');
    const content = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(content, /`pr_review_threads`/, 'Should name the pr_review_threads alias');
    assert.match(content, /`pr_review_architecture`/, 'Should name the pr_review_architecture alias');
    assert.match(content, /`pr_review_guidelines`/, 'Should name the pr_review_guidelines alias');
    assert.match(content, /`pr_review_diagnostics`/, 'Should name the pr_review_diagnostics alias');
  });

  it('documents the MCP tool inventory in the focused MCP tools reference', () => {
    const mcpToolsPath = path.resolve('docs/mcp-tools.md');
    assert.ok(fs.existsSync(mcpToolsPath), 'docs/mcp-tools.md must exist');
    const content = fs.readFileSync(mcpToolsPath, 'utf8');
    for (const tool of [
      'gem_pr_review_subagents',
      'gem_pr_review_diff',
      'gem_pr_review_diff_read',
      'gem_pr_review_publish',
      'gem_pr_review_publish_cached',
      'gem_pr_review_prior',
      'gem_pr_review_threads',
      'gem_pr_review_architecture',
      'gem_pr_review_verify',
      'gem_self_review',
      'gem_pr_review_guidelines',
      'gem_pr_review_diagnostics',
    ]) {
      assert.ok(content.includes(`\`${tool}\``), `MCP reference should document ${tool}`);
    }
    assert.ok(content.includes('`pr_review_threads`'), 'Should note the registered prefix aliases');
    assert.ok(content.includes('`gem_pr_review_self`'), 'Should note the gem_pr_review_self alias');
    assert.ok(content.includes('`pr_review_diff`'), 'Should document the dispatcher-only aliases');
    assert.match(content, /16 reads/, 'Should document the diff_read read cap');
    assert.match(content, /640 KB/, 'Should document the diff_read byte budget');
    assert.match(content, /50 inline comments/i, 'Should document the inline comment cap');
    assert.match(content, /host-gated/i, 'Should document host-gated publishing');
    assert.match(content, /required `expectedHeadSha`/, 'Should document the required stale-head parameter on publish tools');
  });

  it('documents custom review roles in the focused roles reference', () => {
    const rolesPath = path.resolve('docs/custom-roles.md');
    assert.ok(fs.existsSync(rolesPath), 'docs/custom-roles.md must exist');
    const content = fs.readFileSync(rolesPath, 'utf8');
    for (const key of ['`custom_roles`', '`replace_standard_roles`', '`enabled_roles`', '`prompt`', '`reasoningEffort`', '`fallbacks`']) {
      assert.ok(content.includes(key), `Roles reference should document ${key}`);
    }
    assert.match(content, /--role/, 'Should document the --role flag');
    assert.match(content, /--replace-standard-roles/, 'Should document --replace-standard-roles');
    assert.match(content, /\.github\/gem-pr-review\.json/, 'Should document the project config file');
    assert.match(content, /~\/\.copilot\/gem-pr-review\.json/, 'Should document the user config file');
    assert.match(content, /override the standard/i, 'Should document lens override by id');
  });

  it('documents repository review guidelines in the focused guidelines reference', () => {
    const guidelinesPath = path.resolve('docs/guidelines.md');
    assert.ok(fs.existsSync(guidelinesPath), 'docs/guidelines.md must exist');
    const content = fs.readFileSync(guidelinesPath, 'utf8');
    assert.match(content, /\.github\/gem-pr-review\.md/, 'Should document the default guidelines file');
    assert.match(content, /\.github\/review-instructions\.md/, 'Should document the fallback filename');
    assert.match(content, /## Lens:/, 'Should document Lens section routing');
    assert.match(content, /## Role:/, 'Should document Role section routing');
    assert.match(content, /64 KB/, 'Should document the size cap');
    assert.match(content, /gem_pr_review_guidelines/, 'Should document the inspection tool');
    assert.match(content, /--guidelines/, 'Should document the CLI flag');
    assert.match(content, /guidelines_path/, 'Should document the Action input');
  });

  it('documents verbose diagnostics in the focused diagnostics reference', () => {
    const diagnosticsPath = path.resolve('docs/diagnostics.md');
    assert.ok(fs.existsSync(diagnosticsPath), 'docs/diagnostics.md must exist');
    const content = fs.readFileSync(diagnosticsPath, 'utf8');
    assert.match(content, /--verbose/, 'Should document --verbose');
    assert.match(content, /-V/, 'Should document the -V short flag');
    assert.match(content, /--json/, 'Should document --json');
    assert.match(content, /gem_pr_review_diagnostics/, 'Should document the MCP diagnostics tool');
    assert.match(content, /Phase Timing/, 'Should document phase timing');
    assert.match(content, /Per-Lens Execution/, 'Should document per-lens execution');
    assert.match(content, /redact/i, 'Should document redaction');
    assert.match(content, /machine paths/i, 'Should document machine path redaction');
    assert.match(
      content,
      /re-sanitizes anything it is handed/i,
      'Should document re-sanitization of caller-supplied diagnostics'
    );
    assert.doesNotMatch(content, /formatted as-is/, 'The as-is formatting boundary must be gone');
  });

  it('documents verification and gated approval in the focused verification reference', () => {
    const verificationPath = path.resolve('docs/verification.md');
    assert.ok(fs.existsSync(verificationPath), 'docs/verification.md must exist');
    const content = fs.readFileSync(verificationPath, 'utf8');
    assert.match(content, /`test`/, 'Should document the test profile');
    assert.match(content, /`build`/, 'Should document the build profile');
    assert.match(content, /`lint`/, 'Should document the lint profile');
    assert.match(content, /verificationProfiles/, 'Should document custom profiles');
    assert.match(content, /enableCustomCiProfiles/, 'Should document the CI opt-in');
    assert.match(content, /fork/i, 'Should document fork fail-closed behavior');
    assert.match(content, /approveMaxPriorityLevel/, 'Should document gated approval');
    assert.match(content, /gem_pr_review_verify/, 'Should document the verify MCP tool');
    assert.match(content, /--verify/, 'Should document the comment flag');
    assert.match(content, /cross-check/i, 'Should document the supplied headSha cross-check');
  });

  it('documents release and marketplace maintenance in the focused release reference', () => {
    const releasePath = path.resolve('docs/release.md');
    assert.ok(fs.existsSync(releasePath), 'docs/release.md must exist');
    const content = fs.readFileSync(releasePath, 'utf8');
    assert.match(content, /npm run version:check/, 'Should document version:check');
    assert.match(content, /npm run bump/, 'Should document bump');
    assert.match(content, /npm run release/, 'Should document release');
    assert.match(content, /skills\/gem-pr-review\/SKILL\.md/, 'Should list all four synchronized manifests');
    assert.match(content, /workflow_dispatch/, 'Should document the dispatch-only publish');
    assert.match(content, /xpepper\/copilot-plugins/, 'Should document the plugin marketplace update');
    assert.match(content, /`ref`/, 'Should document the ref pin bump');
    const pluginContent = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(pluginContent, /release\.md/, 'plugin.md should link to the release reference');
  });

  it('cross-links the focused reference pages from the landing and shape pages', () => {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    for (const page of ['mcp-tools', 'custom-roles', 'guidelines', 'diagnostics', 'verification', 'release']) {
      assert.ok(readmeContent.includes(`docs/${page}.md`), `README should link docs/${page}.md`);
    }
    const pluginContent = fs.readFileSync(pluginReferencePath, 'utf8');
    assert.match(pluginContent, /mcp-tools\.md/, 'plugin.md should link the MCP tools reference');
    assert.match(pluginContent, /custom-roles\.md/, 'plugin.md should link the roles reference');
    assert.match(pluginContent, /guidelines\.md/, 'plugin.md should link the guidelines reference');
    const cliContent = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(cliContent, /diagnostics\.md/, 'cli.md should link the diagnostics reference');
    assert.match(cliContent, /verification\.md/, 'cli.md should link the verification reference');
    const actionContent = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(actionContent, /verification\.md/, 'github-action.md should link the verification reference');
  });

  it('introduces the shapes in plugin-first order in the installation reference', () => {
    const installationReferencePath = path.resolve('docs/installation.md');
    assert.ok(fs.existsSync(installationReferencePath), 'docs/installation.md must exist');
    const content = fs.readFileSync(installationReferencePath, 'utf8').replace(/\s+/g, ' ');
    assert.match(
      content,
      /available as a Copilot CLI plugin, a GitHub Action, and a local CLI/,
      'Installation intro should enumerate the plugin first, matching the plugin-first page order'
    );
  });

  it('documents centralized CLI infrastructure and pre-commit hook installer in SKILL.md (Increment 17)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Centralized CLI Infrastructure/i, 'Should document Centralized CLI Infrastructure');
    assert.match(content, /runIfDirect/i, 'Should document runIfDirect');
    assert.match(content, /handleCommonFlags/i, 'Should document handleCommonFlags');
    assert.match(content, /isDirectRun/i, 'Should document isDirectRun');
    assert.match(content, /npm run install-hook/i, 'Should document npm run install-hook');
    assert.match(content, /--install-hook/i, 'Should document --install-hook');
    assert.match(content, /--uninstall-hook/i, 'Should document --uninstall-hook');
  });

  it('documents pre-commit self-review in the CLI reference (Increment 17)', () => {
    assert.ok(fs.existsSync(cliReferencePath), 'docs/cli.md must exist');
    const content = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(content, /npm run install-hook/i, 'CLI reference should document npm run install-hook');
    assert.match(content, /--install-hook/i, 'CLI reference should document --install-hook');
    assert.match(content, /--uninstall-hook/i, 'CLI reference should document --uninstall-hook');
  });

  it('documents interactive PR comment command dispatcher in SKILL.md (Increment 18)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Interactive PR Comment Command Dispatcher/i, 'Should document Interactive PR Comment Command Dispatcher');
    assert.match(content, /\/gem-review/i, 'Should mention /gem-review');
    assert.match(content, /\/gem-pr-review/i, 'Should mention /gem-pr-review');
    assert.match(content, /author_association/i, 'Should mention author_association');
    assert.match(content, /COLLABORATOR/i, 'Should mention COLLABORATOR');
    assert.match(content, /eyes/i, 'Should document eyes reaction');
    assert.match(content, /rocket/i, 'Should document rocket reaction');
    assert.match(content, /confused/i, 'Should document confused reaction');
  });

  it('documents interactive PR comment authorization in the Action reference (Increment 18)', () => {
    assert.ok(fs.existsSync(actionReferencePath), 'docs/github-action.md must exist');
    const content = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(content, /\/gem-review/i, 'Action reference should document /gem-review');
    assert.match(content, /OWNER.*MEMBER.*COLLABORATOR/i, 'Action reference should document commenter authorization');
  });

  it('documents that total lens execution failure fails the Action', () => {
    const content = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(content, /^## Lens execution failures$/m, 'Action reference should have a lens execution failures section');
    assert.match(content, /every review lens fails to execute[\s\S]{0,400}fails the job/i, 'Action reference should state that total lens failure fails the job');
    assert.match(content, /dry-run/, 'Action reference should state the failure applies to dry-run');
    assert.match(content, /only some lenses fail[\s\S]{0,200}warning annotation/i, 'Action reference should document partial lens failure warnings');
  });

  it('documents hosted-runner Copilot CLI authentication and fork behavior', () => {
    const content = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(content, /COPILOT_TOKEN[\s\S]{0,200}Copilot Requests/i);
    assert.match(content, /COPILOT_GITHUB_TOKEN/);
    assert.match(content, /secrets are not passed[\s\S]{0,200}forks/i);
    assert.match(content, /forks[\s\S]{0,200}fail closed/i);
  });

  it('documents COPILOT_CLI_PATH and COPILOT_SDK_PATH independently in the plugin reference', () => {
    const content = fs.readFileSync(path.resolve('docs/plugin.md'), 'utf8');
    assert.match(content, /`COPILOT_CLI_PATH`[\s\S]{0,80}specific Copilot CLI binary/, 'plugin.md should state COPILOT_CLI_PATH alone selects the CLI binary');
    assert.match(content, /`COPILOT_SDK_PATH`[\s\S]{0,80}Copilot SDK/, 'plugin.md should state COPILOT_SDK_PATH enables the SDK runtime');
  });

  it('documents repository review guidelines in SKILL.md (Increment 19)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Repository Review Guidelines/i, 'Should document Repository Review Guidelines');
    assert.match(content, /\.github\/gem-pr-review\.md/i, 'Should document .github/gem-pr-review.md');
    assert.match(content, /\.github\/review-instructions\.md/i, 'Should document .github/review-instructions.md');
    assert.match(content, /gem_pr_review_guidelines/i, 'Should document gem_pr_review_guidelines MCP tool');
    assert.match(content, /--guidelines/i, 'Should document --guidelines flag');
    assert.match(content, /guidelines_path/i, 'Should document guidelines_path input');
  });

  it('documents repository review-guideline options in focused references (Increment 19)', () => {
    const cliContent = fs.readFileSync(cliReferencePath, 'utf8');
    const actionContent = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(cliContent, /--guidelines/i, 'CLI reference should document --guidelines');
    assert.match(actionContent, /guidelines_path/i, 'Action reference should document guidelines_path');
  });

  it('documents review thread conversation replies and automated resolution in SKILL.md (Increment 20)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Review Thread Verification & Automated Resolution/i, 'Should document Review Thread Verification');
    assert.match(content, /--resolve/i, 'Should document --resolve flag');
    assert.match(content, /gem_pr_review_threads/i, 'Should document gem_pr_review_threads MCP tool');
    assert.match(content, /\/gem-review resolve/i, 'Should document /gem-review resolve command');
  });

  it('documents review-thread resolution in the CLI reference (Increment 20)', () => {
    const content = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(content, /--resolve/i, 'CLI reference should document --resolve');
  });

  it('documents PR architecture walkthrough and Mermaid sequence/component diagrams in SKILL.md (Increment 21)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Architecture & System Impact/i, 'Should document Architecture & System Impact');
    assert.match(content, /Mermaid/i, 'Should document Mermaid diagrams');
    assert.match(content, /sequenceDiagram/i, 'Should document Mermaid sequenceDiagram');
    assert.match(content, /--architecture/i, 'Should document --architecture flag');
    assert.match(content, /gem_pr_review_architecture/i, 'Should document gem_pr_review_architecture MCP tool');
  });

  it('documents architecture and Mermaid output in the CLI reference (Increment 21)', () => {
    const content = fs.readFileSync(cliReferencePath, 'utf8');
    assert.match(content, /Architecture.*Mermaid/i, 'CLI reference should document Architecture & Mermaid diagrams');
    assert.match(content, /--architecture/i, 'CLI reference should document --architecture');
  });

  it('documents safe verbose review diagnostics and telemetry in SKILL.md (Increment 22)', () => {
    assert.ok(fs.existsSync(skillPath), 'skills/gem-pr-review/SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, /Safe Verbose Review Diagnostics/i, 'Should document Safe Verbose Review Diagnostics');
    assert.match(content, /--verbose|-V/i, 'Should document --verbose or -V flag');
    assert.match(content, /--json/i, 'Should document --json flag');
    assert.match(content, /gem_pr_review_diagnostics/i, 'Should document gem_pr_review_diagnostics MCP tool');
    assert.match(content, /pr_review_diagnostics/i, 'Should document pr_review_diagnostics alias');
    assert.match(content, /\/gem-review --verbose/i, 'Should document /gem-review --verbose CI command');
    assert.match(content, /redaction|sanitiz/i, 'Should document telemetry redaction guarantees');
  });

  it('documents diagnostics in focused CLI and Action references (Increment 22)', () => {
    const cliContent = fs.readFileSync(cliReferencePath, 'utf8');
    const actionContent = fs.readFileSync(actionReferencePath, 'utf8');
    assert.match(cliContent, /--verbose|-V/i, 'CLI reference should document --verbose or -V');
    assert.match(cliContent, /--json/i, 'CLI reference should document --json');
    assert.match(actionContent, /verbose/i, 'Action reference should document verbose input');
    assert.match(actionContent, /diagnostics/i, 'Action reference should document diagnostics output');
  });
});
