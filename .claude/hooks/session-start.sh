#!/bin/bash
set -euo pipefail

# Only relevant for Claude Code on the web — each session gets a fresh
# container, so .env.local and .vercel/ (both gitignored, see .gitignore)
# need to be regenerated every time. Locally these already exist.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install

# .vercel/project.json is committed (carved out of the .gitignore .vercel
# rule) so this already knows which project/org to pull from without an
# interactive `vercel link` step — it just needs the CLI to be
# authenticated, which this environment provides.
npx vercel env pull .env.local --yes

# OpenCode CLI for free subagents (see .claude/skills/delegate-opencode). The
# free opencode/*-free models need no login. Best-effort: a failed install
# shouldn't block the session — scripts/delegate.sh retries it on first use.
if ! command -v opencode >/dev/null 2>&1 && [ ! -x "$HOME/.opencode/bin/opencode" ]; then
  curl -fsSL https://opencode.ai/install | bash >/dev/null 2>&1 || true
fi
