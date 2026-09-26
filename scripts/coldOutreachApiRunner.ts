// Drives the deployed /api/compose/cold-outreach endpoint from outside the
// app — for running a batch from an environment with no direct SMTP/IMAP
// network access of its own (only HTTPS), unlike coldOutreachBatch.ts which
// calls sendEmail()/the DB directly and needs to run somewhere with real
// outbound network access.
//
// Usage:
//   COMPOSE_API_URL=https://... COMPOSE_API_SECRET=... \
//   CANDIDATES_MODULE=./windermereCandidates \
//   DELAY_SECONDS=30 \
//   npx tsx scripts/coldOutreachApiRunner.ts
//
// CANDIDATES_MODULE defaults to ./coldOutreachCandidates. Pacing: set
// DELAY_SECONDS directly, or TOTAL_MINUTES to spread the whole list over a
// target wall-clock duration instead; DELAY_SECONDS wins if both are set.
//
// FLAGGED_FILE (optional): path to a flagCandidates.ts report — every email
// in its flaggedEmails list is skipped entirely (not sent to the API at
// all, not even a skip-delay) so a suspected duplicate person never gets
// emailed while still awaiting manual verification.
//
// DAILY_LIMIT / DAILY_LIMIT_BUFFER (optional, requires DATABASE_URL): before
// each send, checks the actual trailing-24h message_sends count in the DB
// (not just this run's own count — other runs/manual sends count too) and
// blocks until (count + buffer) is back under DAILY_LIMIT, polling every
// RATE_CHECK_INTERVAL_SECONDS (default 60). This can pause for hours if the
// provider's rolling daily cap is already near full — that's the point.
// WARM_GUARD (default on): before the first send, the whole candidate list is
// re-screened against every agent we already have a relationship with —
// non-cold status, declined, contacted, booked, or interacted (6,949 rows as
// of Sep 2026). The screen is the same one scripts/warmGuard.ts applies when a
// CSV is cleaned: a shared email or phone blocks, a confident name match
// (including nickname forms, so "Jim Letsinger" is caught against a known
// "James Letsinger") blocks, and a merely-possible match holds.
//
// This is deliberately a gate here and not just a documented step. A list can
// reach this runner by a dozen routes — a stale candidates module, a hand
// edit, an export nobody ran through cleanExport — and a stale list is exactly
// how a warm agent gets cold-emailed. Re-screening costs a minute at startup
// against an hours-long run. Set SKIP_WARM_GUARD=1 to bypass, which then logs
// a loud warning; the only reason that exists is a DB outage.
//
// Set WARM_GUARD_BLOCK=review to also refuse to start when candidates merely
// need review (the default is to hold those rows out of the run but continue
// with the rest).
import fs from "fs";
import type { Candidate } from "./lib/warmGuardScreen";

const apiUrl = process.env.COMPOSE_API_URL;
const apiSecret = process.env.COMPOSE_API_SECRET;
if (!apiUrl || !apiSecret) {
  console.error("COMPOSE_API_URL and COMPOSE_API_SECRET must be set");
  process.exit(1);
}
const endpoint = `${apiUrl.replace(/\/$/, "")}/api/compose/cold-outreach`;

const candidatesModule = process.env.CANDIDATES_MODULE || "./coldOutreachCandidates";

const dailyLimit = process.env.DAILY_LIMIT ? parseInt(process.env.DAILY_LIMIT, 10) : null;
const dailyLimitBuffer = process.env.DAILY_LIMIT_BUFFER ? parseInt(process.env.DAILY_LIMIT_BUFFER, 10) : 0;
const rateCheckIntervalMs = (process.env.RATE_CHECK_INTERVAL_SECONDS ? parseFloat(process.env.RATE_CHECK_INTERVAL_SECONDS) : 10) * 1000;

async function trailing24hSendCount(): Promise<number> {
  const { db } = await import("../src/db");
  const { messageSends } = await import("../src/db/schema");
  const { gte } = await import("drizzle-orm");
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select({ id: messageSends.id }).from(messageSends).where(gte(messageSends.sentAt, since24h));
  return rows.length;
}

