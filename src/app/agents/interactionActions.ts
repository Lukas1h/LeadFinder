"use server";

import { db } from "@/db";
import {
  agentInteractions,
  agents,
  listings,
  messagePresets,
  messageSends,
  type InteractionChannel,
  type InteractionDirection,
  type InteractionOutcome,
  type MessageChannel,
  type MessageResult,
  type PresetType,
} from "@/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { markLatestSendResponded } from "@/lib/agentIdentity";

/**
 * One agent's history as a single list, merging templated sends
 * (messageSends, which carries preset/variant attribution) with everything
 * else that happened (agentInteractions: calls either way, texts and emails
 * that happened outside the app, someone getting back to you).
 *
 * Merged at read time rather than kept in one table — see the comment on
 * agentInteractions in schema.ts for why.
 */
export type TimelineItem =
  | {
      kind: "send";
      id: string;
      at: Date;
      presetName: string;
      channel: MessageChannel;
      type: PresetType;
      respondedAt: Date | null;
      result: MessageResult;
      listingAddress: string | null;
      // Folded in from the agentInteractions row the app logged for this same
      // send — tapping Text writes both (a send for the A/B stats, an
      // interaction so the "how did it go?" prompt has something to resolve),
      // and they are one event, so they render as one row.
      outcome: InteractionOutcome | null;
      note: string | null;
      pending: boolean;
    }
  | {
      kind: "interaction";
      id: string;
      at: Date;
      channel: InteractionChannel;
      direction: InteractionDirection;
      outcome: InteractionOutcome | null;
      note: string | null;
      pending: boolean;
      source: string;
      listingAddress: string | null;
    };

