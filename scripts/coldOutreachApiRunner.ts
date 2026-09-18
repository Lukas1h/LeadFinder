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
import fs from "fs";

interface Candidate {
  name: string;
  email: string;
  phone: string | null;
}

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
    const count = await trailing24hSendCount();
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

async function main() {
  const { candidates: orderedCandidates }: { candidates: Candidate[] } = await import(candidatesModule);
  // Spreadsheet order is alphabetical by name — shuffle so a run doesn't
  // read as an A-to-Z sweep to anyone comparing notes with a coworker.
  const candidates = shuffle(orderedCandidates);

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
