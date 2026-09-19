"use server";

import { db } from "@/db";
import { agents, listings, messagePresets, messagePresetVariants, messageSends, type PresetType } from "@/db/schema";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_COLD_EMAIL_SUBJECT,
  DEFAULT_COLD_EMAIL_BODY,
  BLANK_EMAIL_SUBJECT,
  BLANK_EMAIL_BODY,
  renderMessageBody,
  renderSubject,
} from "@/lib/messageTemplate";
import { sendEmail } from "@/lib/mailer";
import { touchAgentContact } from "@/app/actions";
import type { PresetOption, MessageOptions } from "@/app/messageActions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Idempotent — seeds one "Cold Outreach" email preset with Lukas's own
 * real template (given verbatim, see the messageTemplate.ts comment) the
 * first time this is called with no email presets yet. Only seeds
 * initial_outreach — no equivalent follow-up copy was given. Attach the
 * actual pricing sheet / portfolio files via the preset's own "Attach
 * file" control once seeded — they can't be seeded here since the
 * template's "I've attached..." line was written by hand, not from real
 * uploaded files.
 */
export async function ensureDefaultEmailPreset() {
  const [existing] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(eq(messagePresets.channel, "email"))
    .limit(1);
  if (existing) return;

  const [preset] = await db
    .insert(messagePresets)
    .values({ name: "Cold Outreach", type: "initial_outreach", channel: "email" })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: preset.id,
    label: "A",
    subject: DEFAULT_COLD_EMAIL_SUBJECT,
    body: DEFAULT_COLD_EMAIL_BODY,
  });
  revalidatePath("/messaging");
}

/**
 * Idempotent — seeds a "Blank" email preset (just "Hello {{firstName}},"
 * and the signature, empty middle) the first time this is called with none
 * existing. protected: true keeps it from ever being deleted (see
 * deletePreset in src/app/messaging/actions.ts) even with zero send
 * history, since the whole point is it's always there as a scaffold — but
 * its variant body/subject stay normally editable.
 */
export async function ensureBlankEmailPreset() {
  const [existing] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(and(eq(messagePresets.channel, "email"), eq(messagePresets.protected, true)))
    .limit(1);
  if (existing) return;

  const [preset] = await db
    .insert(messagePresets)
    .values({ name: "Blank", type: "initial_outreach", channel: "email", protected: true })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: preset.id,
    label: "A",
    subject: BLANK_EMAIL_SUBJECT,
    body: BLANK_EMAIL_BODY,
  });
  revalidatePath("/messaging");
}

/**
 * Like getMessageOptions but for the cold-compose flow: no listing, so no
 * criteria-matching, and no separate "type" argument by default — Compose
 * shows one Template dropdown spanning both initial_outreach and follow_up
 * (grouped into sections), so picking a template also picks the type,
 * rather than making the user pick a type first to even see their
 * templates. Every enabled email preset is equally eligible; the oldest
 * (first created) is recommended by default. Same least-sent-variant
 * rotation as SMS, so email A/B stats stay honest too.
 *
 * `listingContext` is used by the per-listing Send email dialog (see
 * SendEmailDialog.tsx) rather than the standalone Compose page — it scopes
 * to one `type` (matching the listing's SendMessageDialog counterpart) and
 * renders {{firstName}}/{{street}} against that listing's actual agent,
 * the same way getMessageOptions does for SMS.
 */
