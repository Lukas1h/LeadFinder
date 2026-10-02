import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { after } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  listings,
  messagePresets,
  messagePresetVariants,
  queuedMessages,
  MESSAGE_CHANNELS,
  PRESET_TYPES,
  QUEUED_MESSAGE_STATUSES,
} from "@/db/schema";
import { queueMessages, generatePendingDrafts } from "@/lib/queueMessages";
import { nextSendTime } from "@/lib/queue";
import { text, errorText } from "./shared";

// The message queue (see the queuedMessages table and the Queue page). These
// tools only ever write to the queue — there is deliberately no send tool:
// every queued message goes out only when Lukas presses Send on the Queue
// page, so nothing here can contact an agent.

const iso = z.string().datetime({ offset: true });

export function registerQueueTools(server: McpServer): void {
  server.registerTool(
    "list_message_templates",
    {
      title: "List message templates",
      description:
        "Lists every enabled text (sms) or email template with its variants, for picking a presetId to pass to queue_messages. AI-draft presets (aiGenerated: true) have no variants — queueing with one drafts each message individually with AI. Placeholders {{firstName}}, {{street}}, {{city}} are filled in per recipient.",
      inputSchema: { channel: z.enum(MESSAGE_CHANNELS).optional() },
    },
    async ({ channel }) => {
      const presets = await db
        .select({
          presetId: messagePresets.id,
          name: messagePresets.name,
          channel: messagePresets.channel,
          type: messagePresets.type,
          aiGenerated: messagePresets.aiGenerated,
          leadSection: messagePresets.leadSection,
        })
        .from(messagePresets)
        .where(
          and(
            eq(messagePresets.enabled, true),
            isNull(messagePresets.archivedAt),
            channel ? eq(messagePresets.channel, channel) : undefined
          )
        )
        .orderBy(asc(messagePresets.createdAt));
      const variants = presets.length
        ? await db
            .select({
              presetId: messagePresetVariants.presetId,
              variantId: messagePresetVariants.id,
              label: messagePresetVariants.label,
              subject: messagePresetVariants.subject,
              body: messagePresetVariants.body,
            })
            .from(messagePresetVariants)
            .where(
              and(
                inArray(
                  messagePresetVariants.presetId,
                  presets.map((p) => p.presetId)
                ),
                eq(messagePresetVariants.enabled, true)
              )
            )
        : [];
      return text(presets.map((p) => ({ ...p, variants: variants.filter((v) => v.presetId === p.presetId) })));
    }
  );

  server.registerTool(
    "queue_messages",
    {
      title: "Queue messages",
      description:
        "Queues one text or email per listing (or agent) for Lukas to send from the Queue page — it does NOT send anything. " +
        "Find the listings first with search_listings (any filters), then pass their ids here. " +
        "Pick the content with presetId (a template from list_message_templates; its variants are rotated across recipients), " +
        "an AI-draft preset or ai: true (each message drafted individually for its listing — queued right away as 'drafting' and filled in within a minute or two; can't be sent until then), " +
        "or a literal body (+ subject for email). Each listing's linked agent is the recipient. " +
        "Results flag agents contacted in the last 7 days and agents who already have a queued message — they're queued anyway, so tell Lukas about them.",
      inputSchema: {
        listingIds: z.array(z.string().uuid()).max(200).optional(),
        agentIds: z.array(z.string().uuid()).max(200).optional().describe("For messages not about a listing (templates/body only — AI drafts need a listing)"),
        channel: z.enum(MESSAGE_CHANNELS),
        type: z.enum(PRESET_TYPES).default("initial_outreach"),
        presetId: z.string().uuid().optional(),
        variantId: z.string().uuid().optional().describe("Use only this variant instead of rotating"),
        ai: z.boolean().optional(),
        aiInstruction: z.string().optional().describe("Extra steering for every AI draft, e.g. 'mention the price cut'"),
        body: z.string().optional(),
        subject: z.string().optional(),
        sendAfter: iso.optional().describe("When the first one becomes due (default now). Include the offset, e.g. -07:00 for Pacific. Due messages are still held to 8 AM–9 PM Pacific."),
        spacingMinutes: z.number().int().min(0).max(24 * 60).optional().describe("Minutes between consecutive messages' due times"),
      },
    },
    async (input) => {
      const targets = [
        ...(input.listingIds ?? []).map((listingId) => ({ listingId })),
        ...(input.agentIds ?? []).map((agentId) => ({ agentId })),
      ];
      const result = await queueMessages({
        ...input,
        targets,
        sendAfter: input.sendAfter ? new Date(input.sendAfter) : undefined,
      });
      if ("error" in result) return errorText(result.error);
      // Draft after responding — a big batch of model calls would otherwise
      // hold the request open for minutes.
      if (result.pendingDraftIds.length) after(() => generatePendingDrafts(result.pendingDraftIds));
      return text({
        queuedCount: result.queued.length,
        draftingCount: result.pendingDraftIds.length,
        recentlyContacted: result.queued.filter((q) => q.recentlyContacted).map((q) => q.agentName),
        alreadyQueued: result.queued.filter((q) => q.alreadyQueued).map((q) => q.agentName),
        missingRecipient: result.queued.filter((q) => q.missingRecipient).map((q) => q.agentName),
        skipped: result.skipped,
        queued: result.queued,
      });
    }
  );

  server.registerTool(
    "list_queue",
    {
      title: "List queued messages",
      description:
        "Lists queued messages (default: unsent ones), soonest due first, with recipient, listing, body, and draft status ('pending' = AI draft still being written, 'failed' = draft failed).",
      inputSchema: {
        status: z.enum(QUEUED_MESSAGE_STATUSES).default("queued"),
        agentId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    async ({ status, agentId, limit }) => {
      const rows = await db
        .select({
          id: queuedMessages.id,
          channel: queuedMessages.channel,
          type: queuedMessages.type,
          status: queuedMessages.status,
          draftStatus: queuedMessages.draftStatus,
          subject: queuedMessages.subject,
          body: queuedMessages.body,
          recipient: queuedMessages.recipient,
          sendAfter: queuedMessages.sendAfter,
          afterQueuedId: queuedMessages.afterQueuedId,
          delayMinutes: queuedMessages.delayMinutes,
          sentAt: queuedMessages.sentAt,
          agentId: queuedMessages.agentId,
          agentName: agents.name,
          agentPhone: agents.phone,
          agentEmail: agents.email,
          listingId: queuedMessages.listingId,
          listingAddress: listings.address,
        })
        .from(queuedMessages)
        .innerJoin(agents, eq(queuedMessages.agentId, agents.id))
        .leftJoin(listings, eq(queuedMessages.listingId, listings.id))
        .where(and(eq(queuedMessages.status, status), agentId ? eq(queuedMessages.agentId, agentId) : undefined))
        .orderBy(asc(queuedMessages.sendAfter))
        .limit(limit);
      return text(rows.map((r) => ({ ...r, dueAt: nextSendTime(r.sendAfter) })));
    }
  );

  server.registerTool(
    "update_queued_message",
    {
      title: "Edit a queued message",
      description:
        "Edits an unsent queued message. Only provided fields change. Writing a body by hand on an AI row ends its drafting. Set afterQueuedId + delayMinutes to make it wait until another queued message is sent, then become due that many minutes later.",
      inputSchema: {
        id: z.string().uuid(),
        body: z.string().optional(),
        subject: z.string().optional(),
        recipient: z.string().nullable().optional().describe("Phone/email override; null to use the agent's on file"),
        sendAfter: iso.optional(),
        afterQueuedId: z.string().uuid().nullable().optional(),
        delayMinutes: z.number().int().min(0).nullable().optional(),
      },
    },
    async ({ id, body, subject, recipient, sendAfter, afterQueuedId, delayMinutes }) => {
      const patch: Partial<typeof queuedMessages.$inferInsert> = {};
      if (body !== undefined) {
        if (!body.trim()) return errorText("Body can't be empty");
        patch.body = body.trim();
        patch.draftStatus = null;
      }
      if (subject !== undefined) patch.subject = subject.trim() || null;
      if (recipient !== undefined) patch.recipient = recipient?.trim() || null;
      if (sendAfter !== undefined) patch.sendAfter = new Date(sendAfter);
      if (afterQueuedId !== undefined) {
        if (afterQueuedId === id) return errorText("A message can't wait on itself");
        patch.afterQueuedId = afterQueuedId;
      }
      if (delayMinutes !== undefined) patch.delayMinutes = delayMinutes;
      if (Object.keys(patch).length === 0) return errorText("Nothing to change");

      const [row] = await db
        .update(queuedMessages)
        .set(patch)
        .where(and(eq(queuedMessages.id, id), eq(queuedMessages.status, "queued")))
        .returning();
      if (!row) return errorText("No unsent queued message with that id");
      return text(row);
    }
  );

  server.registerTool(
    "manage_queued_messages",
    {
      title: "Skip, requeue, delete, or redraft queued messages",
      description:
        "Bulk action on queued messages: 'skip' (keeps it, marked skipped), 'requeue' (puts a skipped one back), 'delete' (removes it), or 'redraft' (re-runs the AI draft for messages whose draft failed).",
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1).max(500),
        action: z.enum(["skip", "requeue", "delete", "redraft"]),
      },
    },
    async ({ ids, action }) => {
      if (action === "redraft") {
        await db
          .update(queuedMessages)
          .set({ draftStatus: "pending" })
          .where(and(inArray(queuedMessages.id, ids), eq(queuedMessages.draftStatus, "failed")));
        after(() => generatePendingDrafts(ids));
        return text({ redrafting: ids.length });
      }
      if (action === "delete") {
        const deleted = await db
          .delete(queuedMessages)
          .where(and(inArray(queuedMessages.id, ids), eq(queuedMessages.status, "queued")))
          .returning({ id: queuedMessages.id });
        const deletedSkipped = await db
          .delete(queuedMessages)
          .where(and(inArray(queuedMessages.id, ids), eq(queuedMessages.status, "skipped")))
          .returning({ id: queuedMessages.id });
        return text({ deleted: deleted.length + deletedSkipped.length });
      }
      const [from, to] = action === "skip" ? (["queued", "skipped"] as const) : (["skipped", "queued"] as const);
      const changed = await db
        .update(queuedMessages)
        .set({ status: to })
        .where(and(inArray(queuedMessages.id, ids), eq(queuedMessages.status, from)))
        .returning({ id: queuedMessages.id });
      return text({ changed: changed.length });
    }
  );
}
