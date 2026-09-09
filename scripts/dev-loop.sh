#!/usr/bin/env bash
set -euo pipefail

# scripts/dev-loop.sh — Autonomous incremental development driver
# Usage:
#   ./scripts/dev-loop.sh [max_iterations]
#
# Examples:
#   ./scripts/dev-loop.sh       # Runs 1 increment session
#   ./scripts/dev-loop.sh 3     # Runs up to 3 increments in sequence

MAX_ITERATIONS=${1:-1}
ITERATION=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "========================================================"
echo "🚀 PR Review Gemini Autonomous Development Loop"
echo "   Target iterations: $MAX_ITERATIONS"
echo "   Working directory: $REPO_ROOT"
echo "========================================================"

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  ITERATION=$((ITERATION + 1))
  echo ""
  echo "────────────────────────────────────────────────────────"
  echo "▶ [Iteration $ITERATION / $MAX_ITERATIONS] Starting increment..."
  echo "────────────────────────────────────────────────────────"

  # 1. Completion Sentinel Check
  if grep -q "ALL_INCREMENTS_COMPLETE" HANDOFF.md 2>/dev/null; then
    echo "🎉 Found ALL_INCREMENTS_COMPLETE in HANDOFF.md!"
    echo "   All planned increments have been finished. Exiting loop."
    exit 0
  fi

  # 2. Pre-flight Safeguard Verification
  echo "🔍 [Pre-flight] Verifying clean main and baseline tests..."
  git checkout main
  git pull --rebase origin main
  npm test

  # 3. Formulate Prompt for the Next Increment
  PROMPT=$(cat << 'EOF'
Please continue the development of this repository by picking up the next task documented in HANDOFF.md.

Before writing any code, review AGENTS.md, HANDOFF.md, TODO.md, and docs/roadmap.md, confirm the repository is clean on main, and run npm test to ensure baseline tests pass.

Deliver the next increment following test-first development, verify with npm test, commit using conventional commits, push to a feature branch, open a PR against main using gh pr create, (if dogfood reviewer is available, review the PR with it), merge the PR into main, and update HANDOFF.md and TODO.md for the following increment.

When all increments in docs/roadmap.md are completed and verified, mark ALL_INCREMENTS_COMPLETE in HANDOFF.md.
EOF
)

  # 4. Dispatch Fresh agy Session with increased timeout
  echo "🤖 [Agent Execution] Launching fresh agy session (timeout: 20m)..."
  if ! agy -p "$PROMPT" --print-timeout 20m0s --dangerously-skip-permissions; then
    echo "❌ agy exited with a non-zero exit code during iteration $ITERATION."
    echo "   Pausing loop for human inspection. Check git status and logs."
    exit 1
  fi

  # Check for uncommitted working tree changes
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "⚠️  Working tree has uncommitted changes after agent turn."
    echo "   Pausing loop for human inspection before rebasing."
    git status --short
    exit 1
  fi

  # 5. Post-run Verification on main
  echo "🔍 [Post-flight] Verifying main branch synchronization and test suite..."
  git checkout main
  git pull --rebase origin main
  npm test

  echo "✅ [Iteration $ITERATION / $MAX_ITERATIONS] Completed successfully."
done

echo ""
echo "========================================================"
echo "🏁 Reached max iterations limit ($MAX_ITERATIONS)."
echo "   Inspect HANDOFF.md and git log for progress."
echo "========================================================"
