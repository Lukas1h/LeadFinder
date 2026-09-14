/**
 * LeadFinder's MCP tools — lets a Claude agent search/import/edit agent
 * contacts, list email templates, find listings needing follow-up, and
 * send a compose-style email with a duplicate-contact check. Registered
 * against a fresh McpServer per request by src/app/api/mcp/route.ts.
 *
 * Deliberately does NOT import from any "use server" file
 * (composeEmailActions.ts, agents/actions.ts, etc.) even though this now
 * runs inside a real Next.js request (where revalidatePath would actually
 * work) — this module reimplements the same send-first-then-write-DB /
 * validate-then-insert patterns those files use, so it never touches (and
 * can't accidentally break) the routes/actions the web app and the
 * IMPORT_SHARE_SECRET Shortcut already depend on.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  listings,
  messagePresets,
  messagePresetVariants,
  messageSends,
  AGENT_RELATIONSHIP_STATUSES,
  type AgentRelationshipStatus,
} from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { getFollowUpAfterDays } from "@/lib/settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function normalizeContact(
  phoneInput?: string,
  emailInput?: string
): { error?: string; phone: string | null; email: string | null } {
  const phone = phoneInput?.trim() || null;
  const email = emailInput?.trim().toLowerCase() || null;
  if (!phone && !email) return { error: "Provide a phone or an email", phone: null, email: null };
  if (phone && phone.replace(/\D/g, "").length < 10) return { error: "Invalid phone number", phone: null, email: null };
  if (email && !EMAIL_RE.test(email)) return { error: "Invalid email address", phone: null, email: null };
  return { phone, email };
}

export function registerLeadFinderTools(server: McpServer): void {
  // --- read-only lookups ---

  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search LeadFinder's agent/realtor contacts by name, phone, or email substring, optionally filtered by relationship status. Returns up to `limit` matches.",
      inputSchema: {
        query: z.string().optional().describe("Substring to match against name, phone, or email"),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ query, relationshipStatus, limit }) => {
      const conditions = [];
      if (query) {
        const like = `%${query}%`;
        conditions.push(or(ilike(agents.name, like), ilike(agents.phone, like), ilike(agents.email, like)));
      }
      if (relationshipStatus) conditions.push(eq(agents.relationshipStatus, relationshipStatus));

      const rows = await db
        .select()
        .from(agents)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(agents.createdAt))
        .limit(limit);

      return text(rows);
    }
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent detail",
      description:
        "Full detail for one agent by id, phone, or email — the agent row, every listing tied to their phone, and their send history. Exactly one of id/phone/email must be given.",
      inputSchema: {
        id: z.string().uuid().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async ({ id, phone, email }) => {
      if (!id && !phone && !email) return errorText("Provide one of id, phone, or email");

      const condition = id ? eq(agents.id, id) : phone ? eq(agents.phone, phone) : eq(agents.email, email!);
      const [agent] = await db.select().from(agents).where(condition);
      if (!agent) return errorText("No agent found matching that id/phone/email");

      const agentListings = agent.phone
        ? await db.select().from(listings).where(eq(listings.agentPhone, agent.phone))
        : [];

      const history = await db
        .select({
          id: messageSends.id,
          presetName: messagePresets.name,
          channel: messageSends.channel,
          type: messageSends.type,
          sentAt: messageSends.sentAt,
          respondedAt: messageSends.respondedAt,
          result: messageSends.result,
        })
        .from(messageSends)
        .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
        .where(eq(messageSends.agentId, agent.id))
        .orderBy(desc(messageSends.sentAt));

      return text({ agent, listings: agentListings, sendHistory: history });
    }
  );

  server.registerTool(
    "check_contact_history",
    {
      title: "Check whether an agent has already been contacted",
      description:
        "Given an email or phone, reports whether this person is already a known agent and, if so, when they were last contacted and their send history — use this BEFORE send_agent_email to decide whether a duplicate-send warning is worth surfacing to the user.",
      inputSchema: {
        email: z.string().optional(),
        phone: z.string().optional(),
      },
    },
    async ({ email, phone }) => {
      if (!email && !phone) return errorText("Provide an email or phone");

      const condition =
        email && phone ? or(eq(agents.email, email), eq(agents.phone, phone)) : email ? eq(agents.email, email) : eq(agents.phone, phone!);
      const [agent] = await db.select().from(agents).where(condition);
      if (!agent) return text({ knownAgent: false });

      const history = await db
        .select({
          presetName: messagePresets.name,
          channel: messageSends.channel,
          sentAt: messageSends.sentAt,
          result: messageSends.result,
        })
        .from(messageSends)
        .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
        .where(eq(messageSends.agentId, agent.id))
        .orderBy(desc(messageSends.sentAt));

      return text({
        knownAgent: true,
        agent: {
          id: agent.id,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
          relationshipStatus: agent.relationshipStatus,
          lastContactedAt: agent.lastContactedAt,
        },
        priorSends: history,
      });
    }
  );

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

  // --- writes ---

  server.registerTool(
    "import_agent",
    {
      title: "Import a new agent",
      description: "Creates a new agent contact. Fails if the phone or email already belongs to an existing agent.",
      inputSchema: {
        name: z.string(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).default("cold"),
      },
    },
    async ({ name, phone, email, notes, relationshipStatus }) => {
      const parsed = normalizeContact(phone, email);
      if (parsed.error) return errorText(parsed.error);

      if (parsed.phone) {
        const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, parsed.phone));
        if (existing) return errorText(`An agent with this phone already exists (id ${existing.id})`);
      }
      if (parsed.email) {
        const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, parsed.email));
        if (existing) return errorText(`An agent with this email already exists (id ${existing.id})`);
      }

      const [inserted] = await db
        .insert(agents)
        .values({
          name: name.trim() || null,
          phone: parsed.phone,
          email: parsed.email,
          notes: notes?.trim() || null,
          relationshipStatus,
        })
        .returning();

      return text(inserted);
    }
  );

  server.registerTool(
    "update_agent",
    {
      title: "Update an agent",
      description: "Edits an existing agent's name, phone, email, notes, or relationship status. Only provided fields change.",
      inputSchema: {
        id: z.string().uuid(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).optional(),
      },
    },
    async ({ id, name, phone, email, notes, relationshipStatus }) => {
      const [existing] = await db.select().from(agents).where(eq(agents.id, id));
      if (!existing) return errorText("No agent with that id");

      const patch: Partial<typeof agents.$inferInsert> = {};
      if (name !== undefined) patch.name = name.trim() || null;
      if (notes !== undefined) patch.notes = notes.trim() || null;
      if (relationshipStatus !== undefined) patch.relationshipStatus = relationshipStatus as AgentRelationshipStatus;
      if (phone !== undefined || email !== undefined) {
        const parsed = normalizeContact(phone ?? existing.phone ?? undefined, email ?? existing.email ?? undefined);
        if (parsed.error) return errorText(parsed.error);
        patch.phone = parsed.phone;
        patch.email = parsed.email;
      }

      const [updated] = await db.update(agents).set(patch).where(eq(agents.id, id)).returning();
      return text(updated);
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
