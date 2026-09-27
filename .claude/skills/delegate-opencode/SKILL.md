---
name: delegate-opencode
description: Hand bounded coding/research/scraping work to free OpenCode subagents (Space Bunny etc.) instead of doing it all yourself. Use whenever a task has parallelizable or mechanical parts — multi-file edits to a clear spec, writing a script, per-item lookups/scraping, running tests and summarizing, first drafts — so Claude usage is spent on planning and review, not grunt work.
---

# Delegating to free OpenCode subagents

Lukas pays for Claude usage; OpenCode Zen's free models cost nothing. **You are the
orchestrator**: split the work, write precise task specs, launch cheap workers, then
verify their output yourself. Default to delegating anything bounded and checkable.

## What to delegate vs keep

Delegate: mechanical edits across files to a spec, new scripts/components from a clear
spec, per-item research or scraping, test/lint runs + summaries, codebase lookups,
boilerplate, first drafts you will review.

Keep for yourself: architecture and API design, DB schema/migrations (`db:push`),
anything that sends email/SMS or writes to the production DB, final review, commits,
pushes and deploys.

## How to launch

**Model:** default `opencode/big-pickle`. Benchmarked 2026-09-27 (3 runs each: a
spec'd multi-file edit with a planted bug + rules to follow, and a 12-item batch job):
every free model scored 100% on well-specified work, so pick on speed, reliability and
how long it stays free, not "smarts" — you do the reasoning, the worker executes.

| Model | Avg time | Notes |
|---|---|---|
| `opencode/big-pickle` | ~37s | **Default.** Consistent; free since Oct 2025 (believed GLM-4.6), so least likely to vanish. 200K context. May log prompts. |
| `opencode/ling-3.0-flash-fin-free` | ~29s | Fastest and consistent. Use when speed matters. 262K context. |
| `opencode/space-bunny-free` | ~42s | Strong, 1M context, multimodal (screenshots), zero data retention. **Free-week promo from 2026-09-23** — expect it to disappear. |
| `opencode/mimo-v2.6-flash-free` | ~50s | Fine but variable. |
| `opencode/longcat-2.5-preview-free` / `nemotron-3-ultra-free` | ~65s | Slower; 1M context for huge inputs. |
| `opencode/nemotron-3.5-lightning-free` | 44s–6 min | Stalls for minutes on some runs. Avoid. |
| `opencode/muse-spark-1.3-contributor-free` | ~20s | Once tried to read `/`, got blocked and quit with nothing done. Avoid. |

Use Space Bunny when the worker needs to look at images or hold a huge context, and
avoid sending contact data (names/emails/phones) to Big Pickle when a zero-retention
model will do. Re-check `opencode models` now and then — the free lineup rotates.

**A. Paseo available** (tools named `mcp__paseo__*` exist — Lukas's machine / Paseo app):
`mcp__paseo__create_agent` with
`provider: "opencode/opencode/big-pickle"`,
`settings: { modeId: "build", thinkingOptionId: "medium", features: { auto_accept: true } }`.
You get a notification when it finishes — don't poll.

**B. No Paseo** (Claude Code cloud/web, plain terminal): the CLI works anywhere and
installs OpenCode on first use, no login needed:
```bash
scripts/delegate.sh "task prompt"                          # blocking, prints the reply
scripts/delegate.sh -d ../wt-feature-x "task prompt" > /tmp/w1.log 2>&1 &   # parallel
```
Run parallel workers as background Bash commands and read their logs when they exit.

## Writing the task (weak models need this)

- One worker = one clearly bounded scope. **Give parallel workers disjoint files**, or
  a separate git worktree each (`git worktree add ../wt-<name> -b <branch>`); you merge.
- Say exactly which files to touch, what "done" means, and how to check it
  (`npm run lint`, `npx tsc --noEmit`, a script to run).
- Put shared rules in a file the workers read (e.g. `WORKER.md`) instead of repeating
  them, and put everything in the initial prompt. **Don't message a running OpenCode
  agent**: the message is received, but it cuts the current turn short and the worker
  stops partway (tested 2026-09-27: applied the new instruction, then quit after 1 of 9
  files). Wait for it to finish, then send the follow-up; the session keeps working.
- Free models often end a turn early ("Continuing with the next file." and stop). For
  multi-item work, list the items explicitly, have them write results to a file as they
  go, and re-prompt "continue" until the file is complete.
- Have workers write results to files incrementally, not only in the final reply.
- Always state the hard limits: no commits/pushes, no DB writes, no emails/SMS, and **no
  LeadFinder MCP tools** (the local OpenCode config has the LeadFinder MCP, which includes
  send-email tools).

## Verify everything

Cheap models are fast but sloppy. Review diffs yourself, run lint/typecheck/tests, and
re-check any data they return with a deterministic script (see `scripts/lux/verify.mjs`
for the pattern). Prefer turning a repeated worker task into a script once you see the
pattern — scripts out-produced the LLM swarm several-fold in past runs.

## Limits learned the hard way

- If every Paseo OpenCode agent comes back empty (no reply, 0 tokens, OpenCode logs
  `MessageAbortedError` ~0.1s in; `~/.paseo/daemon.log` shows "OpenCode event stream
  ... first-record watchdog expired"), the Paseo daemon is wedged — typically after an
  OpenCode crash. Restart it yourself with `paseo daemon restart` (Lukas has
  pre-approved this). It will likely end your own Paseo session, so save your state
  and tell him first; use `scripts/delegate.sh` if you can't restart.

- Locally, all OpenCode sessions share one `opencode serve` process; ~25 concurrent
  sessions ran this 4-core/7.8 GB box out of memory and killed every worker. Stay at
  **≤ 8–10 concurrent**; archive finished Paseo agents.
- Many workers share one IP: search engines (DuckDuckGo, Brave, Bing, Exa's free tier)
  rate-limit within minutes. Pre-run searches centrally and cache them.
- Two workers given overlapping scope will duplicate the same hard work (e.g. both
  reverse-engineering one site) — split by distinct target up front.
