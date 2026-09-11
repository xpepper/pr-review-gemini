#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — Zero-Dependency Atomic Manifest Bump & Release Utility
 *
 * Synchronizes versions across all repository manifests (package.json, plugin.json,
 * mcp.json, skills/gem-pr-review/SKILL.md) and automates SemVer calculation
 * from conventional commits since the latest git tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  VERSION,
  isValidSemVer,
  checkManifestSync,
  getManifestVersions,
  printVersionBanner,
} from '../src/version.js';
import {
  parseConventionalCommit,
  determineSemverBump,
  calculateNextVersion,
  generateChangelog,
  getGitCommitsSinceTag,
  bumpManifestVersions,
} from '../src/semver.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export function printUsage(output = console.log) {
  output(`
Usage: node scripts/bump-version.mjs [target] [options]

Target:
  auto                  Automatically calculate next SemVer from conventional commits [default]
  notes                 Generate release notes for current version without bumping manifests
  patch                 Bump patch version (0.1.0 -> 0.1.1)
  minor                 Bump minor version (0.1.0 -> 0.2.0)
  major                 Bump major version (0.1.0 -> 1.0.0)
  <x.y.z>               Set explicit SemVer version string (e.g. 1.0.0)

Options:
  --check               Verify that all manifests are in sync (exits 0 if synced, 1 if drift)
  --dry-run             Preview changes without writing to manifests
  --changelog           Print generated changelog to stdout
  --notes-file <path>   Write release notes directly to specified file
  --write-changelog     Prepend new release section to CHANGELOG.md
  --tag                 Create git commit and annotated tag for the new version
  --release             Full release: bump manifests, write changelog, commit, and tag
  -v, --version         Display current canonical version
  -h, --help            Display this help message
`);
}

export function parseCliArgs(args = []) {
  let target = null;
  let check = false;
  let dryRun = false;
  let printChangelog = false;
  let writeChangelog = false;
  let createTag = false;
  let notesFile = null;
  let rootDir = null;
  let showVersion = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else if (arg === '--check') {
      check = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--changelog') {
      printChangelog = true;
    } else if (arg === '--notes-file' && args[i + 1]) {
      notesFile = args[++i];
    } else if (arg === '--cwd' && args[i + 1]) {
      rootDir = path.resolve(args[++i]);
    } else if (arg === '--write-changelog') {
      writeChangelog = true;
    } else if (arg === '--tag') {
      createTag = true;
    } else if (arg === '--release') {
      writeChangelog = true;
      createTag = true;
    } else if (!target && !arg.startsWith('-')) {
      target = arg;
    }
  }

  return {
    target: target || (check || showVersion || showHelp ? null : 'auto'),
    check,
    dryRun,
    printChangelog,
    writeChangelog,
    createTag,
    notesFile,
    rootDir,
    showVersion,
    showHelp,
  };
}

/**
 * Prepend a changelog entry to CHANGELOG.md (creating if missing).
 */
