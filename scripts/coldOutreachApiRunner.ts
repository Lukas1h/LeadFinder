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

async function main() {
  const { candidates }: { candidates: Candidate[] } = await import(candidatesModule);

  const delaySecondsEnv = process.env.DELAY_SECONDS;
  const totalMinutesEnv = process.env.TOTAL_MINUTES;
  const DELAY_MS = delaySecondsEnv
    ? Math.round(parseFloat(delaySecondsEnv) * 1000)
    : Math.floor((parseFloat(totalMinutesEnv || "105") * 60_000) / candidates.length);

  const startedAt = Date.now();
  let sent = 0,
    skipped = 0,
    failed = 0;
  const failedNames: string[] = [];

  console.log(
    `${candidatesModule}: ${candidates.length} candidates, ${(DELAY_MS / 1000).toFixed(1)}s between calls, target ~${((DELAY_MS * candidates.length) / 60000).toFixed(0)}min total`
  );

  for (const r of candidates) {
    const name = r.name.trim();
    const email = r.email.trim().toLowerCase();
    const phone = r.phone || null;

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
      console.log(`SENT ${name} <${email}> (${sent} sent, ${skipped} skipped, ${failed} failed)`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } else if (result.status === "skipped") {
      // Already contacted (e.g. resuming after an interrupted run) — no
      // pacing delay needed, nothing was actually sent.
      skipped++;
      console.log(`SKIP ${name} — ${result.reason ?? "already contacted"}`);
    } else {
      failed++;
      failedNames.push(`${name} <${email}>`);
      console.log(`FAILED ${name} <${email}> — ${result.error ?? "unknown error"}`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`DONE. Sent ${sent}, skipped ${skipped}, failed ${failed}, out of ${candidates.length}. Elapsed ${elapsedMin} min.`);
  if (failedNames.length) console.log(`Failed: ${failedNames.join("; ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
