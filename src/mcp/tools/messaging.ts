import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings, messagePresets, messagePresetVariants, messageSends } from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { getFollowUpAfterDays } from "@/lib/settings";
import { text, errorText, EMAIL_RE } from "./shared";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/normalize";

interface BulkSendResult {
  name: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  agentId?: string;
}

interface BulkSendVariant {
  subject: string | null;
  body: string;
  type: (typeof messagePresets.$inferSelect)["type"];
  attachments: (typeof messagePresets.$inferSelect)["attachments"];
}

/**
 * One contact's worth of the send_agent_email flow, minus the interactive
 * needsConfirmation step (a bulk caller can't answer a confirmation prompt
 * per row) — instead an already-contacted agent is silently skipped, same
 * as /api/compose/cold-outreach. Also reuses that route's phone-collision
 * fallback: agents.phone is unique, and it's a real case in this app's own
 * data for two agents at the same brokerage to share one office line.
 */
async function sendBulkTemplateEmail(
  contact: { name: string; email: string; phone?: string },
  variant: BulkSendVariant,
  presetId: string,
  variantId: string,
  skipAlreadyContacted: boolean
): Promise<BulkSendResult> {
  const name = contact.name.trim() ? normalizeName(contact.name) : "";
  const email = normalizeEmail(contact.email);
  const phone = contact.phone?.trim() ? normalizePhone(contact.phone) : null;
  if (!name) return { name: contact.name, email, status: "failed", reason: "name is required" };
  if (!EMAIL_RE.test(email)) return { name, email, status: "failed", reason: "invalid email address" };

  const [existingAgent] = await db.select().from(agents).where(eq(agents.email, email));
  if (existingAgent?.lastContactedAt && skipAlreadyContacted) {
    return { name, email, status: "skipped", reason: "already contacted", agentId: existingAgent.id };
  }

  const subject = renderSubject(variant.subject ?? "", name);
  const body = renderMessageBody(variant.body, name, null);

  try {
    await sendEmail({ to: email, toName: name, subject, text: body, attachments: variant.attachments });
  } catch (err) {
    return { name, email, status: "failed", reason: `SMTP send failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const now = new Date();
  let agentId: string;
  try {
    if (existingAgent) {
      await db
        .update(agents)
        .set({ name, lastContactedAt: now, phone: existingAgent.phone ?? phone })
        .where(eq(agents.id, existingAgent.id));
      agentId = existingAgent.id;
    } else {
      const [inserted] = await db.insert(agents).values({ email, name, phone, lastContactedAt: now }).returning({ id: agents.id });
      agentId = inserted.id;
    }
  } catch {
    // Likely a phone unique-constraint collision (two agents sharing one
    // office line happens for real in this data) — retry without phone
    // rather than losing/failing an already-sent email.
    if (existingAgent) {
      await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, existingAgent.id));
      agentId = existingAgent.id;
    } else {
      const [inserted] = await db.insert(agents).values({ email, name, phone: null, lastContactedAt: now }).returning({ id: agents.id });
      agentId = inserted.id;
    }
  }

  await db.insert(messageSends).values({
    listingId: null,
    agentId,
    presetId,
    variantId,
    type: variant.type,
    channel: "email",
    sentAt: now,
  });

  return { name, email, status: "sent", agentId };
}

export function registerMessagingTools(server: McpServer): void {
  server.registerTool(
    "list_email_templates",
    {
      title: "List email templates",
      description:
        "Lists every enabled email preset and its variants (subject/body, with {{firstName}} placeholders) plus any file attachments — pick one of these before calling send_agent_email.",
      inputSchema: {},
    },
    async () => {
      const rows = await db
        .select({
          presetId: messagePresets.id,
          presetName: messagePresets.name,
          type: messagePresets.type,
          attachments: messagePresets.attachments,
          variantId: messagePresetVariants.id,
          label: messagePresetVariants.label,
          subject: messagePresetVariants.subject,
          body: messagePresetVariants.body,
        })
        .from(messagePresetVariants)
        .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
        .where(and(eq(messagePresets.channel, "email"), eq(messagePresets.enabled, true), eq(messagePresetVariants.enabled, true)))
        .orderBy(messagePresets.createdAt);

      return text(rows);
    }
  );

  server.registerTool(
    "list_followup_listings",
    {
      title: "List listings needing follow-up",
      description:
        "Listings that are 'contacted' and have gone quiet past the configured follow-up window, plus any with a manually-set follow-up date that has arrived — the same set the Pipeline page's 'Needs follow-up' sections show.",
      inputSchema: {},
    },
    async () => {
      const followUpAfterDays = await getFollowUpAfterDays();
      const now = new Date();
      const cutoff = new Date(now.getTime() - followUpAfterDays * 24 * 60 * 60 * 1000);

      // Filtered in SQL, not fetched-then-filtered-in-JS — this used to
      // pull every listing (photos arrays included) on every call with no
      // WHERE clause at all, which was a real contributor to a Neon
      // data-transfer overage. The two branches below return the same rows
      // the old JS filter did, just without transferring the rest of the
      // table to throw away.
      const [automatic, manual] = await Promise.all([
        db
          .select()
          .from(listings)
          .where(and(eq(listings.status, "contacted"), isNotNull(listings.contactedAt), lte(listings.contactedAt, cutoff))),
        db
          .select()
          .from(listings)
          .where(
            and(
              ne(listings.status, "booked"),
              ne(listings.status, "declined"),
              isNotNull(listings.followUpAt),
              lte(listings.followUpAt, now)
            )
          ),
      ]);

      return text({ followUpAfterDays, automatic, manual });
    }
  );

  server.registerTool(
    "send_agent_email",
    {
      title: "Send a compose-style email to an agent",
      description:
        "Sends an email using one of list_email_templates' variants (subject/body auto-rendered with the agent's first name), then saves the agent's contact info and logs the send — same behavior as the app's Compose flow. " +
        "If this agent has been emailed before and confirmDuplicate isn't set to true, this returns needsConfirmation instead of sending — surface that to the user and only retry with confirmDuplicate: true once they say to proceed.",
      inputSchema: {
        agentName: z.string(),
        agentEmail: z.string(),
        presetId: z.string().uuid(),
        variantId: z.string().uuid(),
        subjectOverride: z.string().optional(),
        bodyOverride: z.string().optional(),
        confirmDuplicate: z.boolean().default(false),
      },
    },
    async ({ agentName, agentEmail, presetId, variantId, subjectOverride, bodyOverride, confirmDuplicate }) => {
      const name = agentName.trim() ? normalizeName(agentName) : "";
      const email = normalizeEmail(agentEmail);
      if (!name) return errorText("agentName is required");
      if (!EMAIL_RE.test(email)) return errorText("agentEmail is not a valid address");

      const [variant] = await db
        .select({
          subject: messagePresetVariants.subject,
          body: messagePresetVariants.body,
          type: messagePresets.type,
          attachments: messagePresets.attachments,
        })
        .from(messagePresetVariants)
        .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
        .where(and(eq(messagePresetVariants.id, variantId), eq(messagePresetVariants.presetId, presetId)));
      if (!variant) return errorText("No such presetId/variantId pair");

      const [existingAgent] = await db.select().from(agents).where(eq(agents.email, email));
      if (existingAgent && !confirmDuplicate) {
        const priorSends = await db
          .select({ sentAt: messageSends.sentAt, channel: messageSends.channel, result: messageSends.result })
          .from(messageSends)
          .where(eq(messageSends.agentId, existingAgent.id))
          .orderBy(desc(messageSends.sentAt));
        if (existingAgent.lastContactedAt || priorSends.length > 0) {
          return text({
            needsConfirmation: true,
            reason: "This agent has already been contacted — confirm with the user before retrying with confirmDuplicate: true.",
            agent: {
              id: existingAgent.id,
              name: existingAgent.name,
              relationshipStatus: existingAgent.relationshipStatus,
              lastContactedAt: existingAgent.lastContactedAt,
            },
            priorSends,
          });
        }
      }

      const subject = subjectOverride ?? renderSubject(variant.subject ?? "", name);
      const body = bodyOverride ?? renderMessageBody(variant.body, name, null);
      if (!subject.trim()) return errorText("Subject is empty — pass subjectOverride or use a preset with a subject");
      if (!body.trim()) return errorText("Body is empty");

      try {
        await sendEmail({ to: email, toName: name, subject, text: body, attachments: variant.attachments });
      } catch (err) {
        return errorText(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const now = new Date();
      let agentId: string;
      if (existingAgent) {
        await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, existingAgent.id));
        agentId = existingAgent.id;
      } else {
        const [inserted] = await db.insert(agents).values({ email, name, lastContactedAt: now }).returning({ id: agents.id });
        agentId = inserted.id;
      }

      const [send] = await db
        .insert(messageSends)
        .values({ listingId: null, agentId, presetId, variantId, type: variant.type, channel: "email", sentAt: now })
        .returning({ id: messageSends.id });

      return text({ sent: true, agentId, messageSendId: send.id, subject, body });
    }
  );

  server.registerTool(
    "send_bulk_agent_emails",
    {
      title: "Bulk-send a template email to a list of agents",
      description:
        "Sends one email template (from list_email_templates) to a whole list of contacts in one call — e.g. a brokerage roster collected as name/email/phone rows. Same per-contact behavior as send_agent_email (render, send, save the agent, log the send), but without an interactive duplicate-confirmation step: an agent already marked contacted is silently skipped unless skipAlreadyContacted is set to false. One contact failing (bad address, SMTP error) doesn't stop the rest. " +
        "Capped at 40 contacts per call to stay inside the server's time budget — for a longer list, call this again with the next slice.",
      inputSchema: {
        presetId: z.string().uuid(),
        variantId: z.string().uuid(),
        contacts: z
          .array(
            z.object({
              name: z.string(),
              email: z.string(),
              phone: z.string().optional(),
            })
          )
          .min(1)
          .max(40),
        skipAlreadyContacted: z
          .boolean()
          .default(true)
          .describe("Skip (don't resend to) any contact whose email is already marked contacted — recommended for re-running a partial batch."),
      },
    },
    async ({ presetId, variantId, contacts, skipAlreadyContacted }) => {
      const [variant] = await db
        .select({
          subject: messagePresetVariants.subject,
          body: messagePresetVariants.body,
          type: messagePresets.type,
          attachments: messagePresets.attachments,
        })
        .from(messagePresetVariants)
        .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
        .where(and(eq(messagePresetVariants.id, variantId), eq(messagePresetVariants.presetId, presetId)));
      if (!variant) return errorText("No such presetId/variantId pair");

      const results: BulkSendResult[] = [];
      for (const contact of contacts) {
        results.push(await sendBulkTemplateEmail(contact, variant, presetId, variantId, skipAlreadyContacted));
      }

      const sent = results.filter((r) => r.status === "sent").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed").length;

      return text({ total: contacts.length, sent, skipped, failed, results });
    }
  );
}