export async function getComposeEmailOptions(listingContext?: {
  type: PresetType;
  agentName: string | null;
  address: string | null;
}): Promise<MessageOptions> {
  await ensureDefaultEmailPreset();
  await ensureBlankEmailPreset();

  const conditions = [
    eq(messagePresets.channel, "email"),
    eq(messagePresets.enabled, true),
    eq(messagePresets.aiGenerated, false),
    eq(messagePresetVariants.enabled, true),
  ];
  if (listingContext) conditions.push(eq(messagePresets.type, listingContext.type));

  const rows = await db
    .select({
      presetId: messagePresets.id,
      presetName: messagePresets.name,
      presetType: messagePresets.type,
      attachments: messagePresets.attachments,
      variantId: messagePresetVariants.id,
      label: messagePresetVariants.label,
      subject: messagePresetVariants.subject,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
    .where(and(...conditions))
    .orderBy(messagePresets.createdAt);

  if (rows.length === 0) return { presets: [] };

  const sendCounts = await db
    .select({ variantId: messageSends.variantId, count: count() })
    .from(messageSends)
    .groupBy(messageSends.variantId);
  const countByVariant = new Map(sendCounts.map((r) => [r.variantId, r.count]));

  const rowsByPreset = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowsByPreset.get(row.presetId);
    if (group) group.push(row);
    else rowsByPreset.set(row.presetId, [row]);
  }

  let recommendedPresetId: string | null = null;
  const presets: PresetOption[] = Array.from(rowsByPreset.values()).map((group) => {
    if (recommendedPresetId === null) recommendedPresetId = group[0].presetId;

    const minCount = Math.min(...group.map((r) => countByVariant.get(r.variantId) ?? 0));
    const leastUsed = group
      .filter((r) => (countByVariant.get(r.variantId) ?? 0) === minCount)
      .sort((a, b) => a.label.localeCompare(b.label));
    const picked = leastUsed[0];

    return {
      presetId: picked.presetId,
      presetName: picked.presetName,
      variantId: picked.variantId,
      variantLabel: picked.label,
      // Un-substituted when there's no listing context (the standalone
      // Compose flow) — there's no agent name yet at load time there, it's
      // whatever's currently typed into Compose's Name field, so
      // ComposeEmailPanel renders {{firstName}} client-side as that field
      // changes instead. With listingContext, render against the actual
      // agent/listing now, same as getMessageOptions' SMS path.
      text: listingContext
        ? renderMessageBody(picked.body, listingContext.agentName, listingContext.address)
        : picked.body,
      subject: listingContext ? renderSubject(picked.subject ?? "", listingContext.agentName) : picked.subject ?? "",
      attachments: picked.attachments,
      type: picked.presetType,
      recommended: picked.presetId === recommendedPresetId,
    };
  });

  return { presets };
}

export interface SendListingEmailInput {
  listingId: string;
  type: PresetType;
  presetId: string;
  variantId: string;
  agentEmail: string;
  agentName: string | null;
  subject: string;
  body: string;
}

/**
 * Listing-scoped counterpart to sendComposeEmail, for the per-listing Send
 * email dialog — same send-first-log-on-success order (a real SMTP call,
 * unlike sms:'s client-side deep link, can fail server-side), but also
 * applies the same listing-status side effect sendMessage (SMS) does:
 * initial outreach moves the lead to "contacted", and either way
 * touchAgentContact keeps the agent row's lastContactedAt/
 * lastContactedListingId current. Unlike sendComposeEmail's standalone
 * flow (which resolves/creates an agent by exact email match), the agent
 * here is resolved by the listing's own phone — this listing already has
 * a known agent, phone is its canonical identity across the app.
 */
export async function sendListingEmail(input: SendListingEmailInput): Promise<{ error?: string }> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return { error: "Subject is required" };
  if (!body) return { error: "Message body is required" };

  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, input.presetId));

  try {
    await sendEmail({
      to: input.agentEmail,
      toName: input.agentName,
      subject,
      text: body,
      attachments: preset?.attachments,
    });
  } catch (err) {
    console.error("sendListingEmail: SMTP send failed", err);
    return { error: "Failed to send — try again." };
  }

  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({
      contactedAt: now,
      statusChangedAt: now,
      ...(input.type === "initial_outreach" ? { status: "contacted" as const } : {}),
    })
    .where(eq(listings.id, input.listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  const agentId = lead ? await touchAgentContact(input.listingId, lead.agentPhone, lead.agentName) : null;

  await db.insert(messageSends).values({
    listingId: input.listingId,
    agentId,
    presetId: input.presetId,
    variantId: input.variantId,
    type: input.type,
    channel: "email",
    sentAt: now,
  });

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/messaging");

  return {};
}

export interface SendComposeEmailInput {
  name: string;
  email: string;
  type: PresetType;
  presetId: string;
  variantId: string;
  subject: string;
  body: string;
}

/**
 * Sends first, writes to the DB only on success — inverted from sendMessage
 * (SMS)'s order, since an actual SMTP call can fail server-side, unlike an
 * sms: deep link which can't meaningfully fail client-side. On success:
 * resolves the target agent by exact email match (this also covers a
 * fuzzy-matched agent explicitly merged moments earlier via
 * mergeAgentEmail — merging sets the email column live, so by send time
 * it's already an exact match here, no separate branch needed) or else
 * creates a new agent row — and always logs a messageSends row with no
 * listingId, so this shows up in the same A/B stats as SMS sends.
 */
export async function sendComposeEmail(input: SendComposeEmailInput): Promise<{ error?: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!name) return { error: "Name is required" };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address" };
  if (!subject) return { error: "Subject is required" };
  if (!body) return { error: "Message body is required" };

  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, input.presetId));

  try {
    await sendEmail({ to: email, toName: name, subject, text: body, attachments: preset?.attachments });
  } catch (err) {
    console.error("sendComposeEmail: SMTP send failed", err);
    return { error: "Failed to send — check the address and try again." };
  }

  const now = new Date();
  const [exactMatch] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email));

  let agentId: string;
  if (exactMatch) {
    await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, exactMatch.id));
    agentId = exactMatch.id;
  } else {
    const [inserted] = await db
      .insert(agents)
      .values({ email, name, lastContactedAt: now })
      .returning({ id: agents.id });
    agentId = inserted.id;
  }

  await db.insert(messageSends).values({
    listingId: null,
    agentId,
    presetId: input.presetId,
    variantId: input.variantId,
    type: input.type,
    channel: "email",
    sentAt: now,
  });

  revalidatePath("/messaging");
  revalidatePath("/agents");

  return {};
}
