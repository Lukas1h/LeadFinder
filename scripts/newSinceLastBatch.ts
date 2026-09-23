import { db } from "../src/db";
import { agents, messagePresets, messagePresetVariants, messageSends } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "../src/lib/mailer";
import { renderSubject, renderMessageBody } from "../src/lib/messageTemplate";
import { candidates } from "./newSinceLastAgents";

const DELAY_MS = 45_000;

async function main() {
  const startedAt = Date.now();
  const [preset] = await db
    .select()
    .from(messagePresets)
    .where(
      and(
        eq(messagePresets.channel, "email"),
        eq(messagePresets.type, "initial_outreach"),
        eq(messagePresets.name, "Cold Outreach")
      )
    );
  if (!preset) throw new Error('"Cold Outreach" email preset not found');
  const [variant] = await db.select().from(messagePresetVariants).where(eq(messagePresetVariants.presetId, preset.id));
  if (!variant) throw new Error("No variant found for Cold Outreach preset");

  let sent = 0,
    skipped = 0,
    failed = 0;
  const failedNames: string[] = [];

  for (const r of candidates) {
    const email = r.email.trim().toLowerCase();
    const name = r.name.trim();
    const phone = r.phone || null;

    const [existing] = await db.select().from(agents).where(eq(agents.email, email));
    if (existing?.lastContactedAt) {
      console.log(`SKIP ${name} — already contacted`);
      skipped++;
      continue;
    }

    const subject = renderSubject(variant.subject ?? "", name);
    const body = renderMessageBody(variant.body, name, null);

    try {
      await sendEmail({ to: email, toName: name, subject, text: body, attachments: preset.attachments });
    } catch (err) {
      console.log(`FAILED ${name} <${email}> — ${err}`);
      failed++;
      failedNames.push(`${name} <${email}>`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
      continue;
    }

    const now = new Date();
    let agentId: string;
    try {
      if (existing) {
        await db
          .update(agents)
          .set({ name, lastContactedAt: now, phone: existing.phone ?? phone })
          .where(eq(agents.id, existing.id));
        agentId = existing.id;
      } else {
        const [inserted] = await db.insert(agents).values({ email, name, phone, lastContactedAt: now }).returning({ id: agents.id });
        agentId = inserted.id;
      }
    } catch (err) {
      console.log(`WARN ${name} <${email}> — agent upsert failed (likely phone collision), retrying without phone — ${err}`);
      if (existing) {
        await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, existing.id));
        agentId = existing.id;
      } else {
        const [inserted] = await db.insert(agents).values({ email, name, phone: null, lastContactedAt: now }).returning({ id: agents.id });
        agentId = inserted.id;
      }
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
    sent++;
    console.log(`SENT ${name} <${email}> (${sent} sent, ${skipped} skipped, ${failed} failed)`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`DONE. Sent ${sent}, skipped ${skipped}, failed ${failed}, out of ${candidates.length}. Elapsed ${elapsedMin} min.`);
  if (failedNames.length) console.log(`Failed: ${failedNames.join("; ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
