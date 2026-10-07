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
  /** The email "Send samples" sends, from the preset's follow-up setting. */
  followUpEmail: { presetId: string; name: string } | null;
}

export async function getSendDetail(sendId: string): Promise<SendDetail | null> {
  const [row] = await db
    .select({
      send: messageSends,
      presetName: messagePresets.name,
      followUpEmailPresetId: messagePresets.followUpEmailPresetId,
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

  let followUpEmail: SendDetail["followUpEmail"] = null;
  if (row.followUpEmailPresetId) {
    const [preset] = await db
      .select({ presetId: messagePresets.id, name: messagePresets.name })
      .from(messagePresets)
      .where(and(eq(messagePresets.id, row.followUpEmailPresetId), eq(messagePresets.enabled, true)));
    followUpEmail = preset ?? null;
  }

  return {
    id: row.send.id,
    channel: row.send.channel,
    type: row.send.type,
    sentAt: row.send.sentAt,
    respondedAt: row.send.respondedAt,
    result: row.send.result,
    presetName: row.presetName,
    text: renderMessageBody(
      row.body,
      row.agent?.name ?? row.listing?.agentName ?? null,
      row.listing?.address ?? null,
      row.listing?.city ?? null
    ),
    agent: row.agent,
    listing: row.listing,
    followUpEmail,
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
  await db.insert(agentInteractions).values({
    agentId: agent.id,
    listingId: send.listingId,
    channel: send.channel === "email" ? "email" : "text",
    direction: "inbound",
    note,
    occurredAt: now,
    source: "app",
  });

  const [current] = await db
    .select({ respondedAt: messageSends.respondedAt })
    .from(messageSends)
    .where(eq(messageSends.id, send.id));
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
    .select({ send: messageSends, agent: agents, followUpEmailPresetId: messagePresets.followUpEmailPresetId })
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
 * "Send samples": emails the preset's follow-up template to the agent, saves
 * the address if it's new, and records the reply. `emailInput` is only read
 * when the agent has no email on file.
 */
export async function sendSamplesForSend(
  sendId: string,
  emailInput?: string
): Promise<{ error?: string; note?: string }> {
  const row = await loadSend(sendId);
  if (!row?.agent) return { error: "This message has no agent attached" };
  if (!row.followUpEmailPresetId) return { error: "This template has no follow-up email set" };
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
    .select({ id: messagePresets.id, name: messagePresets.name, type: messagePresets.type, attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, row.followUpEmailPresetId));
  if (!preset) return { error: "The follow-up email template is gone" };

  // Least-sent enabled variant, ties by label — the same rotation as the send dialogs.
  const variants = await db
    .select({ id: messagePresetVariants.id, label: messagePresetVariants.label, subject: messagePresetVariants.subject, body: messagePresetVariants.body })
    .from(messagePresetVariants)
    .where(and(eq(messagePresetVariants.presetId, preset.id), eq(messagePresetVariants.enabled, true)));
  if (variants.length === 0) return { error: `"${preset.name}" has no enabled variant` };
  const counts = await db
    .select({ variantId: messageSends.variantId, n: count() })
    .from(messageSends)
    .where(inArray(messageSends.variantId, variants.map((v) => v.id)))
    .groupBy(messageSends.variantId);
  const sent = new Map(counts.map((c) => [c.variantId, c.n]));
  const variant = [...variants].sort(
    (a, b) => (sent.get(a.id) ?? 0) - (sent.get(b.id) ?? 0) || a.label.localeCompare(b.label)
  )[0];

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
    console.error("sendSamplesForSend: send failed", err);
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
