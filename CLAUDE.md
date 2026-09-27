@AGENTS.md

# Delegate to free OpenCode subagents by default

Claude usage costs Lukas money; OpenCode's free models (default `opencode/big-pickle`; see the skill for when to pick another)
don't. Act as the orchestrator: plan, split the work, write precise task specs, and hand
bounded, checkable pieces (multi-file edits to a spec, new scripts, per-item research or
scraping, test runs) to OpenCode workers — in parallel when the pieces are independent.
Keep architecture, DB schema changes, anything that sends messages or writes production
data, final review, and commits/deploys for yourself.

How: the `delegate-opencode` skill (`.claude/skills/delegate-opencode/SKILL.md`) — Paseo's
`create_agent` when Paseo tools are available, otherwise `scripts/delegate.sh "<task>"`,
which works in cloud containers too. Verify every worker's output before relying on it.

# NEVER contact a real estate agent without express permission

Lukas's app talks to real people: every email, SMS, or other outreach reaches a real
agent and is his reputation. Never send, schedule, or trigger one — via the app, the
LeadFinder MCP (`send_agent_email`, `send_bulk_agent_emails`, …), scripts, or a worker
— unless Lukas has explicitly asked for that specific send in this session. Before
sending, double-check the recipients, the content, and `check_contact_history` (no
repeat or cold outreach to someone he already works with), and confirm with him. A
general "ship it" or "go ahead" on a feature is not permission to contact anyone.
Delegated workers must never have this ability (see the delegate-opencode skill).

# Shipping: straight to prod, no asking

When Lukas asks for a feature or fix, finish it and ship it — don't stop to ask, and
don't leave it on a branch or in a PR.

1. **Work on `main`.** No feature branches or PRs unless he asks for one.
2. **Schema changed?** Run `npm run db:push` yourself (drizzle-kit against the Neon DB
   in `.env.local`) — that's pre-approved. Be smart about what it wants to do: if it
   reports *data-loss statements* (dropping columns/tables), don't accept them blind.
   Usually `src/db/schema.ts` is just missing columns the live DB has (from work merged
   elsewhere or not yet merged) — find where they came from (`git log --all -S`) and add
   them back to the schema so the push becomes a no-op for them. Only drop real data if
   it's clearly meant to go.
3. **Build-check before pushing:** `npx next build`. Vercel runs `next build`, which
   type-checks `scripts/` too, so a committed file that imports an uncommitted one
   fails in prod while passing locally (this broke a deploy once — `scripts/lib/csv.mjs`).
   Locally the working tree has lots of untracked scripts, so check from a clean tree:
   `git worktree add --detach /tmp/lf-build HEAD`, copy `.env.local` in, `npm ci`,
   `npx next build`, then `git worktree remove --force /tmp/lf-build`. (Turbopack
   rejects a symlinked `node_modules`, so a real install is needed.)
4. **Commit only the files you changed** — the tree often has unrelated uncommitted
   work of Lukas's. Never `git add -A`. No git identity is configured on his machine;
   commit with `git -c user.name="Lukas Hahn" -c user.email="lukas1h07@gmail.com" commit`.
5. **`git push origin main`.** That is the deploy: Vercel (project `lead-finder`,
   ids in `.vercel/project.json`) auto-deploys production from `main`. Don't run
   `vercel deploy` or `vercel --prod`. If the push is rejected as non-fast-forward,
   `git fetch` and rebase onto `origin/main` (stash his uncommitted work first); never
   force-push.
6. **Verify the deploy went Ready:** `vercel ls lead-finder` a minute or two after
   pushing; `vercel inspect --logs <deployment-url>` shows why one failed. Fix and
   re-push until it's Ready. Production is https://gallery.lukashahn.art (pages 307 to
   a login, so you can't check the UI with curl).

## Tools

- `gh` and `vercel` are installed and logged in on Lukas's machine, reachable via
  `~/.opencode/bin` (symlinks) since agent shells don't read `~/.bashrc`. Git pushes
  over HTTPS authenticate through `gh` (global credential helper).
- In Claude Code cloud sessions, `.claude/hooks/session-start.sh` runs `npm install`
  and `vercel env pull .env.local`.
- The Next.js here is 16 with Turbopack and Cache Components — see `AGENTS.md`.
