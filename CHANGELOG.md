# Changelog

All notable changes to this project will be documented in this file.

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
