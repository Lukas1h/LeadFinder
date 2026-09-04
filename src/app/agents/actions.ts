"use server";

import { db } from "@/db";
import { agents, listings, type AgentRelationshipStatus } from "@/db/schema";
import { eq, isNotNull, sql } from "drizzle-orm";
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

function normalizePhone(phone: string): string {
  return phone.trim();
}

export async function importAgent(input: {
  name: string;
  phone: string;
  relationshipStatus: AgentRelationshipStatus;
}) {
  const phone = normalizePhone(input.phone);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return { error: "Enter a valid phone number" };

  const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, phone));
  if (existing) return { error: "An agent with this phone number already exists" };

  await db.insert(agents).values({
    phone,
    name: input.name.trim() || null,
    relationshipStatus: input.relationshipStatus,
  });

  revalidatePath("/agents");
  return { error: null };
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
