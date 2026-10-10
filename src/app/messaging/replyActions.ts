"use server";

// The Message history detail card: what was sent, to whom, about which
// listing, and one-tap handling of the reply — "send samples", "keep in
// touch", or "declined". Replaces sending a screenshot to the assistant to log
// a reply, then opening the agent, adding their email and picking the
// follow-up template by hand.

import { db } from "@/db";
import {
  agentInteractions,
  agents,
  listings,
  messagePresets,
  messagePresetVariants,
  messageSends,
  type Agent,
  type AgentRelationshipStatus,
  type Listing,
  type MessageChannel,
  type MessageResult,
  type PresetType,
} from "@/db/schema";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { attachmentMetaSql, withContentTypes, type AttachmentMeta } from "@/lib/attachments";
import { resolvePendingInteraction, startPendingInteraction } from "@/app/agents/interactionActions";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/mailer";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { normalizeEmail, EMAIL_RE } from "@/lib/normalize";
import { setAgentRelationshipStatus } from "@/lib/agentIdentity";

export interface SendDetail {
  id: string;
  channel: MessageChannel;
  type: PresetType;
  sentAt: Date;
  respondedAt: Date | null;
  result: MessageResult;
  presetName: string;
  /** The template as it reads for this agent and listing (edits made at send time aren't stored). */
  text: string;
  agent: Agent | null;
  listing: Listing | null;
  /** The template's quick actions, in order (see messagePresets.quickActionPresetIds). */
  quickActions: QuickAction[];
}

/** One button on a sent message: another template, ready to go to the same agent. */
export interface QuickAction {
  presetId: string;
  name: string;
  /** An email is sent by the server; a text opens Messages with this filled in. */
  channel: MessageChannel;
  variantId: string;
  /** The body as it reads for this agent and listing. */
  text: string;
  subject: string | null;
  /** No bytes: the phone fetches each file when it builds the text. */
  attachments: AttachmentMeta[];
}

