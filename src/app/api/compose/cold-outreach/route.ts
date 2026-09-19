import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, messagePresets, messagePresetVariants, messageSends } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { renderSubject, renderMessageBody } from "@/lib/messageTemplate";
import { getComposeEmailOptions } from "@/app/composeEmailActions";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/normalize";

// Same ceiling reasoning as /api/cron/sync-listings — SMTP send + the
// best-effort IMAP Sent-folder append can run long on a slow connection.
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return !!process.env.COMPOSE_BATCH_SECRET && authHeader === `Bearer ${process.env.COMPOSE_BATCH_SECRET}`;
}

/**
 * The Messaging page's Compose flow, exposed as an API so an external
 * script can drive it — same preset/variant recommendation logic the
 * Compose panel itself calls on load (see ComposeEmailPanel.tsx).
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const options = await getComposeEmailOptions();
  return NextResponse.json(options);
}

interface SendBody {
  name: string;
  email: string;
  phone?: string | null;
}

/**
 * Renders and sends one Cold Outreach email exactly like the Compose panel
 * would, then records it — the same behavior as
 * scripts/coldOutreachBatch.ts, but running server-side (real SMTP/IMAP
 * network access) instead of from a sandbox that can only reach this API
 * over HTTPS. Callers are expected to pace their own requests; this
 * handles one candidate per call.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim() ? normalizeEmail(body.email) : undefined;
  const name = body.name?.trim() ? normalizeName(body.name) : undefined;
  const phone = body.phone?.trim() ? normalizePhone(body.phone) : null;
  if (!email || !name) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

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
  if (!preset) return NextResponse.json({ error: '"Cold Outreach" preset not found' }, { status: 500 });

  const [variant] = await db.select().from(messagePresetVariants).where(eq(messagePresetVariants.presetId, preset.id));
  if (!variant) return NextResponse.json({ error: "No variant for Cold Outreach preset" }, { status: 500 });

  const [existing] = await db.select().from(agents).where(eq(agents.email, email));
  if (existing?.lastContactedAt) {
    return NextResponse.json({ status: "skipped", reason: "already contacted" });
  }

  const subject = renderSubject(variant.subject ?? "", name);
  const text = renderMessageBody(variant.body, name, null);

  try {
    await sendEmail({ to: email, toName: name, subject, text, attachments: preset.attachments });
  } catch (err) {
    console.error("cold-outreach API: send failed", err);
    return NextResponse.json({ status: "failed", error: String(err) }, { status: 502 });
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
    // Same instinct as the send try/catch above — a unique-constraint
    // collision on agents.phone shouldn't lose a send that already went
    // out; retry the upsert without the phone number.
    console.error("cold-outreach API: agent upsert failed (likely phone collision), retrying without phone", err);
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

  return NextResponse.json({ status: "sent", agentId });
}
