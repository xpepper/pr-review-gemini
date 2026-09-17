# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2026-09-17

### 🐛 Bug Fixes

- cleanup stale copilot installs (#78) (#78) (`b2be840`)
- **ci:** consolidate trusted action contract detector (#73) (#73) (`54b13df`)

### 📝 Documentation

- record CI pipeline gates (#84) (#84) (`a8f6822`)
- CI pipeline design spec (#79) (#79) (`da11305`)
- finalize trusted detector follow-up (#74) (#74) (`452fdb8`)
- finalize v1.0.1 handoff (`28d9d49`)
- pin examples to v1.0.1 (`271e368`)

### 🧪 Tests

- CI workflow contract test and SemVer prerelease support (#85) (#85) (`52c5709`)
- action.yml modern composite contract (#81) (#81) (`593cd2f`)
- Agent Plugins 1.0 bundle conformance tests (#80) (#80) (`e5fcb58`)

### 🔧 Maintenance & Chores

- gate release on shared CI workflow (#83) (#83) (`5bfcae0`)
- add CI workflow (#82) (#82) (`f567f20`)

## [1.0.1] - 2026-09-15

### 🐛 Bug Fixes

- **action:** normalize local dependency cache paths (`ec939fb`)

## [1.0.0] - 2026-09-15

### 🚀 Features

- **action:** bootstrap pinned Copilot CLI (#64) (#64) (`871bd53`)
- **host-gates:** enforce expectedHeadSha, verify head cross-check, diagnostics re-sanitization (#56) (#56) (`72ffa88`)

### 🐛 Bug Fixes

- **release:** preserve commit fields while normalizing hashes (`2da893f`)
- **release:** normalize git log record separators (`6d3214e`)
- **ci:** provision Copilot CLI for review lenses (#62) (#62) (`559c42e`)
- **ci:** provision Copilot CLI for review lenses (`3fc782a`)
- **subagents:** honor COPILOT_CLI_PATH in the CLI fallback (#60) (#60) (`ed5ab3e`)
- **ci:** fail closed when review lenses cannot execute (#57) (#57) (`e96d977`)
- **ci:** provision Copilot CLI for review lenses (`cf002a1`)

### 📝 Documentation

- record v0.4.0 release, refresh pinned examples, and log CI review degradation (#55) (#55) (`331a13c`)

### 🔧 Maintenance & Chores

- Revert "fix(ci): provision Copilot CLI for review lenses" (#61) (#61) (`79f3e0b`)
- Revert "fix(ci): provision Copilot CLI for review lenses" (`f78cafd`)

## [0.4.0] - 2026-09-14

### 🚀 Features

- **ci:** add targeted documentation consistency check (#47) (#47) (`
d5f6be`)

### 🐛 Bug Fixes

- **release:** guard against republishing existing releases (#48) (#48) (`
3b15a0`)

### 📝 Documentation

- record PR #53 merge and pre-release state in handoff docs (#54) (#53) (`546865e`)
- focused reference pages for MCP tools, roles, guidelines, diagnostics, verification, release (#53) (#53) (`
690ba5`)
- post-#51 state sweep and plugin reference polish (#52) (#51) (`
b9fa42`)
- plugin-first documentation and Copilot marketplace entry (#51) (#51) (`
d57c70`)
- split first-time user documentation (#46) (#46) (`
0a7408`)
- establish post-MVP dogfooding baseline (#45) (#45) (`
9b8cce`)

### 🔧 Maintenance & Chores

- **ci:** migrate GitHub Actions off deprecated Node.js 20 runtime (#50) (#50) (`
d26657`)

## [0.3.3] - 2026-09-13

### 🐛 Bug Fixes

- **release:** separate verification from publication (`
e5bbd6`)

### 📝 Documentation

- plan GitHub Marketplace publication (#43) (#43) (`
7b5336`)

### 🔧 Maintenance & Chores

- Merge pull request #44 from xpepper/fix/release-publication-workflow (#44) (`d8593f3`)

## [0.3.2] - 2026-09-13

### 🧪 Tests

- **ci:** isolate verbose command environment (`
d3d51a`)

### 🔧 Maintenance & Chores

- Merge pull request #42 from xpepper/fix/release-ci-environment-test (#42) (`0adaed4`)

## [0.3.1] - 2026-09-13

### 🐛 Bug Fixes

- **release:** expand test files in CI shell (`
1acfaa`)

### 🔧 Maintenance & Chores

- Merge pull request #41 from xpepper/fix/release-test-glob (#41) (`bbbce9f`)

## [0.3.0] - 2026-09-13

### 🚀 Features

- **diagnostics:** safe verbose review diagnostics and execution telemetry (#40) (#40) (`
921e21`)
- **architecture:** add architecture summary and Mermaid diagrams (#39) (#39) (`
61e06a`)
- **threads:** PR review thread conversation replies and automated resolution (#37) (#37) (`
8bf553`)

### 📝 Documentation

- complete Increment 22 handoff and mark ALL_INCREMENTS_COMPLETE (`c9b053a`)
- complete Increment 21 handoff and set Increment 22 as active mission (`
181d0f`)
- plan verbose review diagnostics (#38) (#38) (`
fac0d7`)
- complete Increment 20 handoff and set Increment 21 as active mission (`
5d55ee`)
- add step-by-step release guide and correct manifest list in README (#36) (#36) (`
201519`)

## [0.2.0] - 2026-09-12

### 🚀 Features

- **guidelines:** repository review guidelines & project memory (.github/gem-pr-review.md) (#33) (#33) (`
f53ee4`)
- **ci:** interactive PR comment command dispatcher (/gem-review) (#31) (#32) (#31) (`
7f3af2`)
- **cli:** centralize CLI entrypoint infrastructure and eliminate sibling boilerplate duplication (#29) (#30) (#29) (`
d92295`)
- reviewer sensitivity & quality calibration (Increment 16) (#28) (#28) (`
2c1b8c`)
- automated semantic versioning, release management, and manifest synchronization (Increment 15) (#25) (#26) (#25) (`
ef8f0e`)
- pluggable custom review roles and specialist lenses (Increment 14) (#24) (#24) (`
e70b3c`)
- implement reusable GitHub Action and automated CI review workflow (action.yml) (#22) (#23) (#22) (`
9c5793`)
- implement candidate finding recovery from degraded and malformed model output (#20) (#21) (#20) (`
69f42c`)
- implement one-shot coding-task self-review (gem_self_review) (#19) (#19) (`
70303a`)
- automatic fallback model retry on quota/capacity errors (without timeouts) (#17) (#17) (`
9f2025`)
- interactive finding selection and cached publish-later (#15) (#15) (`
a0def2`)
- implement large-diff transport and file-backed paging (> 200 KB) (#13) (#13) (`
6415ee`)
- allow per-lens model and reasoning-effort overrides (#11) (#12) (#11) (`
f11b10`)
- rename plugin and skill to gem-pr-review (#10) (#10) (`
6e9aa7`)
- **verify:** implement detached worktree test verification (pr_review_verify) (#7) (#7) (`
fbd9c6`)
- **prior:** implement incremental re-reviews and prior finding revalidation (#6) (#6) (`
385bb7`)
- **subagents:** implement parallel multi-lens execution and MCP server (#5) (#5) (`
6ccb53`)
- **reviewer:** implement minimum viable reviewer orchestrator and dogfood runner (#4) (#4) (`
277ed9`)
- **publish:** implement host-gated review publishing with diff anchoring (#3) (#3) (`
82e7df`)
- **diff:** implement unified diff parser and hunk anchoring (#2) (#2) (`
c7c962`)
- **config:** implement model tier and settings resolution (#1) (#1) (`
3227b6`)

### 🐛 Bug Fixes

- **publish:** normalize double-escaped newlines and add safe publishing workflow to skill (`
7bca14`)

### 📝 Documentation

- complete Increment 19 handoff and set Increment 20 as active mission (`45048f5`)
- clarify review entry points (#35) (#35) (`
767a92`)
- clarify review entry points (`
cddcfb`)
- record Increment 18 delivery and set up Increment 19 roadmap in TODO, HANDOFF, and docs (`
f4fca6`)
- track Increment 18 (Issue #31) mission and strategic roadmap in HANDOFF.md, TODO.md, and roadmap.md (#31) (`
165c41`)
- record Increment 17 and PR #30 completion in HANDOFF.md, TODO.md, and roadmap.md (#30) (`
abc9e6`)
- track Increment 17 (Issue #29) mission and prompt in HANDOFF.md and TODO.md (#29) (`
878744`)
- simplify prompt for next agent to trust HANDOFF.md, TODO.md, and Issue #27 (#27) (`
0f95f7`)
- calibrate Increment 16 prompt with language-agnostic code review framework (`
9f1524`)
- track Increment 16 (Issue #27) mission and prompt in HANDOFF.md and TODO.md (#27) (`
95a5f5`)
- define Increment 15 semantic versioning mission and prompt (Issue #25) (#25) (`
11b008`)
- add Increment 14 pluggable custom review roles to roadmap and handoff (`
7c62d1`)
- track Increment 13 mission (Issue #22) and prompt in HANDOFF.md and TODO.md (#22) (`
af9aad`)
- record Increment 12 completion and roadmap status in HANDOFF.md (`
def046`)
- record PR #19 merge and define Issue #20 handoff mission (#19) (`
c067c1`)
- record PR #17 merge and define Issue #18 handoff mission (#17) (`
80b74d`)
- record PR #15 merge and define Increment 10 handoff mission (#15) (`
c1f6f2`)
- record PR #13 merge and define Issue #14 handoff mission (#13) (`
f6a029`)
- record PR #12 merge and prepare Increment 8 mission in HANDOFF and TODO (#12) (`
a9b9e6`)
- prepare handoff prompt and roadmap for Issue #11 per-lens overrides (#11) (`
338097`)
- record formatting fix and Phase 7 roadmap additions in HANDOFF (`
822e0c`)
- record PR #10 in HANDOFF (#10) (`
eeb4d7`)
- record PR #9 in HANDOFF (#9) (`
20113e`)
- add copilot plugin install instructions and collision guidance (#9) (#9) (`
fc9b71`)
- record PR #8 in HANDOFF (#8) (`
f9c38f`)
- add quick start and comprehensive usage guide to README (#8) (#8) (`
853712`)
- record full roadmap completion and ALL_INCREMENTS_COMPLETE in HANDOFF (`
e74556`)
- finalize HANDOFF.md with PR #3 merge and Increment 4 dogfooding guidance (#3) (`
d35062`)
- update HANDOFF.md with PR #2 merge and Increment 4 dogfooding note (#2) (`
6392f3`)
- update HANDOFF.md with PR #1 merge and Increment 2 starting state (#1) (`
235d78`)
- add architecture roadmap, AGENTS.md guidelines, and handoff instructions (`
0abb32`)
- mark phase 1 setup completed in TODO.md (`
025cb5`)

### 🔧 Maintenance & Chores

- Merge pull request #34 from xpepper/revert/accidental-readme-main (#34) (`
c2d6d6`)
- Revert "docs: clarify review entry points" (`
583f14`)
- **scripts:** add autonomous dev-loop driver for incremental development (`
238381`)
- initialize agent plugin scaffolding and manifest test (`
1ef6d9`)
