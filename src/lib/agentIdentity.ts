import { and, desc, eq, gt, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, listings, messagePresets, messageSends, type AgentRelationshipStatus } from "@/db/schema";
import { normalizeEmail, normalizeName, normalizePhone } from "./normalize";

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
    const [byPhone] = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.phone, phone));
    if (byPhone) {
      // Skipped entirely when there's nothing new to write. A caller that only
      // wants the id (ensureAgentsBackfilled resolving a listing's agent, say)
      // passes no patch and often no name, and Drizzle rejects an empty set()
      // outright rather than treating it as the no-op it is.
      //
      // A listing only fills in a missing name. Listing feeds name teams
      // ("DeAnna & Dyan" for Dyan Lane), and renaming someone Lukas knows by
      // name makes them hard to find.
      const changes = { ...patch, ...(name && !byPhone.name ? { name } : {}) };
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
  agentName: string | null,
  agentEmail: string | null = null
): Promise<string | null> {
  const phone = agentPhone ? normalizePhone(agentPhone) : null;
  const email = agentEmail ? normalizeEmail(agentEmail) : null;

  // An email (from a Compass lookup) can find the record a cold-email import
  // already made for this person, with its whole send history. A phone match
  // still wins, the same as resolveAgentId: the email-only record only takes
  // the listing when nobody on file has the phone yet.
  let agentId: string | null = null;
  if (email) {
    const [byPhone] = phone ? await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, phone)) : [];
    const [byEmail] = await db.select({ id: agents.id, phone: agents.phone }).from(agents).where(eq(agents.email, email));
    if (!byPhone && byEmail) {
      agentId = byEmail.id;
      if (!byEmail.phone && phone) await db.update(agents).set({ phone }).where(eq(agents.id, byEmail.id));
    }
  }

  agentId ??= await resolveAgentId(agentPhone, agentName);
  if (agentId) {
    await db.update(listings).set({ agentId }).where(eq(listings.id, listingId));
    if (email) {
      const [taken] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email));
      if (!taken) {
        await db.update(agents).set({ email }).where(and(eq(agents.id, agentId), isNull(agents.email)));
      }
    }
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
 * Sets an agent's relationship status and keeps declinedAt in step with it.
 *
 * declinedAt is not a mirror of the status — it's what puts someone in the
 * Agents tab's declined section, what search_agents(declinedOnly) matches on,
 * and what the 30-day resurface keys its timer off. Every writer used to set
 * relationshipStatus on its own and never touch declinedAt, so an agent marked
 * declined through the detail dialog or an MCP update_agent call was declined
 * in name only: absent from every query that looks for declined agents, and
 * from the 30-day bring-back. The backfill that used to write the column got
 * its values from touchAgentDeclined, which no longer exists, so nothing was
 * stamping it at all.
 *
 * One helper rather than a rule repeated per call site, because that repetition
 * is what let the two drift apart in the first place.
 *
 * Stamped on the way in and only when unset, so re-saving an already-declined
 * agent doesn't restart the resurface clock; cleared on the way out, because
 * someone you've un-declined shouldn't still be sitting in the declined bucket.
 */
export async function setAgentRelationshipStatus(
  agentId: string,
  status: AgentRelationshipStatus
): Promise<void> {
  await db
    .update(agents)
    .set({
      relationshipStatus: status,
      declinedAt: status === "declined" ? sql`COALESCE(${agents.declinedAt}, now())` : null,
    })
    .where(eq(agents.id, agentId));
}

/**
 * Credits a booking to the outreach that won it, and marks that send booked.
 *
 * Revenue attribution used to run listing -> booking, which needs the job to be
 * tied to a tracked property. Every booking so far was arranged directly with
 * an agent and carries no listing, so nothing could be credited and the
 * messaging page's per-variant revenue was structurally zero.
 *
 * Picks the agent's most recent send before the job was booked, with two
 * exceptions (2026-10-21, after Roxanne Wergeland's booking was credited to
 * her samples email rather than the "Coming Soon" text that won her):
 *
 * - Quick actions (samples, pricing sheet, contact card: the templates offered
 *   as replies, messagePresets.quickActionPresetIds) answer a request; they
 *   don't win anyone. The usual run is opener -> "send samples" -> booking,
 *   so crediting the latest send credited the samples email every time. They
 *   only get the credit when nothing else was sent.
 * - Only sends after the agent's previous booking count. A repeat job is the
 *   client coming back, not the old cold email working twice. Bookings made
 *   within a day of each other (two properties from one conversation) are
 *   the same win and share the credit.
 *
 * Still a judgment, so it looks back a bounded window, and a booking with no
 * send behind it is left unattributed rather than credited to something stale.
 * Safe to rerun: a send that loses its last booking goes back to pending.
 */
const ATTRIBUTION_WINDOW_DAYS = 120;
const SAME_WIN_MS = 24 * 60 * 60 * 1000;

export async function attributeBookingToSend(
  bookingId: string,
  agentId: string | null,
  bookedAt: Date
): Promise<string | null> {
  if (!agentId) return null;
  // Booked now for a job days away: the sends that count are the ones before today.
  const at = new Date(Math.min(bookedAt.getTime(), Date.now()));

  const [previous] = await db
    .select({ createdAt: bookings.createdAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.contactAgentId, agentId),
        lt(bookings.createdAt, new Date(at.getTime() - SAME_WIN_MS)),
        ne(bookings.id, bookingId)
      )
    )
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  const windowStart = new Date(at.getTime() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const after = previous && previous.createdAt > windowStart ? previous.createdAt : windowStart;

  const quickActions = new Set(
    (await db.select({ ids: messagePresets.quickActionPresetIds }).from(messagePresets)).flatMap((p) => p.ids)
  );
  const sends = await db
    .select({ id: messageSends.id, presetId: messageSends.presetId, respondedAt: messageSends.respondedAt })
    .from(messageSends)
    .where(and(eq(messageSends.agentId, agentId), lte(messageSends.sentAt, at), gt(messageSends.sentAt, after)))
    .orderBy(desc(messageSends.sentAt));
  const winner = sends.find((s) => !quickActions.has(s.presetId)) ?? sends[0] ?? null;

  const [current] = await db.select({ sendId: bookings.messageSendId }).from(bookings).where(eq(bookings.id, bookingId));
  const previousSendId = current?.sendId ?? null;
  await db.update(bookings).set({ messageSendId: winner?.id ?? null }).where(eq(bookings.id, bookingId));

  // The send this booking used to credit, if nothing else credits it now, is just a send again.
  if (previousSendId && previousSendId !== winner?.id) {
    const [still] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.messageSendId, previousSendId))
      .limit(1);
    if (!still) {
      await db
        .update(messageSends)
        .set({ result: "pending" })
        .where(and(eq(messageSends.id, previousSendId), eq(messageSends.result, "booked")));
    }
  }
  if (!winner) return null;

  // Booking is the strongest outcome a send can have, so it overwrites whatever
  // the result was before. It also implies a response — nobody books without
  // answering first — so a send credited with a job but still reading "no
  // response" is self-contradictory. The exact reply time isn't knowable, so
  // the booking date stands in for it.
  await db
    .update(messageSends)
    .set({ result: "booked", ...(winner.respondedAt ? {} : { respondedAt: at }) })
    .where(eq(messageSends.id, winner.id));
  return winner.id;
}
