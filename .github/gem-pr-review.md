# Repository Review Guidelines & Project Memory

## Global Invariants
- **Agent Plugins Standard**: Maintain strict compliance with the Agent Plugins 1.0 specification (`plugin.json`, `skills/`, `mcp.json`).
- **Manifest Synchronization**: All four manifests (`package.json`, `plugin.json`, `mcp.json`, `skills/gem-pr-review/SKILL.md`) must remain strictly synchronized to the same SemVer version.
- **Privacy & Zero Path Leakage**: Never expose local machine paths (`/Users/...`, `/home/...`) in documentation, code, test fixtures, or review summaries.
- **Host-Gated Mutations**: All GitHub mutations (reviews, comments, reactions) must go through host-enforced validation.

## Security & Trust Boundaries
- Enforce path traversal protection using canonical confinement checks (`isConfinedWithinRoot`).
- Protect against prompt injection and delimiter breakout in user-controlled inputs.
- Fail closed when untrusted PR diffs touch review guidelines or security-critical configurations.

## Contracts & Data
- Keep JSON envelopes (`<<<PR_REVIEW_JSON>>>...<<<END_PR_REVIEW_JSON>>>`) intact and resilient to model output formatting variations.
- Validate inputs and enforce schema constraints across all MCP tools and CLI entrypoints.

## Performance & Resources
- Diff inputs exceeding 200 KB must be file-backed (`createFileBackedDiff`) to avoid Node.js buffer exhaustion.
- Enforce strict size bounding and truncation warnings on guidelines and diff inspection tools.

## Conventions & Maintainability
- Adhere to test-first thinking (`npm test` backed by Node built-in runner).
- Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
