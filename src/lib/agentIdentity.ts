import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, listings, messageSends } from "@/db/schema";
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

/**
 * Marks an agent's most recent prior send as having been replied to.
 *
 * respondedAt was previously only reachable through resolveSendOutcome, which
 * finds sends by listingId and is driven off the listing pipeline. That works
 * for the 71 sends attached to a property and cannot work at all for the 5,146
 * cold emails sent to an agent directly, which carry no listing — so no
 * agent-level send had ever been marked replied, and the messaging page's
 * response rate was really measuring how often a listing got moved to
 * "replied".
 *
 * An inbound interaction is exactly that signal for the agent path: they got
 * back to you. Stamps the latest send that predates the reply, and only when
 * it's still unset, since respondedAt records the first response and nothing
 * after it. A reply with no prior send (someone reaching out cold) matches
 * nothing and is a no-op.
 */
export async function markLatestSendResponded(agentId: string, respondedAt: Date): Promise<string | null> {
  const [latest] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(
      and(
        eq(messageSends.agentId, agentId),
        lte(messageSends.sentAt, respondedAt),
        isNull(messageSends.respondedAt)
      )
    )
    .orderBy(desc(messageSends.sentAt))
    .limit(1);

  if (!latest) return null;
  await db.update(messageSends).set({ respondedAt }).where(eq(messageSends.id, latest.id));
  return latest.id;
}

/**
 * Credits a booking to the outreach that won it, and marks that send booked.
 *
 * Revenue attribution used to run listing -> booking, which needs the job to be
 * tied to a tracked property. Every booking so far was arranged directly with
 * an agent and carries no listing, so nothing could be credited and the
 * messaging page's per-variant revenue was structurally zero.
 *
 * Picks the agent's most recent send before the job was booked. That's a
 * judgment, not a fact — a repeat client might book with no outreach involved —
 * so it only looks back a bounded window, and a booking with no send behind it
 * in that window is left unattributed rather than credited to something stale.
 */
const ATTRIBUTION_WINDOW_DAYS = 120;

export async function attributeBookingToSend(
  bookingId: string,
  agentId: string | null,
  bookedAt: Date
): Promise<string | null> {
  if (!agentId) return null;

  const cutoff = new Date(bookedAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [latest] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(
      and(
        eq(messageSends.agentId, agentId),
        lte(messageSends.sentAt, bookedAt),
        gte(messageSends.sentAt, cutoff)
      )
    )
    .orderBy(desc(messageSends.sentAt))
    .limit(1);

  if (!latest) return null;

  await db.update(bookings).set({ messageSendId: latest.id }).where(eq(bookings.id, bookingId));
  // Booking is the strongest outcome a send can have, so it overwrites whatever
  // the result was before.
  await db.update(messageSends).set({ result: "booked" }).where(eq(messageSends.id, latest.id));
  return latest.id;
}
