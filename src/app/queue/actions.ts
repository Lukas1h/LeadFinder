"use server";

import { db } from "@/db";
import {
  agentInteractions,
  agents,
  listings,
  messagePresets,
  messagePresetVariants,
  queuedMessages,
  type MessageChannel,
  type PresetType,
  type QueuedMessageStatus,
  type Listing,
} from "@/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contactByChannel } from "@/lib/agentLastContact";
import { AI_DRAFT_VARIANT_SENTINEL } from "@/lib/messageTemplate";
import { nextSendTime } from "@/lib/queue";
import { generatePendingDrafts } from "@/lib/queueMessages";
import { sendMessage, ensureBlankSmsPreset } from "../messageActions";
import { sendListingEmail, sendComposeEmail, ensureBlankEmailPreset } from "../composeEmailActions";
import { startPendingInteraction } from "../agents/interactionActions";

export interface QueueItem {
  id: string;
  channel: MessageChannel;
  type: PresetType;
  status: QueuedMessageStatus;
  /** "pending" while its AI draft is being written, "failed" if that errored; null = ready. */
  draftStatus: string | null;
  subject: string | null;
  body: string;
  recipient: string | null;
  sendAfter: Date;
  /** sendAfter pushed into the 8 AM–9 PM window — when it actually becomes due. */
  dueAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  presetName: string | null;
  /** Drafted by AI for this listing (shown in full) rather than filled from a template. */
  aiDraft: boolean;
  /** The full listing row, for the ListingRow on the card. */
  listing: Listing | null;
  agentId: string;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  listingId: string | null;
  listingAddress: string | null;
  listingCity: string | null;
  /** Waiting on an earlier queued message that hasn't gone out yet. */
  waitingOnId: string | null;
  /** The agent wrote back after this was queued — worth a look before sending. */
  repliedSinceQueued: boolean;
  /** Latest real contact (send or interaction) with this agent, if any. */
  /** Latest contact on this message's channel (texted/called for a text, emailed for an email). */
  lastContactedAt: Date | null;
  /** Latest contact on the other channel — context, not a warning. */
  otherChannelContactedAt: Date | null;
}

/** Every unsent message plus the last 2 days of sent/skipped ones, oldest due first. */
export async function getQueue(agentId?: string): Promise<QueueItem[]> {
  const rows = await db
    .select({
      q: queuedMessages,
      presetName: messagePresets.name,
      presetAi: messagePresets.aiGenerated,
      listing: listings,
      agentName: agents.name,
      agentPhone: agents.phone,
      agentEmail: agents.email,
      listingAddress: listings.address,
      listingCity: listings.city,
    })
    .from(queuedMessages)
    .innerJoin(agents, eq(queuedMessages.agentId, agents.id))
    .leftJoin(listings, eq(queuedMessages.listingId, listings.id))
    .leftJoin(messagePresets, eq(queuedMessages.presetId, messagePresets.id))
    .where(agentId ? eq(queuedMessages.agentId, agentId) : undefined);

  const recentCutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const visible = rows.filter(
    (r) => r.q.status === "queued" || (r.q.sentAt ?? r.q.createdAt).getTime() > recentCutoff
  );
  const agentIds = [...new Set(visible.map((r) => r.q.agentId))];

  const [inbound, contacts] = await Promise.all([
    agentIds.length === 0
      ? []
      : db
          .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
          .from(agentInteractions)
          .where(and(inArray(agentInteractions.agentId, agentIds), eq(agentInteractions.direction, "inbound")))
          .groupBy(agentInteractions.agentId),
    contactByChannel(agentIds),
  ]);
  const lastInbound = new Map(inbound.map((r) => [r.agentId, r.at ? new Date(r.at) : null]));
  const statusById = new Map(rows.map((r) => [r.q.id, r.q.status]));

  return visible
    .map(({ q, ...r }) => {
      const replied = lastInbound.get(q.agentId);
      const waitingOnId =
        q.afterQueuedId && statusById.get(q.afterQueuedId) === "queued" ? q.afterQueuedId : null;
      return {
        id: q.id,
        channel: q.channel,
        type: q.type,
        status: q.status,
        draftStatus: q.draftStatus,
        subject: q.subject,
        body: q.body,
        recipient: q.recipient,
        sendAfter: q.sendAfter,
        dueAt: nextSendTime(q.sendAfter),
        sentAt: q.sentAt,
        createdAt: q.createdAt,
        presetName: r.presetName,
        aiDraft: r.presetAi === true || q.draftStatus != null,
        listing: r.listing,
        agentId: q.agentId,
        agentName: r.agentName,
        agentPhone: r.agentPhone,
        agentEmail: r.agentEmail,
        listingId: q.listingId,
        listingAddress: r.listingAddress,
        listingCity: r.listingCity,
        waitingOnId,
        repliedSinceQueued: q.status === "queued" && replied != null && replied > q.createdAt,
        lastContactedAt: contacts.get(q.agentId)?.[q.channel === "email" ? "emailed" : "texted"] ?? null,
        otherChannelContactedAt: contacts.get(q.agentId)?.[q.channel === "email" ? "texted" : "emailed"] ?? null,
      };
    })
    .sort((a, b) => (a.waitingOnId ? 1 : 0) - (b.waitingOnId ? 1 : 0) || a.dueAt.getTime() - b.dueAt.getTime());
}

function revalidateQueue() {
  revalidatePath("/queue");
  revalidatePath("/agents");
}

