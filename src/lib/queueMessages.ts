// Bulk-queues messages (texts or emails) for a set of listings or agents,
// from a template or as AI drafts. Shared by the MCP queue tools and the
// Queue page. Nothing here sends anything — every queued row still goes out
// only from the Queue page's Send button.
//
// AI drafts are queued immediately with draftStatus "pending" and drafted
// afterwards (generatePendingDrafts, run in after() by callers) — a batch of
// 50 Gemini calls is too slow to hold a request open for, and a pending row
// can't be sent until its draft lands.

import { and, eq, inArray, lt, max, or } from "drizzle-orm";
import { db } from "@/db";
import {
  agentInteractions,
  agents,
  listings,
  messagePresets,
  messagePresetVariants,
  messageSends,
  queuedMessages,
  type MessageChannel,
  type PresetType,
} from "@/db/schema";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
// The AI drafting lives in these server-action modules; called here as plain
// functions (they only read the DB and call the model, no revalidation).
import { draftAiPresetOption } from "@/app/messageActions";
import { draftAiEmailPresetOption } from "@/app/composeEmailActions";

export interface QueueTarget {
  listingId?: string;
  agentId?: string;
}

export interface QueueMessagesInput {
  targets: QueueTarget[];
  channel: MessageChannel;
  type: PresetType;
  /** A template preset. An AI-draft preset (or ai: true) drafts each message instead. */
  presetId?: string;
  /** Pin one variant; otherwise the preset's enabled variants are rotated through. */
  variantId?: string;
  ai?: boolean;
  aiInstruction?: string;
  /** Free-text body/subject instead of a template ({{firstName}}/{{street}}/{{city}} still filled in). */
  body?: string;
  subject?: string;
  /** When the first message becomes due (default now). */
  sendAfter?: Date;
  /** Minutes between consecutive messages' due times (default 0). */
  spacingMinutes?: number;
}

