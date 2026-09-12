"use server";

import { db } from "@/db";
import {
  agents,
  listings,
  messageSends,
  messagePresets,
  type Agent,
  type Listing,
  type AgentRelationshipStatus,
  type MessageChannel,
  type PresetType,
  type MessageResult,
} from "@/db/schema";
import { eq, isNotNull, sql, desc, and, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Idempotent — inserts an Agent row for every unique agentPhone found
 * across all listings that doesn't already have one. Never overwrites an
 * existing row, so it's safe to call on every page load (existing manual
 * edits/imports are untouched). If a phone's listings include one that's
 * currently "declined", the new row is seeded already-declined (using that
 * listing's statusChangedAt) so it starts in the right section immediately
 * instead of waiting for the next status change to touch it.
 */
export async function ensureAgentsBackfilled() {
  const rows = await db
    .select({
      agentPhone: listings.agentPhone,
      agentName: listings.agentName,
      status: listings.status,
      statusChangedAt: listings.statusChangedAt,
    })
    .from(listings)
    .where(isNotNull(listings.agentPhone));

  const byPhone = new Map<string, { name: string | null; declinedAt: Date | null }>();
  for (const r of rows) {
    const phone = r.agentPhone;
    if (!phone) continue;
    const existing = byPhone.get(phone) ?? { name: null, declinedAt: null };
    if (!existing.name && r.agentName) existing.name = r.agentName;
    if (r.status === "declined" && r.statusChangedAt) {
      if (!existing.declinedAt || r.statusChangedAt > existing.declinedAt) {
        existing.declinedAt = r.statusChangedAt;
      }
    }
    byPhone.set(phone, existing);
  }

  if (byPhone.size === 0) return;

  const existingAgents = await db.select({ phone: agents.phone }).from(agents);
  const existingPhones = new Set(existingAgents.map((a) => a.phone));

  const toInsert = [...byPhone.entries()]
    .filter(([phone]) => !existingPhones.has(phone))
    .map(([phone, data]) => ({ phone, name: data.name, declinedAt: data.declinedAt }));

  if (toInsert.length > 0) {
    await db.insert(agents).values(toInsert);
  }
}

export async function updateAgentRelationshipStatus(id: string, status: AgentRelationshipStatus) {
  await db.update(agents).set({ relationshipStatus: status }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

/** Clears declinedAt — moves an agent back out of the declined section. */
export async function reconnectAgent(id: string) {
  await db.update(agents).set({ declinedAt: null }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

/** Manually flag an agent declined, for imported agents with no listing to infer it from. */
export async function markAgentDeclined(id: string) {
  await db.update(agents).set({ declinedAt: new Date() }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

export async function updateAgentNotes(id: string, notes: string) {
  await db.update(agents).set({ notes: notes.trim() || null }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactInfoResult {
  error?: string;
  phone?: string | null;
  email?: string | null;
}

/** Shared by importAgent and updateAgentContactInfo — at least one of phone/email required, both format-checked. */
function parseContactInfo(phoneInput: string, emailInput: string): ContactInfoResult {
  const trimmedPhone = phoneInput.trim();
  const trimmedEmail = emailInput.trim().toLowerCase();
  if (!trimmedPhone && !trimmedEmail) return { error: "Enter a phone number or an email" };

  let phone: string | null = null;
  if (trimmedPhone) {
    phone = normalizePhone(trimmedPhone);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Enter a valid phone number" };
  }
  let email: string | null = null;
  if (trimmedEmail) {
    if (!EMAIL_RE.test(trimmedEmail)) return { error: "Enter a valid email address" };
    email = trimmedEmail;
  }

  return { phone, email };
}

export async function importAgent(input: {
  name: string;
  phone: string;
  email: string;
  relationshipStatus: AgentRelationshipStatus;
}) {
  const parsed = parseContactInfo(input.phone, input.email);
  if (parsed.error) return { error: parsed.error };
  const { phone, email } = parsed;

  if (phone) {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, phone));
    if (existing) return { error: "An agent with this phone number already exists" };
  }
  if (email) {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email));
    if (existing) return { error: "An agent with this email already exists" };
  }

  await db.insert(agents).values({
    phone,
    email,
    name: input.name.trim() || null,
    relationshipStatus: input.relationshipStatus,
  });

  revalidatePath("/agents");
  return { error: null };
}

/** Edits an existing agent's name/phone/email — from the "Edit" control in AgentDetailDialog. */
export async function updateAgentContactInfo(
  id: string,
  input: { name: string; phone: string; email: string }
): Promise<{ error: string | null }> {
  const parsed = parseContactInfo(input.phone, input.email);
  if (parsed.error) return { error: parsed.error };
  const { phone, email } = parsed;

  if (phone) {
    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.phone, phone), ne(agents.id, id)));
    if (existing) return { error: "Another agent already has this phone number" };
  }
  if (email) {
    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.email, email), ne(agents.id, id)));
    if (existing) return { error: "Another agent already has this email" };
  }

  await db
    .update(agents)
    .set({ name: input.name.trim() || null, phone, email })
    .where(eq(agents.id, id));

  revalidatePath("/agents");
  return { error: null };
}

export interface AgentWithListings {
  agent: Agent;
  listings: Listing[];
}

/**
 * Looks up an agent by phone for the AgentRow component (the listing
 * detail modal's agent reference, and the booking detail dialog's contact
 * reference) — creates a bare row if one doesn't exist yet, same
 * lazy-upsert reasoning as ensureAgentsBackfilled above, so clicking one
 * of those rows always opens something instead of erroring just because
 * the Agents tab hasn't been visited since this phone first showed up.
 */
export async function getOrCreateAgentByPhone(
  phone: string,
  name: string | null
): Promise<AgentWithListings | null> {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return null;

  let [agent] = await db.select().from(agents).where(eq(agents.phone, trimmedPhone));
  if (!agent) {
    [agent] = await db
      .insert(agents)
      .values({ phone: trimmedPhone, name: name?.trim() || null })
      .returning();
  }
  if (!agent) return null;

  const agentListings = await db.select().from(listings).where(eq(listings.agentPhone, trimmedPhone));

  return { agent, listings: agentListings };
}

/** Total distinct listings sourced from each agent phone — shown on the agent card. */
export async function listingCountsByPhone(): Promise<Record<string, number>> {
  const rows = await db
    .select({ phone: listings.agentPhone, count: sql<number>`count(*)::int` })
    .from(listings)
    .where(isNotNull(listings.agentPhone))
    .groupBy(listings.agentPhone);

  const result: Record<string, number> = {};
  for (const r of rows) {
    if (r.phone) result[r.phone] = r.count;
  }
  return result;
}

export interface AgentSendHistoryItem {
  id: string;
  presetName: string;
  channel: MessageChannel;
  type: PresetType;
  sentAt: Date;
  respondedAt: Date | null;
  result: MessageResult;
}

/** Every SMS/email logged against this agent (any listing, or none — see the cold-email Compose flow), newest first. */
export async function getAgentSendHistory(agentId: string): Promise<AgentSendHistoryItem[]> {
  return db
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
    .where(eq(messageSends.agentId, agentId))
    .orderBy(desc(messageSends.sentAt));
}