export function updateChangelogFile(changelogEntry, rootDir = ROOT_DIR) {
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const header = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';

  let existing = '';
  if (fs.existsSync(changelogPath)) {
    existing = fs.readFileSync(changelogPath, 'utf8');
    // Strip header if already present
    if (existing.startsWith('# Changelog')) {
      existing = existing.replace(/^# Changelog\s*(?:All notable[^\n]*\n*)?/, '').trim();
    }
  }

  const combined = existing ? `${header}${changelogEntry}\n${existing}\n` : `${header}${changelogEntry}\n`;
  fs.writeFileSync(changelogPath, combined, 'utf8');
}

/**
 * Runs the bump command.
 */
export async function runBump(options = {}, io = console) {
  const rootDir = options.rootDir || ROOT_DIR;
  const execFn = options.execFileFn || execFileAsync;
  const execGitFn =
    options.execGitFn ||
    (options.execFileFn
      ? async (args) => {
          const res = await execFn('git', args, { cwd: rootDir });
          return (res?.stdout || '').trim();
        }
      : undefined);

  // 1. Check mode
  if (options.check) {
    const syncResult = checkManifestSync(rootDir);
    if (!syncResult.inSync) {
      io.error(`❌ Manifest sync check failed:\n${syncResult.error}`);
      return { success: false, exitCode: 1, syncResult };
    }
    io.log(`✅ All manifests are synchronized at version ${syncResult.version}:`);
    io.log(`   - package.json:               ${syncResult.versions.packageJson}`);
    io.log(`   - plugin.json:                ${syncResult.versions.pluginJson}`);
    io.log(`   - mcp.json:                   ${syncResult.versions.mcpJson}`);
    io.log(`   - skills/gem-pr-review/SKILL.md: ${syncResult.versions.skillMd}`);
    return { success: true, exitCode: 0, syncResult };
  }

  // 2. Resolve current canonical version
  const currentVersions = getManifestVersions(rootDir);
  const currentVersion = currentVersions.packageJson || VERSION;

  // 3. Resolve target version
  let target = options.target || 'auto';
  let bumpType = null;
  let newVersion = null;

  const isNamedBump = ['major', 'minor', 'patch'].includes(target.toLowerCase());
  const isValidTarget = target === 'notes' || target === 'auto' || isNamedBump || isValidSemVer(target);
  if (!isValidTarget) {
    io.error(`❌ Invalid target version or bump type: "${target}".`);
    return { success: false, exitCode: 1, error: 'Invalid target' };
  }

  // Fetch git commits once since latest tag for all target types
  const gitInfo = await getGitCommitsSinceTag({ cwd: rootDir, execGitFn });
  const commits = gitInfo.commits;
  const latestTag = gitInfo.latestTag;

  if (target === 'notes') {
    const changelogText = generateChangelog({
      version: currentVersion,
      previousVersion: latestTag || '0.1.0',
      commits,
    });

    if (options.notesFile) {
      fs.writeFileSync(path.resolve(rootDir, options.notesFile), changelogText + '\n', 'utf8');
      io.log(`📄 Wrote release notes to ${options.notesFile}`);
    } else {
      io.log(changelogText);
    }

    return {
      success: true,
      exitCode: 0,
      currentVersion,
      newVersion: currentVersion,
      bumpType: 'none',
      changelog: changelogText,
      notesFile: options.notesFile,
    };
  }

  if (target === 'auto') {
    const evalResult = determineSemverBump(commits);
    if (!evalResult.bump) {
      io.log(`ℹ️ No conventional commits found since tag ${latestTag || 'beginning'}. Version remains ${currentVersion}.`);
      return {
        success: true,
        exitCode: 0,
        unchanged: true,
        currentVersion,
        newVersion: currentVersion,
        bumpType: 'none',
      };
    }

    bumpType = evalResult.bump;
    newVersion = calculateNextVersion(currentVersion, bumpType);
    io.log(`🔍 Analyzed ${commits.length} commit(s) since ${latestTag || 'initial commit'}:`);
    io.log(`   - Determined bump: ${bumpType.toUpperCase()} (${evalResult.reason})`);
  } else if (isNamedBump) {
    bumpType = target.toLowerCase();
    newVersion = calculateNextVersion(currentVersion, bumpType);
  } else {
    newVersion = target.trim();
    bumpType = 'explicit';
  }

  io.log(`🚀 Bumping version: ${currentVersion} -> ${newVersion} (${options.dryRun ? 'DRY-RUN' : 'APPLYING'})`);

  // 4. Generate changelog
  const changelogText = generateChangelog({
    version: newVersion,
    previousVersion: currentVersion,
    commits,
  });

  if (options.notesFile) {
    fs.writeFileSync(path.resolve(rootDir, options.notesFile), changelogText + '\n', 'utf8');
    io.log(`📄 Wrote release notes to ${options.notesFile}`);
  }

  if (options.printChangelog) {
    io.log('\n--- Generated Changelog ---');
    io.log(changelogText);
    io.log('---------------------------\n');
  }

  // 5. Bump manifests
  const bumpResult = bumpManifestVersions({
    newVersion,
    rootDir,
    dryRun: options.dryRun,
  });

  if (!options.dryRun) {
    io.log(`✅ Successfully updated ${bumpResult.updatedFiles.length} manifest files to v${newVersion}.`);

    // 6. Write changelog if requested
    if (options.writeChangelog) {
      updateChangelogFile(changelogText, rootDir);
      io.log(`📝 Updated CHANGELOG.md with release notes for v${newVersion}.`);
    }

    // 7. Git commit and tag if requested
    if (options.createTag) {
      try {
        const filesToStage = [
          'package.json',
          'plugin.json',
          'mcp.json',
          'skills/gem-pr-review/SKILL.md',
        ];
        if (options.writeChangelog && fs.existsSync(path.join(rootDir, 'CHANGELOG.md'))) {
          filesToStage.push('CHANGELOG.md');
        }
        await execFn('git', ['add', ...filesToStage], { cwd: rootDir });
        await execFn('git', ['commit', '-m', `chore(release): v${newVersion}`], { cwd: rootDir });
        await execFn('git', ['tag', '-a', `v${newVersion}`, '-m', `Release v${newVersion}`], { cwd: rootDir });
        io.log(`🏷️ Created git commit and tag v${newVersion}.`);
      } catch (gitErr) {
        io.error(`❌ Git commit/tag failed: ${gitErr.message}`);
        return {
          success: false,
          exitCode: 1,
          error: gitErr.message,
          currentVersion,
          newVersion,
          bumpType,
        };
      }
    }
  } else {
    io.log(`🔎 Dry-run completed. No files modified.`);
  }

  return {
    success: true,
    exitCode: 0,
    currentVersion,
    newVersion,
    bumpType,
    changelog: changelogText,
    dryRun: Boolean(options.dryRun),
  };
}

export async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.showVersion) {
    printVersionBanner();
    process.exit(0);
  }

  if (parsed.showHelp) {
    printUsage();
    process.exit(0);
  }

  const result = await runBump(parsed, console);
  process.exit(result.exitCode);
}

// Auto-run if executed directly via node scripts/bump-version.mjs
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('bump-version.mjs') || process.argv[1].endsWith('bump-version'));

if (isDirectExecution) {
  main();
}
