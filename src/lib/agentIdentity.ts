import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { normalizeName, normalizePhone } from "./normalize";

/**
 * Find-or-create for the agent behind a listing, matching on name as well as
 * phone.
 *
 * The call sites here used to upsert with `target: agents.phone` alone, which
 * meant a contact that arrived email-first (a cold-email import, which has no
 * phone) could never be matched by a listing, which only ever carries a phone.
 * Every such collision inserted a second row, so the same realtor existed twice
 * — once with an email and the whole send history, once with a phone and none
 * of it — and the app, joining listings to agents on phone, saw only the empty
 * one. That's how Lukas ended up emailing people he was already mid-conversation
 * with: 24 split identities, 6 of them contacted twice, before this was fixed.
 *
 * Matching on a normalized name is only safe when it's unambiguous. Two real
 * realtors sharing a name is entirely plausible in one market (there were two
 * plausible-looking cases among those 24), so a name that hits more than one row
 * creates a phone-keyed row instead of guessing and fusing two different people
 * — a split identity is recoverable, a bad merge isn't.
 *
 * Returns null when there's nothing to key a record on: a name with no phone
 * that matches nobody on file would only produce a contactless row nobody can
 * ever reach.
 */
export async function resolveAgentId(
  agentPhone: string | null,
  agentName: string | null,
  patch: Partial<typeof agents.$inferInsert> = {}
): Promise<string | null> {
  const phone = agentPhone ? normalizePhone(agentPhone) : null;
  const name = agentName ? normalizeName(agentName) : null;
  if (!phone && !name) return null;

  if (phone) {
    const [byPhone] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, phone));
    if (byPhone) {
      // Skipped entirely when there's nothing new to write. A caller that only
      // wants the id (ensureAgentsBackfilled resolving a listing's agent, say)
      // passes no patch and often no name, and Drizzle rejects an empty set()
      // outright rather than treating it as the no-op it is.
      const changes = { ...patch, ...(name ? { name } : {}) };
      if (Object.keys(changes).length > 0) {
        await db.update(agents).set(changes).where(eq(agents.id, byPhone.id));
      }
      return byPhone.id;
    }
  }

  if (name) {
    const sameName = await db
      .select({ id: agents.id, phone: agents.phone })
      .from(agents)
      .where(eq(sql`lower(trim(${agents.name}))`, name.trim().toLowerCase()));

    if (sameName.length === 1) {
      const existing = sameName[0];
      const changes = { ...patch, ...(!existing.phone && phone ? { phone } : {}) };
      if (Object.keys(changes).length > 0) {
        await db.update(agents).set(changes).where(eq(agents.id, existing.id));
      }
      return existing.id;
    }
  }

  if (!phone) return null;

  const onConflict = { ...patch, ...(name ? { name } : {}) };
  const [inserted] = await db
    .insert(agents)
    .values({ phone, name, ...patch })
    // ON CONFLICT still has to set something even when there's nothing to
    // change, so fall back to rewriting the phone with itself.
    .onConflictDoUpdate({
      target: agents.phone,
      set: Object.keys(onConflict).length > 0 ? onConflict : { phone },
    })
    .returning({ id: agents.id });
  return inserted?.id ?? null;
}

/**
 * Resolves the agent for a listing and stores the link on the listing itself,
 * so later reads follow listings.agentId instead of re-deriving the agent from
 * the phone string every time. Called from the sync/import path, where a
 * listing's agent details first become known.
 */
export async function linkListingToAgent(
  listingId: string,
  agentPhone: string | null,
  agentName: string | null
): Promise<string | null> {
  const agentId = await resolveAgentId(agentPhone, agentName);
  if (agentId) {
    await db.update(listings).set({ agentId }).where(eq(listings.id, listingId));
  }
  return agentId;
}
