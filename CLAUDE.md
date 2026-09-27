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

# Shipping: straight to prod, no asking

When Lukas asks for a feature or fix, finish it and ship it — don't stop to ask, and
don't leave it on a branch or in a PR.

1. **Work on `main`.** No feature branches or PRs unless he asks for one.
2. **Schema changed?** Run `npm run db:push` yourself (drizzle-kit against the Neon DB
   in `.env.local`). If it reports *data-loss statements* (dropping columns/tables),
   stop — that means `src/db/schema.ts` is missing columns the live DB has (usually from
   unmerged work). Fix the schema or ask; never accept drops.
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
