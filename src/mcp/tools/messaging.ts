import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings, messagePresets, messagePresetVariants, messageSends } from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { getFollowUpAfterDays } from "@/lib/settings";
import { text, errorText, EMAIL_RE } from "./shared";

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
      const now = Date.now();
      const cutoff = new Date(now - followUpAfterDays * 24 * 60 * 60 * 1000);

      const all = await db.select().from(listings);
      const automatic = all.filter((l) => l.status === "contacted" && l.contactedAt != null && l.contactedAt <= cutoff);
      const manual = all.filter(
        (l) => l.status !== "booked" && l.status !== "declined" && l.followUpAt != null && l.followUpAt.getTime() <= now
      );

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
      const name = agentName.trim();
      const email = agentEmail.trim().toLowerCase();
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
}