// Blocks (polling trailing24hSendCount) until sending one more email would
// keep the trailing 24h count at or under (dailyLimit - dailyLimitBuffer).
async function waitForDailyLimitHeadroom(): Promise<void> {
  if (dailyLimit === null) return;
  const safeMax = dailyLimit - dailyLimitBuffer;
  let loggedWaiting = false;
  for (;;) {
    let count: number;
    try {
      count = await trailing24hSendCount();
    } catch (err) {
      // Transient DB blips (e.g. a Neon DNS hiccup) shouldn't kill an
      // hours-long batch — log and retry on the next poll instead.
      console.log(`WARN — trailing24hSendCount failed, will retry: ${err}`);
      await new Promise((r) => setTimeout(r, rateCheckIntervalMs));
      continue;
    }
    if (count < safeMax) {
      if (loggedWaiting) console.log(`Headroom freed up (${count}/${safeMax} used) — resuming`);
      return;
    }
    if (!loggedWaiting) {
      console.log(`WAITING — trailing 24h sends at ${count}, safe max is ${safeMax} (limit ${dailyLimit} - buffer ${dailyLimitBuffer}). Polling every ${rateCheckIntervalMs / 1000}s until headroom opens up.`);
      loggedWaiting = true;
    }
    await new Promise((r) => setTimeout(r, rateCheckIntervalMs));
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Re-screen the candidate list against every protected agent and drop the ones
 * that match. Aborts the whole run on a single `block` — a warm agent in the
 * list is a stop-the-line event, not something to send 900 emails around.
 */
async function applyWarmGuard(candidates: Candidate[]): Promise<Candidate[]> {
  if (process.env.SKIP_WARM_GUARD === "1") {
    console.log("*** SKIP_WARM_GUARD=1 — NOT screening against known agents. Do not do this by accident. ***");
    return candidates;
  }
  console.log("Screening candidates against known agents (warm-guard)...");
  const { loadProtected, prepareAll, screenCandidate } = await import("./lib/warmGuardScreen");
  const protectedAgents = await loadProtected();
  const prepared = prepareAll(protectedAgents);
  console.log(`  ${protectedAgents.length} protected agents loaded`);

  const blocks: string[] = [];
  const reviews: string[] = [];
  const kept: Candidate[] = [];
  for (const c of candidates) {
    const h = screenCandidate(c, prepared);
    if (!h) { kept.push(c); continue; }
    const line = `${c.name} <${c.email}> — ${h.why}`;
    if (h.verdict === "block") blocks.push(line);
    else reviews.push(line);
  }

  for (const r of reviews) console.log(`  HOLD  ${r}`);
  if (blocks.length) {
    console.error(`\nABORT — ${blocks.length} candidate(s) match an agent we already have a relationship with:`);
    for (const b of blocks) console.error(`  BLOCK ${b}`);
    console.error("\nRemove them from the candidates module (warmGuard.ts --out writes a clean list) and re-run.");
    process.exit(1);
  }
  if (process.env.WARM_GUARD_BLOCK === "review" && reviews.length) {
    console.error(`\nABORT — ${reviews.length} candidate(s) need review and WARM_GUARD_BLOCK=review.`);
    process.exit(1);
  }
  console.log(`  guard clean: ${kept.length} to send, ${reviews.length} held for review, 0 blocks`);
  return kept;
}

async function main() {
  const { candidates: orderedCandidates }: { candidates: Candidate[] } = await import(candidatesModule);
  // Spreadsheet order is alphabetical by name — shuffle so a run doesn't
  // read as an A-to-Z sweep to anyone comparing notes with a coworker.
  const guardCleaned = await applyWarmGuard(orderedCandidates);
  const candidates = shuffle(guardCleaned);

  let flaggedEmails = new Set<string>();
  if (process.env.FLAGGED_FILE) {
    const report = JSON.parse(fs.readFileSync(process.env.FLAGGED_FILE, "utf8"));
    flaggedEmails = new Set<string>(report.flaggedEmails.map((e: string) => e.toLowerCase()));
    console.log(`Loaded ${flaggedEmails.size} flagged emails from ${process.env.FLAGGED_FILE} — these will be held out`);
  }

  const delaySecondsEnv = process.env.DELAY_SECONDS;
  const totalMinutesEnv = process.env.TOTAL_MINUTES;
  const DELAY_MS = delaySecondsEnv
    ? Math.round(parseFloat(delaySecondsEnv) * 1000)
    : Math.floor((parseFloat(totalMinutesEnv || "105") * 60_000) / candidates.length);

  const startedAt = Date.now();
  let sent = 0,
    skipped = 0,
    failed = 0,
    heldForVerification = 0;
  const failedNames: string[] = [];

  console.log(
    `${candidatesModule}: ${candidates.length} candidates, ${(DELAY_MS / 1000).toFixed(1)}s between calls, target ~${((DELAY_MS * candidates.length) / 60000).toFixed(0)}min total`
  );

  let processed = 0;
  for (const r of candidates) {
    processed++;
    const pct = ((processed / candidates.length) * 100).toFixed(0);
    const elapsedMs = Date.now() - startedAt;
    const etaMin = processed > 1 ? (((elapsedMs / processed) * (candidates.length - processed)) / 60000).toFixed(0) : "?";
    const progress = `[${processed}/${candidates.length} ${pct}%, ~${etaMin}min left]`;

    const name = r.name.trim();
    const email = r.email.trim().toLowerCase();
    const phone = r.phone || null;

    if (flaggedEmails.has(email)) {
      heldForVerification++;
      console.log(`${progress} HOLD ${name} <${email}> — flagged as a possible existing agent, needs manual verification`);
      continue;
    }

    await waitForDailyLimitHeadroom();

    let result: { status?: string; reason?: string; error?: string; agentId?: string } = {};
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiSecret}` },
        body: JSON.stringify({ name, email, phone }),
      });
      result = await res.json();
      if (!res.ok && result.status !== "failed") {
        result = { status: "failed", error: `HTTP ${res.status}: ${result.error ?? JSON.stringify(result)}` };
      }
    } catch (err) {
      result = { status: "failed", error: String(err) };
    }

    if (result.status === "sent") {
      sent++;
      console.log(`${progress} SENT ${name} <${email}> (${sent} sent, ${skipped} skipped, ${failed} failed)`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } else if (result.status === "skipped") {
      // Already contacted (e.g. resuming after an interrupted run) — no
      // pacing delay needed, nothing was actually sent.
      skipped++;
      console.log(`${progress} SKIP ${name} — ${result.reason ?? "already contacted"}`);
    } else {
      failed++;
      failedNames.push(`${name} <${email}>`);
      console.log(`${progress} FAILED ${name} <${email}> — ${result.error ?? "unknown error"}`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(
    `DONE. Sent ${sent}, skipped ${skipped}, failed ${failed}, held for verification ${heldForVerification}, out of ${candidates.length}. Elapsed ${elapsedMin} min.`
  );
  if (failedNames.length) console.log(`Failed: ${failedNames.join("; ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