/** The enabled variant that has gone out least, ties by label: the same rotation as the send dialogs. */
async function nextVariants(presetIds: string[]) {
  if (presetIds.length === 0) return new Map<string, { id: string; subject: string | null; body: string }>();
  const variants = await db
    .select({
      id: messagePresetVariants.id,
      presetId: messagePresetVariants.presetId,
      label: messagePresetVariants.label,
      subject: messagePresetVariants.subject,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .where(and(inArray(messagePresetVariants.presetId, presetIds), eq(messagePresetVariants.enabled, true)));
  if (variants.length === 0) return new Map();
  const counts = await db
    .select({ variantId: messageSends.variantId, n: count() })
    .from(messageSends)
    .where(inArray(messageSends.variantId, variants.map((v) => v.id)))
    .groupBy(messageSends.variantId);
  const sent = new Map(counts.map((c) => [c.variantId, c.n]));
  const next = new Map<string, (typeof variants)[number]>();
  for (const v of variants) {
    const best = next.get(v.presetId);
    const diff = best ? (sent.get(v.id) ?? 0) - (sent.get(best.id) ?? 0) || v.label.localeCompare(best.label) : -1;
    if (diff < 0) next.set(v.presetId, v);
  }
  return next;
}

/**
 * A template's quick actions, rendered for one agent. One that has been
 * switched off, archived or left with no variant is dropped rather than shown
 * as a button that can't work.
 */
async function loadQuickActions(
  presetIds: string[],
  who: { agentName: string | null; address: string | null; city: string | null }
): Promise<QuickAction[]> {
  if (presetIds.length === 0) return [];
  const [presets, variants] = await Promise.all([
    db
      .select({
        id: messagePresets.id,
        name: messagePresets.name,
        channel: messagePresets.channel,
        attachments: attachmentMetaSql,
      })
      .from(messagePresets)
      .where(and(inArray(messagePresets.id, presetIds), eq(messagePresets.enabled, true))),
    nextVariants(presetIds),
  ]);
  const byId = new Map(presets.map((p) => [p.id, p]));
  return presetIds.flatMap((id) => {
    const preset = byId.get(id);
    const variant = variants.get(id);
    if (!preset || !variant) return [];
    return [
      {
        presetId: preset.id,
        name: preset.name,
        channel: preset.channel,
        variantId: variant.id,
        text: renderMessageBody(variant.body, who.agentName, who.address, who.city),
        subject: variant.subject ? renderSubject(variant.subject, who.agentName) : null,
        attachments: withContentTypes(preset.attachments),
      },
    ];
  });
}

export async function getSendDetail(sendId: string): Promise<SendDetail | null> {
  const [row] = await db
    .select({
      send: messageSends,
      presetName: messagePresets.name,
      quickActionPresetIds: messagePresets.quickActionPresetIds,
      body: messagePresetVariants.body,
      agent: agents,
      listing: listings,
    })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .innerJoin(messagePresetVariants, eq(messageSends.variantId, messagePresetVariants.id))
    .leftJoin(agents, eq(messageSends.agentId, agents.id))
    .leftJoin(listings, eq(messageSends.listingId, listings.id))
    .where(eq(messageSends.id, sendId));
  if (!row) return null;

  const who = {
    agentName: row.agent?.name ?? row.listing?.agentName ?? null,
    address: row.listing?.address ?? null,
    city: row.listing?.city ?? null,
  };
  const quickActions = await loadQuickActions(row.quickActionPresetIds, who);

  return {
    id: row.send.id,
    channel: row.send.channel,
    type: row.send.type,
    sentAt: row.send.sentAt,
    respondedAt: row.send.respondedAt,
    result: row.send.result,
    presetName: row.presetName,
    text: renderMessageBody(row.body, who.agentName, who.address, who.city),
    agent: row.agent,
    listing: row.listing,
    quickActions,
  };
}

type ReplyKind = "samples" | "keep_in_touch" | "declined";

/** Past clients keep their status whatever one reply says. */
const CLIENT_STATUSES: AgentRelationshipStatus[] = ["worked_once", "regular"];

/**
 * Records that the agent replied to this send: an inbound row in their
 * history, respondedAt on the send itself (not just their latest one), and
 * the status changes the reply implies. A reply makes a cold agent warm;
 * "interested" is for someone asking more than "sure, send them".
 */
async function recordReply(
  send: { id: string; channel: MessageChannel; listingId: string | null },
  agent: Agent,
  kind: ReplyKind,
  note: string
) {
  const now = new Date();
  const [current] = await db
    .select({ respondedAt: messageSends.respondedAt })
    .from(messageSends)
    .where(eq(messageSends.id, send.id));
  // A second quick action on the same message (photos, then the vCard) is
  // still answering the one reply, so it isn't logged as another.
  if (kind === "samples" && current?.respondedAt) return;

  await db.insert(agentInteractions).values({
    agentId: agent.id,
    listingId: send.listingId,
    channel: send.channel === "email" ? "email" : "text",
    direction: "inbound",
    note,
    occurredAt: now,
    source: "app",
  });

  await db
    .update(messageSends)
    .set({
      ...(current?.respondedAt ? {} : { respondedAt: now }),
      ...(kind === "declined" ? { result: "declined" as const } : {}),
    })
    .where(eq(messageSends.id, send.id));

  if (kind === "declined") {
    if (!CLIENT_STATUSES.includes(agent.relationshipStatus)) await setAgentRelationshipStatus(agent.id, "declined");
  } else if (agent.relationshipStatus === "cold" || agent.relationshipStatus === "declined") {
    await setAgentRelationshipStatus(agent.id, "warm");
  }

  if (send.listingId) {
    if (kind === "declined") {
      await db
        .update(listings)
        .set({ status: "declined", statusChangedAt: now })
        // An "outreach" listing was never pursued, so the no is the agent's
        // (recorded above), not the property's.
        .where(
          and(
            eq(listings.id, send.listingId),
            inArray(listings.status, ["new", "saved", "contacted", "replied", "quoted"])
          )
        );
    } else {
      await db
        .update(listings)
        .set({ status: "replied", statusChangedAt: now })
        .where(and(eq(listings.id, send.listingId), inArray(listings.status, ["new", "saved", "contacted"])));
    }
  }
}

function revalidateAll() {
  revalidatePath("/messaging");
  revalidatePath("/agents");
  revalidatePath("/");
  revalidatePath("/pipeline");
}

async function loadSend(sendId: string) {
  const [row] = await db
    .select({ send: messageSends, agent: agents, quickActionPresetIds: messagePresets.quickActionPresetIds })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .leftJoin(agents, eq(messageSends.agentId, agents.id))
    .where(eq(messageSends.id, sendId));
  return row ?? null;
}

/** "Keep in touch" or "Declined": logs the reply, no message goes out. */
export async function markSendReply(
  sendId: string,
  kind: "keep_in_touch" | "declined"
): Promise<{ error?: string }> {
  const row = await loadSend(sendId);
  if (!row?.agent) return { error: "This message has no agent attached" };
  await recordReply(
    row.send,
    row.agent,
    kind,
    kind === "declined" ? "Replied: not interested." : "Replied: not right now, keep in touch."
  );
  revalidateAll();
  return {};
}

/**
 * An email quick action ("Send samples"): emails that template to the agent,
 * saves the address if it's new, and records the reply. `emailInput` is only
 * read when the agent has no email on file.
 *
 * **Sends real email.** Only ever called from a button press on the message.
 */
export async function sendQuickActionEmail(
  sendId: string,
  presetId: string,
  emailInput?: string
): Promise<{ error?: string; note?: string }> {
  const row = await loadSend(sendId);
  if (!row?.agent) return { error: "This message has no agent attached" };
  if (!row.quickActionPresetIds.includes(presetId)) return { error: "That isn't one of this template's quick actions" };
  const agent = row.agent;

  // Forgiving about what got pasted: "Sure! jane@x.com" still finds the address.
  const typed = (emailInput ?? "").match(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i)?.[0] ?? "";
  const email = agent.email ?? normalizeEmail(typed);
  if (!EMAIL_RE.test(email)) return { error: "That isn't a valid email address" };

  // The address can already sit on another record of the same person (an
  // email-only row from the cold email run). Send anyway; just don't move it.
  let emailOwner: string | null = null;
  if (!agent.email) {
    const [owner] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.email, email), ne(agents.id, agent.id)));
    if (owner) emailOwner = owner.name ?? "another agent";
  }

  const [preset] = await db
    .select({
      id: messagePresets.id,
      name: messagePresets.name,
      type: messagePresets.type,
      channel: messagePresets.channel,
      enabled: messagePresets.enabled,
      attachments: messagePresets.attachments,
    })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset || !preset.enabled) return { error: "That template is gone or switched off" };
  if (preset.channel !== "email") return { error: `"${preset.name}" is a text, not an email` };

  const variant = (await nextVariants([preset.id])).get(preset.id);
  if (!variant) return { error: `"${preset.name}" has no enabled variant` };

  const [listing] = row.send.listingId
    ? await db.select({ address: listings.address, city: listings.city }).from(listings).where(eq(listings.id, row.send.listingId))
    : [];

  try {
    await sendEmail({
      to: email,
      toName: agent.name,
      subject: renderSubject(variant.subject ?? "", agent.name),
      text: renderMessageBody(variant.body, agent.name, listing?.address ?? null, listing?.city ?? null),
      attachments: preset.attachments,
    });
  } catch (err) {
    console.error("sendQuickActionEmail: send failed", err);
    return { error: "Couldn't send the email — check the address and try again." };
  }

  const now = new Date();
  await db
    .update(agents)
    .set({ lastContactedAt: now, ...(!agent.email && !emailOwner ? { email } : {}) })
    .where(eq(agents.id, agent.id));
  await db.insert(messageSends).values({
    listingId: row.send.listingId,
    agentId: agent.id,
    presetId: preset.id,
    variantId: variant.id,
    type: preset.type,
    channel: "email",
    sentAt: now,
  });
  await recordReply(row.send, agent, "samples", `Replied: wants samples. Sent "${preset.name}" to ${email}.`);

  revalidateAll();
  return emailOwner ? { note: `That email is on ${emailOwner}'s record, so it wasn't saved here` } : {};
}

