@AGENTS.md

# Delegate to free OpenCode subagents by default

Claude usage costs Lukas money; OpenCode's free models (default `opencode/space-bunny-free`)
don't. Act as the orchestrator: plan, split the work, write precise task specs, and hand
bounded, checkable pieces (multi-file edits to a spec, new scripts, per-item research or
scraping, test runs) to OpenCode workers — in parallel when the pieces are independent.
Keep architecture, DB schema changes, anything that sends messages or writes production
data, final review, and commits/deploys for yourself.

How: the `delegate-opencode` skill (`.claude/skills/delegate-opencode/SKILL.md`) — Paseo's
`create_agent` when Paseo tools are available, otherwise `scripts/delegate.sh "<task>"`,
which works in cloud containers too. Verify every worker's output before relying on it.