export async function getAgentTimeline(agentId: string): Promise<TimelineItem[]> {
  const [sends, interactions] = await Promise.all([
    db
      .select({
        id: messageSends.id,
        at: messageSends.sentAt,
        presetName: messagePresets.name,
        channel: messageSends.channel,
        type: messageSends.type,
        respondedAt: messageSends.respondedAt,
        result: messageSends.result,
        listingAddress: listings.address,
      })
      .from(messageSends)
      .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
      .leftJoin(listings, eq(messageSends.listingId, listings.id))
      .where(eq(messageSends.agentId, agentId)),
    db
      .select({
        id: agentInteractions.id,
        at: agentInteractions.occurredAt,
        channel: agentInteractions.channel,
        direction: agentInteractions.direction,
        outcome: agentInteractions.outcome,
        note: agentInteractions.note,
        pendingSince: agentInteractions.pendingSince,
        source: agentInteractions.source,
        messageSendId: agentInteractions.messageSendId,
        listingAddress: listings.address,
      })
      .from(agentInteractions)
      .leftJoin(listings, eq(agentInteractions.listingId, listings.id))
      .where(eq(agentInteractions.agentId, agentId)),
  ]);

  // One text sent from the app produced a row in each table. Keyed on the link
  // the app already stores between them, the pair collapses into the send,
  // which is the row that carries the preset/variant attribution.
  const sendIds = new Set(sends.map((s) => s.id));
  const linkedBySendId = new Map(
    interactions.filter((i) => i.messageSendId && sendIds.has(i.messageSendId)).map((i) => [i.messageSendId!, i])
  );

  const items: TimelineItem[] = [
    ...sends.map((s) => {
      const linked = linkedBySendId.get(s.id);
      return {
        kind: "send" as const,
        ...s,
        listingAddress: linked?.listingAddress ?? s.listingAddress,
        outcome: linked?.outcome ?? null,
        note: linked?.note ?? null,
        pending: linked?.pendingSince != null,
      };
    }),
    // An interaction pointing at a send that no longer exists stays on its own
    // rather than disappearing with it.
    ...interactions
      .filter((i) => !i.messageSendId || !sendIds.has(i.messageSendId))
      .map((i) => ({
        kind: "interaction" as const,
        id: i.id,
        at: i.at,
        channel: i.channel,
        direction: i.direction,
        outcome: i.outcome,
        note: i.note,
        source: i.source,
        listingAddress: i.listingAddress,
        pending: i.pendingSince != null,
      })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface LogInteractionInput {
  agentId: string;
  listingId?: string | null;
  channel: InteractionChannel;
  direction: InteractionDirection;
  outcome?: InteractionOutcome | null;
  note?: string | null;
  occurredAt?: Date;
}

/** Records an interaction the user is entering by hand, after the fact. */
export async function logInteraction(input: LogInteractionInput): Promise<{ error: string | null }> {
  await db.insert(agentInteractions).values({
    agentId: input.agentId,
    listingId: input.listingId ?? null,
    channel: input.channel,
    direction: input.direction,
    outcome: input.outcome ?? null,
    note: input.note?.trim() || null,
    occurredAt: input.occurredAt ?? new Date(),
    source: "manual",
  });

  const at = input.occurredAt ?? new Date();
  if (input.direction === "outbound") {
    // Reaching out counts as contact even when it happened outside the app, so
    // the agent doesn't keep reading as never-contacted after a phone call.
    await db.update(agents).set({ lastContactedAt: at }).where(eq(agents.id, input.agentId));
  } else {
    // They got back to you, which is the one thing the agent-level send path
    // had no way to record — see markLatestSendResponded.
    await markLatestSendResponded(input.agentId, at);
  }

  revalidatePath("/agents");
  revalidatePath("/messaging");
  return { error: null };
}

/**
 * Records that the app handed off to the phone dialer or the Messages app, in
 * a state that explicitly doesn't claim to know how it went.
 *
 * Tapping Call only opens the dialer — whether they picked up, or whether a
 * text was ever actually sent after the composer opened, is unknowable from
 * here. The old behavior asserted a send outright, which is why texts that were
 * never sent still counted toward a variant's stats. This parks the row and the
 * app asks on the way back in (see resolvePendingInteraction).
 */
export async function startPendingInteraction(input: {
  agentId: string;
  listingId?: string | null;
  channel: "call" | "text";
  messageSendId?: string | null;
}): Promise<string | null> {
  const [row] = await db
    .insert(agentInteractions)
    .values({
      agentId: input.agentId,
      listingId: input.listingId ?? null,
      channel: input.channel,
      direction: "outbound",
      pendingSince: new Date(),
      messageSendId: input.messageSendId ?? null,
      source: "app",
    })
    .returning({ id: agentInteractions.id });

  return row?.id ?? null;
}

/** Everything still waiting on a "how did that go?" answer, newest first. */
export async function getPendingInteractions(): Promise<
  {
    id: string;
    channel: InteractionChannel;
    agentName: string | null;
    listingAddress: string | null;
    startedAt: Date;
  }[]
> {
  return db
    .select({
      id: agentInteractions.id,
      channel: agentInteractions.channel,
      agentName: agents.name,
      listingAddress: listings.address,
      startedAt: agentInteractions.pendingSince,
    })
    .from(agentInteractions)
    .innerJoin(agents, eq(agentInteractions.agentId, agents.id))
    .leftJoin(listings, eq(agentInteractions.listingId, listings.id))
    .where(isNotNull(agentInteractions.pendingSince))
    .orderBy(desc(agentInteractions.pendingSince))
    .limit(10) as Promise<
    { id: string; channel: InteractionChannel; agentName: string | null; listingAddress: string | null; startedAt: Date }[]
  >;
}

/**
 * Answers a parked interaction. "not_sent" means the text never actually went,
 * so the optimistic send recorded at tap time is removed rather than left
 * inflating that variant's numbers — the whole reason for asking.
 */
export async function resolvePendingInteraction(
  id: string,
  outcome: InteractionOutcome,
  note?: string
): Promise<void> {
  const [row] = await db
    .select({
      messageSendId: agentInteractions.messageSendId,
      agentId: agentInteractions.agentId,
      listingId: agentInteractions.listingId,
    })
    .from(agentInteractions)
    .where(eq(agentInteractions.id, id));
  if (!row) return;

  if (outcome === "not_sent") {
    // Read the send's type before deleting it — it's the only thing that
    // distinguishes "this tap is what marked the listing contacted" from "this
    // tap was a follow-up that just refreshed the clock".
    let sendType: PresetType | null = null;
    if (row.messageSendId) {
      const [send] = await db
        .select({ type: messageSends.type })
        .from(messageSends)
        .where(eq(messageSends.id, row.messageSendId));
      sendType = send?.type ?? null;
      await db.delete(messageSends).where(eq(messageSends.id, row.messageSendId));
    }
    // Nothing reached them, so there's no interaction worth keeping either.
    await db.delete(agentInteractions).where(eq(agentInteractions.id, id));

    // The text button marks the listing "contacted" the instant it's tapped,
    // because the sms: handoff leaves the app no way to wait and see. When that
    // optimistic mark turns out to be wrong, the listing has to go back —
    // otherwise deciding not to text someone leaves a lead that reads as
    // contacted forever, silently out of the queue and off the follow-up radar.
    //
    // Only an initial_outreach can have set the status (a follow-up just bumps
    // contactedAt, see sendMessage), and only while the listing is still
    // sitting in the state this tap put it in — if it's moved on to quoted or
    // booked since, that later fact is the truer one and wins.
    if (row.listingId && sendType === "initial_outreach") {
      await db
        .update(listings)
        .set({ status: "new", statusChangedAt: new Date(), contactedAt: null })
        .where(and(eq(listings.id, row.listingId), eq(listings.status, "contacted")));
    }
  } else {
    await db
      .update(agentInteractions)
      .set({ outcome, pendingSince: null, ...(note?.trim() ? { note: note.trim() } : {}) })
      .where(eq(agentInteractions.id, id));

    await db.update(agents).set({ lastContactedAt: new Date() }).where(eq(agents.id, row.agentId));
  }

  // The leads page and pipeline both render listing status, and the not_sent
  // branch above can move a listing straight back to "new" — without these the
  // row stays gone from the queue until a manual refresh.
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/agents");
  revalidatePath("/messaging");
}

/**
 * Skips the question without answering it. The interaction stays as a real
 * record that the attempt happened, just with an unknown outcome — which is
 * honest, and better than either guessing or losing it.
 */
export async function dismissPendingInteraction(id: string): Promise<void> {
  await db.update(agentInteractions).set({ pendingSince: null }).where(eq(agentInteractions.id, id));
  revalidatePath("/agents");
}

/** Corrects an outcome from the timeline, for when the prompt was skipped or answered wrong. */
export async function updateInteractionOutcome(id: string, outcome: InteractionOutcome | null): Promise<void> {
  await db.update(agentInteractions).set({ outcome }).where(eq(agentInteractions.id, id));
  revalidatePath("/agents");
}

export async function deleteInteraction(id: string): Promise<void> {
  await db.delete(agentInteractions).where(eq(agentInteractions.id, id));
  revalidatePath("/agents");
}

/** Resolves the agent behind a listing, for the Contact dialog's call/text handoff. */
export async function getListingAgentId(listingId: string): Promise<string | null> {
  const [row] = await db
    .select({ agentId: listings.agentId })
    .from(listings)
    .where(and(eq(listings.id, listingId), isNotNull(listings.agentId)));
  return row?.agentId ?? null;
}

/**
 * The Call button's handoff. Resolves the listing's agent first, since the
 * button is rendered from a listing and only carries the phone number.
 */
export async function startPendingCallForListing(listingId: string): Promise<string | null> {
  const [row] = await db.select({ agentId: listings.agentId }).from(listings).where(eq(listings.id, listingId));
  if (!row?.agentId) return null;
  return startPendingInteraction({ agentId: row.agentId, listingId, channel: "call" });
}
