import { db } from "@/db";
import { listings, agents, type Agent, type Listing } from "@/db/schema";
import { desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { applyLastContact, lastContactByAgent } from "@/lib/agentLastContact";
import { byLeadPriority, findAttachedAgent, buildAgentLookups, isUnscored } from "@/lib/pipeline";
import { refreshLeadSections, lastTextByAgent, isRecentlyTexted, LEAD_SECTION_ORDER, type LeadSection } from "@/lib/leadSections";
import { getQueuedListingIds } from "@/lib/queueMessages";
import type { KnownAgentGroup } from "@/app/KnownAgentLeads";
import { clientOffices, officeClientFor, type OfficeClient } from "@/lib/clientOffices";
import { estimateDriveMinutes } from "@/lib/driveTime";
import { CARD_MAX_PHOTOS } from "@/lib/cardPhotos";

/**
 * Everything the Leads page shows, as data.
 *
 * Lifted out of page.tsx so the iPhone app's GET /leads calls exactly the
 * same queries and the exact same grouping rather than a second copy of it —
 * the unmerged Expo attempt re-implemented this grouping client-side and
 * drifted from the web within days. The page's JSX is unchanged; it just calls
 * this instead of running the queries inline.
 *
 * Server-only (it queries the DB).
 */

const KNOWN_AGENT_GROUP: Partial<Record<Agent["relationshipStatus"], KnownAgentGroup>> = {
  regular: "clients",
  worked_once: "clients",
  interested: "interested",
  warm: "warm",
};
const KNOWN_AGENT_GROUP_ORDER: KnownAgentGroup[] = ["clients", "interested", "warm", "office"];

/** One card's worth of leads: an agent, and every open listing that leads to them. */
export interface LeadGroup {
  key: string;
  agent: Agent | null;
  entries: { lead: Listing; section: LeadSection }[];
  textedAt: Date | undefined;
  best: Listing;
  section: LeadSection;
  known: KnownAgentGroup | undefined;
  /** A client of Lukas's at the same brokerage as this lead — the warm intro for a stranger. */
  officeClient: OfficeClient | null;
  /** "Texted Oct 5" / "Never contacted" — null only for a listing with no agent at all. */
  contactLine: string | null;
}

export interface LeadsBoard {
  known: LeadGroup[];
  sections: Record<LeadSection, LeadGroup[]>;
  /** Lead cards that are actually new (queued ones are excluded — see getQueuedListingIds). */
  openLeadCount: number;
  queuedCount: number;
  /** Cards with an agent behind them; the header's "N agents · M listings". */
  agentCount: number;
  /** Addresses of the listings declined agents turned down, named in their Declined badge. */
  addressById: Map<string, string | null>;
  /** Open leads from the last few days whose photos never got scored — a lot of them means scoring is down. */
  unscoredCount: number;
}

/**
 * The photos a card shows, picked in the query: the same evenly spaced five
 * sampleCardPhotos takes (lib/cardPhotos.ts), so that function is a no-op on
 * the result. Galleries average 41 photos, and their URLs were three quarters
 * of what this page reads from the database.
 */
const cardPhotos = sql<string[] | null>`case
  when coalesce(array_length(${listings.photos}, 1), 0) <= ${sql.raw(String(CARD_MAX_PHOTOS))} then ${listings.photos}
  else array(
    select ${listings.photos}[1 + round(i * (array_length(${listings.photos}, 1) - 1)::numeric / ${sql.raw(String(CARD_MAX_PHOTOS - 1))})::int]
    from generate_series(0, ${sql.raw(String(CARD_MAX_PHOTOS - 1))}) as i
    order by i
  )
end`;

/**
 * `cardPhotosOnly` is for callers that never show a listing's whole gallery
 * (the iPhone app's list): each listing comes back with just the photos its
 * card uses. The web page opens the full gallery from the card, so it leaves
 * this off.
 */
export async function getLeadsBoard(options?: { cardPhotosOnly?: boolean }): Promise<LeadsBoard> {
  // foundAt is transaction-time, so a batch insert gives every row in it
  // the exact same value — listings.id as a tiebreaker keeps order stable
  // across renders instead of reshuffling ties arbitrarily.
  //
  // Everything that doesn't depend on anything else goes in one round trip.
  // Matching a listing to its agent (by id, then phone, then name) has to look
  // at every agent on file, but only at a few fields of each, so those are all
  // that's loaded for the ~9,000 of them; the full rows are fetched below for
  // just the few hundred on the board. Loading every full row was 4 MB of the
  // page's 8, on every load.
  const [leads, agentKeys, queuedIds, lastContact, offices] = await Promise.all([
    db
      .select(options?.cardPhotosOnly ? { ...getTableColumns(listings), photos: cardPhotos } : getTableColumns(listings))
      .from(listings)
      .where(eq(listings.status, "new"))
      .orderBy(desc(listings.foundAt), listings.id),
    db.select({ id: agents.id, phone: agents.phone, name: agents.name, email: agents.email }).from(agents),
    getQueuedListingIds(),
    lastContactByAgent(),
    clientOffices(),
  ]);
  // A listing with a message waiting in the Queue has been handled — it lives
  // in the Pipeline's Queued section until that message is sent (see
  // getQueuedListingIds).
  const queuedCount = leads.filter((l) => queuedIds.has(l.id)).length;
  const openLeads = leads.filter((l) => !queuedIds.has(l.id));

  const lookups = buildAgentLookups(applyLastContact(agentKeys, lastContact));
  const attachedIdByLead = new Map(
    openLeads.map((l) => [l.id, findAttachedAgent(l, lookups.byPhone, lookups.byName, lookups.byId)?.id ?? null] as const)
  );
  const attachedIds = [...new Set([...attachedIdByLead.values()].filter((id): id is string => id != null))];

  // Four sections — see lib/leadSections.ts. The stored section is what the
  // message dialog's recommendation reads, so settle it first and bucket from
  // exactly that. refreshLeadSections only writes rows that moved, so this is
  // cheap per load and self-heals when a score, price cut or text lands.
  // Queued ones too: their recommendation reads the same stored section.
  //
  // lastTexted is when each agent was last texted or called: a week's quiet
  // before texting them again, the "Texted Oct 5" on the card, and
  // never-texted agents first.
  const [attachedRows, sectionById, lastTexted] = await Promise.all([
    attachedIds.length > 0 ? db.select().from(agents).where(inArray(agents.id, attachedIds)) : Promise.resolve([]),
    refreshLeadSections(leads.map((l) => l.id)),
    lastTextByAgent(attachedIds),
  ]);
  const agentById = new Map(applyLastContact(attachedRows, lastContact).map((a) => [a.id, a] as const));

  // The listing a declined agent turned down, named in their Declined badge.
  const referencedIds = [...agentById.values()]
    .filter((a) => a.relationshipStatus === "declined")
    .map((a) => a.lastContactedListingId)
    .filter((id): id is string => id != null);
  const referencedListings =
    referencedIds.length > 0
      ? await db
          .select({ id: listings.id, address: listings.address })
          .from(listings)
          .where(inArray(listings.id, referencedIds))
      : [];
  const addressById = new Map(referencedListings.map((l) => [l.id, l.address] as const));

  // One card per agent: outreach is about the person now, and each listing is
  // just a reason to text them. Their best open listing leads the card — the
  // strongest section first (a photo pitch beats video beats backup), then the
  // usual priority score — and the rest fold away underneath it. Grouping is
  // display only; each listing keeps its stored section, so if the best one
  // goes away the next one takes its place.
  const byKey = new Map<string, { agent: Agent | null; entries: LeadGroup["entries"]; textedAt: Date | undefined }>();
  for (const lead of openLeads) {
    const attachedId = attachedIdByLead.get(lead.id);
    const attached = attachedId ? agentById.get(attachedId) ?? null : null;
    const textedAt = attached ? lastTexted.get(attached.id) : undefined;
    const section = sectionById.get(lead.id) ?? "unlikely";
    const fallback = lead.agentPhone || lead.agentName;
    const key = attached ? attached.id : fallback ? `contact:${fallback}` : `listing:${lead.id}`;
    const group = byKey.get(key) ?? { agent: attached, entries: [], textedAt };
    group.entries.push({ lead, section });
    byKey.set(key, group);
  }

  const groups: LeadGroup[] = [...byKey.entries()].map(([key, g]) => {
    g.entries.sort(
      (a, b) =>
        LEAD_SECTION_ORDER.indexOf(a.section) - LEAD_SECTION_ORDER.indexOf(b.section) ||
        byLeadPriority(a.lead, b.lead)
    );
    const known = g.agent ? KNOWN_AGENT_GROUP[g.agent.relationshipStatus] : undefined;
    // Shooting for someone in their office is a warm intro even to a stranger,
    // so a cold agent at a client's brokerage moves up with the people he
    // knows. Only for a real agent (a listing with no one to text stays where
    // it is), never the client themself or someone who declined, and only
    // when one of their listings is near where that client works.
    const client = g.agent
      ? officeClientFor(offices, g.entries[0].lead.brokerName, g.entries.map((e) => e.lead.city))
      : null;
    const officeClient =
      client && client.agentId !== g.agent?.id && g.agent?.relationshipStatus !== "declined" ? client : null;
    // Once texted, the office intro has been used too, so they move on to
    // "Texted before" with everyone else who didn't answer.
    const group = known ?? (officeClient && !g.textedAt ? ("office" as const) : undefined);
    return {
      key,
      ...g,
      best: g.entries[0].lead,
      section: g.entries[0].section,
      // Someone he already knows comes first — unless he texted them this
      // week, in which case they wait in Unlikely like everyone else.
      known: group && !isRecentlyTexted(g.textedAt) ? group : undefined,
      officeClient,
      contactLine: contactLine(g.agent, key, g.textedAt),
    };
  });

  const known = groups.filter((g) => g.known);
  const sections: Record<LeadSection, LeadGroup[]> = { photo: [], video: [], backup: [], texted: [], unlikely: [] };
  for (const g of groups) if (!g.known) sections[g.section].push(g);

  // Within a section: video puts agents he has never texted first, then the
  // priciest listing. Backup goes nearest first, then priciest: a backup text
  // is about being the photographer they think of, and the jobs that come of
  // it pay about twice as much an hour within 45 minutes of home as they do
  // two hours out (bookings through Oct 2026), while agents answer at the same
  // rate wherever they are. Texted goes by who has waited longest since his
  // last text; photo and unlikely go by the priority score the pipeline uses
  // (coming soon first, then price-weighted photo opportunity).
  for (const key of LEAD_SECTION_ORDER) {
    sections[key].sort((a, b) =>
      key === "backup"
        ? driveBand(a.best.city) - driveBand(b.best.city) || (b.best.price ?? 0) - (a.best.price ?? 0)
        : key === "video"
        ? (a.textedAt ? 1 : 0) - (b.textedAt ? 1 : 0) || (b.best.price ?? 0) - (a.best.price ?? 0)
        : key === "texted"
          ? (a.textedAt?.getTime() ?? 0) - (b.textedAt?.getTime() ?? 0) || byLeadPriority(a.best, b.best)
          : byLeadPriority(a.best, b.best)
    );
  }
  known.sort(
    (a, b) =>
      KNOWN_AGENT_GROUP_ORDER.indexOf(a.known!) - KNOWN_AGENT_GROUP_ORDER.indexOf(b.known!) ||
      byLeadPriority(a.best, b.best)
  );
  const agentCount = groups.filter((g) => !g.key.startsWith("listing:")).length;

  const recent = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const unscoredCount = openLeads.filter((l) => isUnscored(l) && l.foundAt.getTime() > recent).length;

  return { known, sections, openLeadCount: openLeads.length, queuedCount, agentCount, addressById, unscoredCount };
}

/**
 * How far a lead is, in the steps that change what a job there is worth:
 * around home, the Eugene / Medford / Coos Bay ring, the mid-valley, and
 * everything past it. A city missing from the drive table sorts last.
 */
function driveBand(city: string | null): number {
  const minutes = city ? estimateDriveMinutes(city) : null;
  if (minutes == null) return 4;
  return minutes <= 45 ? 0 : minutes <= 100 ? 1 : minutes <= 165 ? 2 : 3;
}

function contactLine(agent: Agent | null, key: string, textedAt: Date | undefined): string | null {
  if (textedAt) return `Texted ${shortDate(textedAt)}`;
  if (agent?.lastContactedAt) return `Never texted · emailed ${shortDate(agent.lastContactedAt)}`;
  return agent || !key.startsWith("listing:") ? "Never contacted" : null;
}

/** "Oct 5" in Pacific time — this renders on the server, which runs in UTC. */
function shortDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}