export async function updateQueuedMessage(
  id: string,
  input: { subject?: string | null; body: string; recipient?: string | null; sendAfter: Date }
): Promise<{ error?: string }> {
  if (!input.body.trim()) return { error: "Message can't be empty" };
  await db
    .update(queuedMessages)
    .set({
      subject: input.subject?.trim() || null,
      body: input.body.trim(),
      recipient: input.recipient?.trim() || null,
      sendAfter: input.sendAfter,
      // Written by hand now, so it no longer waits on (or gets overwritten by) an AI draft.
      draftStatus: null,
    })
    .where(and(eq(queuedMessages.id, id), eq(queuedMessages.status, "queued")));
  revalidateQueue();
  return {};
}

export async function setQueuedMessageStatus(id: string, status: "queued" | "skipped"): Promise<void> {
  await db.update(queuedMessages).set({ status }).where(eq(queuedMessages.id, id));
  revalidateQueue();
}

export async function deleteQueuedMessage(id: string): Promise<void> {
  await db.delete(queuedMessages).where(eq(queuedMessages.id, id));
  revalidateQueue();
}

async function loadForSend(id: string) {
  const [row] = await db
    .select({ q: queuedMessages, agent: agents })
    .from(queuedMessages)
    .innerJoin(agents, eq(queuedMessages.agentId, agents.id))
    .where(eq(queuedMessages.id, id));
  return row?.q.status === "queued" && row.q.draftStatus == null ? row : null;
}

/** Re-runs a failed (or stuck) AI draft for one queued message. */
export async function retryQueuedDraft(id: string): Promise<{ error?: string }> {
  const drafted = await generatePendingDrafts([id]);
  revalidateQueue();
  return drafted ? {} : { error: "The AI draft failed again" };
}

/** The protected Blank preset for a channel — attribution for a row queued without one. */
async function fallbackPresetId(channel: MessageChannel, type: PresetType): Promise<string | null> {
  if (channel === "sms") await ensureBlankSmsPreset(type);
  else await ensureBlankEmailPreset();
  const [preset] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(
      and(
        eq(messagePresets.channel, channel),
        eq(messagePresets.protected, true),
        ...(channel === "sms" ? [eq(messagePresets.type, type)] : [])
      )
    )
    .limit(1);
  return preset?.id ?? null;
}

/** Marks a row sent and starts the clock on any step chained after it. */
async function markSent(id: string, interactionId: string | null) {
  const now = new Date();
  await db
    .update(queuedMessages)
    .set({ status: "sent", sentAt: now, interactionId })
    .where(eq(queuedMessages.id, id));
  const next = await db
    .select({ id: queuedMessages.id, delayMinutes: queuedMessages.delayMinutes })
    .from(queuedMessages)
    .where(and(eq(queuedMessages.afterQueuedId, id), eq(queuedMessages.status, "queued")));
  for (const step of next) {
    await db
      .update(queuedMessages)
      .set({ sendAfter: new Date(now.getTime() + (step.delayMinutes ?? 0) * 60_000) })
      .where(eq(queuedMessages.id, step.id));
  }
}

/** Sends a queued email now, through the same actions the email dialogs use. */
export async function sendQueuedEmail(id: string): Promise<{ error?: string }> {
  const row = await loadForSend(id);
  if (!row) return { error: "Already sent, removed, or still drafting" };
  const { q, agent } = row;
  if (q.channel !== "email") return { error: "Not an email" };
  const to = q.recipient ?? agent.email;
  if (!to) return { error: "No email address — edit the message to add one" };
  if (!q.subject?.trim()) return { error: "Add a subject first" };

  const presetId = q.presetId ?? (await fallbackPresetId("email", q.type));
  if (!presetId) return { error: "No email template to attribute this to" };
  // sendListingEmail materializes an AI draft's variant itself;
  // sendComposeEmail doesn't, so do it here for listing-less emails.
  let variantId = q.variantId ?? AI_DRAFT_VARIANT_SENTINEL;
  if (!q.listingId && variantId === AI_DRAFT_VARIANT_SENTINEL) {
    const [variant] = await db
      .insert(messagePresetVariants)
      .values({ presetId, label: `AI · ${new Date().toLocaleDateString()}`, subject: q.subject, body: q.body })
      .returning({ id: messagePresetVariants.id });
    variantId = variant.id;
  }

  const result = q.listingId
    ? await sendListingEmail({
        listingId: q.listingId,
        type: q.type,
        presetId,
        variantId,
        agentEmail: to,
        agentName: agent.name,
        subject: q.subject,
        body: q.body,
      })
    : await sendComposeEmail({
        name: agent.name ?? to,
        email: to,
        type: q.type,
        presetId,
        variantId,
        subject: q.subject,
        body: q.body,
      });
  if (result.error) return result;

  await markSent(id, null);
  revalidateQueue();
  return {};
}

/**
 * Called as the client hands a queued text off to Messages. Logs it the same
 * way the Text button does — an optimistic send plus a pending interaction,
 * confirmed when you're back — and remembers that interaction, so Undo on the
 * "Message sent" toast puts the row back in the queue (see
 * resolvePendingInteraction).
 */
export async function markQueuedTextOpened(id: string): Promise<void> {
  const row = await loadForSend(id);
  if (!row) return;
  const { q } = row;

  let interactionId: string | null = null;
  if (q.listingId) {
    const presetId = q.presetId ?? (await fallbackPresetId("sms", q.type));
    if (presetId) {
      const result = await sendMessage(q.listingId, q.type, presetId, q.variantId ?? AI_DRAFT_VARIANT_SENTINEL, q.body);
      interactionId = result.pendingInteractionId;
    }
  } else {
    interactionId = await startPendingInteraction({ agentId: q.agentId, channel: "text" });
  }

  await markSent(id, interactionId);
  revalidateQueue();
}