export interface QueueMessagesResult {
  queued: {
    id: string;
    agentName: string | null;
    listingAddress: string | null;
    sendAfter: Date;
    draftPending: boolean;
    missingRecipient: boolean;
    /** Any contact with this agent in the last 7 days — flagged, not skipped. */
    recentlyContacted: boolean;
    /** Already has another unsent queued message. */
    alreadyQueued: boolean;
  }[];
  skipped: { target: QueueTarget; reason: string }[];
  /** Ids still waiting on an AI draft — pass to generatePendingDrafts. */
  pendingDraftIds: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function queueMessages(input: QueueMessagesInput): Promise<QueueMessagesResult | { error: string }> {
  const result: QueueMessagesResult = { queued: [], skipped: [], pendingDraftIds: [] };
  if (input.targets.length === 0) return { error: "No listings or agents given" };

  // Resolve what to write: a template's variants, an AI draft, or free text.
  let preset: { id: string; aiGenerated: boolean; channel: MessageChannel } | null = null;
  if (input.presetId) {
    const [row] = await db
      .select({ id: messagePresets.id, aiGenerated: messagePresets.aiGenerated, channel: messagePresets.channel })
      .from(messagePresets)
      .where(eq(messagePresets.id, input.presetId));
    if (!row) return { error: "No template with that presetId" };
    if (row.channel !== input.channel) return { error: `That template is a ${row.channel} template, not ${input.channel}` };
    preset = row;
  }
  const ai = input.ai === true || preset?.aiGenerated === true;
  let variants: { id: string; subject: string | null; body: string }[] = [];
  if (!ai && preset) {
    variants = await db
      .select({ id: messagePresetVariants.id, subject: messagePresetVariants.subject, body: messagePresetVariants.body })
      .from(messagePresetVariants)
      .where(
        input.variantId
          ? and(eq(messagePresetVariants.id, input.variantId), eq(messagePresetVariants.presetId, preset.id))
          : and(eq(messagePresetVariants.presetId, preset.id), eq(messagePresetVariants.enabled, true))
      )
      .orderBy(messagePresetVariants.label);
    if (variants.length === 0) return { error: "That template has no enabled variants" };
  }
  if (!ai && !preset && !input.body?.trim()) return { error: "Give a presetId, ai: true, or a body" };
  if (input.channel === "email" && !ai && !preset && !input.subject?.trim()) return { error: "An email needs a subject" };

  // Resolve every target to an agent (and listing, when given).
  const listingIds = input.targets.map((t) => t.listingId).filter((id): id is string => !!id);
  const listingRows = listingIds.length
    ? await db
        .select({ id: listings.id, address: listings.address, city: listings.city, agentId: listings.agentId })
        .from(listings)
        .where(inArray(listings.id, listingIds))
    : [];
  const listingById = new Map(listingRows.map((l) => [l.id, l]));
  const agentIds = [
    ...new Set([
      ...input.targets.map((t) => t.agentId).filter((id): id is string => !!id),
      ...listingRows.map((l) => l.agentId).filter((id): id is string => !!id),
    ]),
  ];
  const agentRows = agentIds.length ? await db.select().from(agents).where(inArray(agents.id, agentIds)) : [];
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  const [sendTimes, interactionTimes, openQueued] = agentIds.length
    ? await Promise.all([
        db
          .select({ agentId: messageSends.agentId, at: max(messageSends.sentAt) })
          .from(messageSends)
          .where(inArray(messageSends.agentId, agentIds))
          .groupBy(messageSends.agentId),
        db
          .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
          .from(agentInteractions)
          .where(inArray(agentInteractions.agentId, agentIds))
          .groupBy(agentInteractions.agentId),
        db
          .select({ agentId: queuedMessages.agentId })
          .from(queuedMessages)
          .where(and(inArray(queuedMessages.agentId, agentIds), eq(queuedMessages.status, "queued"))),
      ])
    : [[], [], []];
  const recentCutoff = Date.now() - 7 * DAY_MS;
  const recent = new Set(
    [...sendTimes, ...interactionTimes]
      .filter((r) => r.agentId && r.at && new Date(r.at).getTime() > recentCutoff)
      .map((r) => r.agentId!)
  );
  const hasQueued = new Set(openQueued.map((r) => r.agentId));

  const start = input.sendAfter ?? new Date();
  const spacingMs = Math.max(0, input.spacingMinutes ?? 0) * 60_000;
  let index = 0;

  for (const target of input.targets) {
    const listing = target.listingId ? listingById.get(target.listingId) : undefined;
    if (target.listingId && !listing) {
      result.skipped.push({ target, reason: "listing not found" });
      continue;
    }
    const agent = agentById.get(target.agentId ?? listing?.agentId ?? "");
    if (!agent) {
      result.skipped.push({ target, reason: "no agent linked" });
      continue;
    }
    if (ai && !listing) {
      result.skipped.push({ target, reason: "AI drafts need a listing" });
      continue;
    }
    if (input.channel === "email" && agent.emailUnsubscribedAt) {
      result.skipped.push({ target, reason: "agent unsubscribed from email" });
      continue;
    }

    const variant = variants.length ? variants[index % variants.length] : null;
    const rawBody = variant?.body ?? input.body ?? "";
    const rawSubject = variant?.subject ?? input.subject ?? null;
    const sendAfter = new Date(start.getTime() + index * spacingMs);

    const [row] = await db
      .insert(queuedMessages)
      .values({
        agentId: agent.id,
        listingId: listing?.id ?? null,
        channel: input.channel,
        type: input.type,
        presetId: preset?.id ?? null,
        variantId: variant?.id ?? null,
        subject: ai ? null : rawSubject != null ? renderSubject(rawSubject, agent.name) : null,
        body: ai ? "" : renderMessageBody(rawBody, agent.name, listing?.address ?? null, listing?.city ?? null),
        draftStatus: ai ? "pending" : null,
        draftInstruction: ai ? input.aiInstruction?.trim() || null : null,
        sendAfter,
      })
      .returning({ id: queuedMessages.id });

    if (ai) result.pendingDraftIds.push(row.id);
    result.queued.push({
      id: row.id,
      agentName: agent.name,
      listingAddress: listing?.address ?? null,
      sendAfter,
      draftPending: ai,
      missingRecipient: input.channel === "email" ? !agent.email : !agent.phone,
      recentlyContacted: recent.has(agent.id),
      alreadyQueued: hasQueued.has(agent.id),
    });
    index++;
  }
  return result;
}

const DRAFT_CONCURRENCY = 4;

/**
 * Writes AI drafts into pending queued rows. With no ids, picks up any row
 * that's been pending for over 5 minutes (a draft run that died with its
 * function) — the Queue page calls it that way on load.
 */
export async function generatePendingDrafts(ids?: string[]): Promise<number> {
  const staleCutoff = new Date(Date.now() - 5 * 60_000);
  const rows = await db
    .select({
      id: queuedMessages.id,
      listingId: queuedMessages.listingId,
      channel: queuedMessages.channel,
      type: queuedMessages.type,
      instruction: queuedMessages.draftInstruction,
    })
    .from(queuedMessages)
    .where(
      ids
        ? and(inArray(queuedMessages.id, ids), or(eq(queuedMessages.draftStatus, "pending"), eq(queuedMessages.draftStatus, "failed")))
        : and(eq(queuedMessages.draftStatus, "pending"), lt(queuedMessages.createdAt, staleCutoff))
    );

  let drafted = 0;
  for (let i = 0; i < rows.length; i += DRAFT_CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + DRAFT_CONCURRENCY).map(async (row) => {
        try {
          if (!row.listingId) throw new Error("no listing");
          const instruction = row.instruction ?? undefined;
          const option =
            row.channel === "email"
              ? await draftAiEmailPresetOption(row.listingId, row.type, instruction)
              : await draftAiPresetOption(row.listingId, row.type, instruction);
          if (!option?.text?.trim()) throw new Error("empty draft");
          await db
            .update(queuedMessages)
            .set({
              body: option.text.trim(),
              subject: option.subject?.trim() || null,
              presetId: option.presetId,
              variantId: null,
              draftStatus: null,
            })
            // Only if it's still waiting — don't clobber a row deleted or
            // hand-written in the meantime.
            .where(and(eq(queuedMessages.id, row.id), eq(queuedMessages.status, "queued")));
          drafted++;
        } catch (err) {
          console.error("generatePendingDrafts: draft failed", row.id, err);
          await db.update(queuedMessages).set({ draftStatus: "failed" }).where(eq(queuedMessages.id, row.id));
        }
      })
    );
  }
  return drafted;
}