/**
 * A text quick action ("Send contact", "Photo samples"): records that it went
 * out. Nothing is sent from here — the phone opens Messages with the text and
 * the template's files and calls this once the composer says it was sent
 * (`confirmed`); the web opens an sms: link and can't know, so its send waits
 * on the usual "did it go?" prompt.
 */
export async function recordQuickActionText(
  sendId: string,
  presetId: string,
  variantId: string,
  confirmed: boolean
): Promise<{ error?: string }> {
  const row = await loadSend(sendId);
  if (!row?.agent) return { error: "This message has no agent attached" };
  if (!row.quickActionPresetIds.includes(presetId)) return { error: "That isn't one of this template's quick actions" };
  const agent = row.agent;

  const [preset] = await db
    .select({ id: messagePresets.id, name: messagePresets.name, type: messagePresets.type, channel: messagePresets.channel })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset) return { error: "That template is gone" };
  if (preset.channel !== "sms") return { error: `"${preset.name}" is an email, not a text` };
  const [variant] = await db
    .select({ id: messagePresetVariants.id })
    .from(messagePresetVariants)
    .where(and(eq(messagePresetVariants.id, variantId), eq(messagePresetVariants.presetId, presetId)));
  if (!variant) return { error: "That variant doesn't belong to the template" };

  const now = new Date();
  await db.update(agents).set({ lastContactedAt: now }).where(eq(agents.id, agent.id));
  const [sent] = await db
    .insert(messageSends)
    .values({
      listingId: row.send.listingId,
      agentId: agent.id,
      presetId: preset.id,
      variantId: variant.id,
      type: preset.type,
      channel: "sms",
      sentAt: now,
    })
    .returning({ id: messageSends.id });
  const interactionId = await startPendingInteraction({
    agentId: agent.id,
    listingId: row.send.listingId,
    channel: "text",
    messageSendId: sent?.id ?? null,
  });
  if (confirmed && interactionId) await resolvePendingInteraction(interactionId, "sent", `Sent "${preset.name}".`);
  await recordReply(row.send, agent, "samples", `Replied. Sent "${preset.name}".`);

  revalidateAll();
  return {};
}
