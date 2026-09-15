// Sends the "Cold Outreach" email preset to scraped PPG agents, mirroring
// sendComposeEmail in src/app/composeEmailActions.ts exactly: send first,
// only touch the DB (agents + messageSends) if the send actually succeeded.
//
// Usage:
//   npx tsx scripts/send-ppg-outreach.ts --csv path/to/scrape.csv --limit 10
//   npx tsx scripts/send-ppg-outreach.ts --csv path/to/scrape.csv
//
// Reads the scraper's CSV output, filters to rows whose photographyPriority
// starts with "HIGH" (currently has an active or pending listing — the
// "live realtors" filter), renders the live "Cold Outreach" preset/variant
// per recipient, and sends with a delay between each.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db";
import { agents, messagePresets, messagePresetVariants, messageSends, type Agent } from "../src/db/schema";
import { renderSubject, renderMessageBody } from "../src/lib/messageTemplate";
import { sendEmail } from "../src/lib/mailer";

const DELAY_MS = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScrapedRow {
  name: string;
  office: string;
  email: string;
  phone: string;
  photographyPriority: string;
  profileUrl: string;
}

async function main() {
  const args = process.argv.slice(2);
  const csvArg = args.indexOf("--csv");
  const limitArg = args.indexOf("--limit");
  const dryRunArg = args.includes("--dry-run");
  if (csvArg === -1) throw new Error("Usage: --csv <path> [--limit N] [--dry-run]");
  const csvPath = args[csvArg + 1];
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : undefined;

  const rows: ScrapedRow[] = parse(readFileSync(csvPath, "utf-8"), { columns: true });
  const live = rows.filter((r) => r.photographyPriority.startsWith("HIGH") && r.email);
  const targets = limit ? live.slice(0, limit) : live;

  console.log(`${rows.length} total rows, ${live.length} "live" (currently listing) with an email, sending to ${targets.length}.`);

  const [preset] = await db
    .select()
    .from(messagePresets)
    .where(and(eq(messagePresets.channel, "email"), eq(messagePresets.type, "initial_outreach"), eq(messagePresets.name, "Cold Outreach")));
  if (!preset) throw new Error('No preset found: channel=email, type=initial_outreach, name="Cold Outreach"');

  const [variant] = await db
    .select()
    .from(messagePresetVariants)
    .where(and(eq(messagePresetVariants.presetId, preset.id), eq(messagePresetVariants.enabled, true)));
  if (!variant) throw new Error(`No enabled variant found for preset ${preset.id}`);

  console.log(`Using preset "${preset.name}" (${preset.id}), variant "${variant.label}" (${variant.id}), ${preset.attachments.length} attachment(s).`);

  if (dryRunArg) {
    const sample = targets[0];
    if (sample) {
      console.log("\n--- Sample render (first recipient, nothing sent) ---");
      console.log("To:", sample.email, `(${sample.name})`);
      console.log("Subject:", renderSubject(variant.subject ?? "", sample.name));
      console.log("Body:\n" + renderMessageBody(variant.body, sample.name, null));
      console.log("--- end sample ---\n");
    }
    return;
  }

  const results: { name: string; email: string; status: string }[] = [];

  for (const [i, row] of targets.entries()) {
    const email = row.email.trim().toLowerCase();
    const name = row.name.trim();
    // Skip agents this preset has already emailed — lets this script be
    // re-run against a later, more-complete CSV (e.g. once the scrape
    // finishes) without double-emailing anyone from an earlier partial run.
    const [existingAgent]: Agent[] = await db.select().from(agents).where(eq(agents.email, email));
    if (existingAgent) {
      const [alreadySent] = await db
        .select({ id: messageSends.id })
        .from(messageSends)
        .where(and(eq(messageSends.agentId, existingAgent.id), eq(messageSends.presetId, preset.id)));
      if (alreadySent) {
        console.log(`  [${i + 1}/${targets.length}] skip (already sent) ${name} <${email}>`);
        results.push({ name, email, status: "already_sent" });
        continue;
      }
    }

    const subject = renderSubject(variant.subject ?? "", name);
    const body = renderMessageBody(variant.body, name, null);

    try {
      await sendEmail({ to: email, toName: name, subject, text: body, attachments: preset.attachments });
    } catch (err) {
      console.error(`  [${i + 1}/${targets.length}] SEND FAILED ${name} <${email}>:`, err);
      results.push({ name, email, status: "send_failed" });
      await sleep(DELAY_MS);
      continue;
    }

    const now = new Date();
    const [exactMatch] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email));

    let agentId: string;
    if (exactMatch) {
      await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, exactMatch.id));
      agentId = exactMatch.id;
    } else {
      const [inserted] = await db.insert(agents).values({ email, name, lastContactedAt: now }).returning({ id: agents.id });
      agentId = inserted.id;
    }

    await db.insert(messageSends).values({
      listingId: null,
      agentId,
      presetId: preset.id,
      variantId: variant.id,
      type: "initial_outreach",
      channel: "email",
      sentAt: now,
    });

    console.log(`  [${i + 1}/${targets.length}] sent to ${name} <${email}>`);
    results.push({ name, email, status: "sent" });

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  console.log(`\nDone: ${sentCount}/${targets.length} sent successfully.`);

  const logPath = csvPath.replace(/\.csv$/, "") + "-send-log.csv";
  writeFileSync(logPath, ["name,email,status", ...results.map((r) => `"${r.name}","${r.email}","${r.status}"`)].join("\n"));
  console.log(`Send log written to ${logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
