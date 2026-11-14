import { db } from "@/db";
import { listings, agents, bookings, type Agent, type Listing } from "@/db/schema";
import { and, desc, eq, getTableColumns, inArray, notExists, sql } from "drizzle-orm";
import { applyLastContact, lastContactByAgent } from "@/lib/agentLastContact";
import { byLeadPriority, findAttachedAgent, buildAgentLookups, isUnscored } from "@/lib/pipeline";
import { refreshLeadSections, lastTextByAgent, isRecentlyTexted, LEAD_SECTION_ORDER, type LeadSection } from "@/lib/leadSections";
import { getQueuedListingIds } from "@/lib/queueMessages";
import type { KnownAgentGroup } from "@/app/KnownAgentLeads";
import { clientOffices, officeClientFor, type OfficeClient } from "@/lib/clientOffices";
import { estimateDriveMinutes } from "@/lib/driveTime";
import { CARD_MAX_PHOTOS } from "@/lib/cardPhotos";
import { getRecentShoots, nearestShoot, type NearShoot } from "@/lib/nearShoots";
import { shotAddresses } from "@/app/follow-up/feeds/shared";
import { marketFor, milesFromOregonCity, type Market } from "@/lib/markets";

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
  /** The market of the best listing — the tab this card lives under. */
  market: Market;
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
  /**
   * Cold groups with a listing near a home he shot in the last 30 days, by
   * LeadGroup.key: the nearest such shoot, and the lead in the group that
   * matched (not necessarily its best). The page renders these as its "Near
   * your shoots" section — but they stay in `sections` too, unchanged, because
   * the iPhone app's API reads that and must keep seeing the same cards.
   */
  near: Map<string, { near: NearShoot; leadId: string }>;
  /**
   * "Farther than 2 hours": Photo, Video and Backup cards whose nearest
   * listing is over FAR_DRIVE_MINUTES from Winston, nearest first. Like
   * `near`, they stay in `sections` too; the page and the iPhone API pull
   * them out into their own section just above Texted before.
   */
  far: LeadGroup[];
  /** Lead cards that are actually new (queued ones are excluded — see getQueuedListingIds). */
  openLeadCount: number;
  queuedCount: number;
  /** Cards with an agent behind them; the header's "N agents · M listings". */
  agentCount: number;
  /** Addresses of the listings declined agents turned down, named in their Declined badge. */
  addressById: Map<string, string | null>;
  /** Open leads from the last few days whose photos never got scored — a lot of them means scoring is down. */
  unscoredCount: number;
  /** The market the board was filtered to, or null for all of them (the iPhone app's default). */
  market: Market | null;
  /**
   * Open (non-queued) listings per market, always over all three markets — the
   * Leads page's tabs, and a way to see what waits in the other tabs.
   */
  marketCounts: Record<Market, number>;
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
 *
 * `market` narrows the board to one tab (the Leads page passes the tab it is
 * on); leaving it out keeps every market, as the iPhone app's API does for
 * builds that predate the tabs. The counts and the "scoring is down" check
 * still see everything.
 */
/** Cold leads more than this many minutes' drive from Winston go under "Farther than 2 hours". */
export const FAR_DRIVE_MINUTES = 120;
export const FAR_SECTION_LABEL = "Farther than 2 hours";

export async function getLeadsBoard(options?: { cardPhotosOnly?: boolean; market?: Market | null }): Promise<LeadsBoard> {
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
  const [leads, agentKeys, queuedIds, lastContact, offices, recentShoots, shotKeys] = await Promise.all([
    db
      .select(options?.cardPhotosOnly ? { ...getTableColumns(listings), photos: cardPhotos } : getTableColumns(listings))
      .from(listings)
      // A listing already booked with Lukas is his job, not a lead.
      .where(
        and(
          eq(listings.status, "new"),
          notExists(db.select({ one: sql`1` }).from(bookings).where(eq(bookings.listingId, listings.id)))
        )
      )
      .orderBy(desc(listings.foundAt), listings.id),
    db.select({ id: agents.id, phone: agents.phone, name: agents.name, email: agents.email }).from(agents),
    getQueuedListingIds(),
    lastContactByAgent(),
    clientOffices(),
    // Where he has shot lately, and every address he has ever shot: a listing
    // near the former can be led with "I just shot a home a few blocks from
    // your listing"; one at the latter is his own work, not a lead.
    getRecentShoots(),
    shotAddresses(),
  ]);
  // A listing with a message waiting in the Queue has been handled — it lives
  // in the Pipeline's Queued section until that message is sent (see
  // getQueuedListingIds).
  const queuedCount = leads.filter((l) => queuedIds.has(l.id)).length;
  const openLeads = leads.filter((l) => !queuedIds.has(l.id));

  // Each open listing's market, computed once. The tab counts always cover all
  // three markets, even when the board below is narrowed to one, so the tabs
  // still show what waits in the others.
  const marketByLead = new Map(openLeads.map((l) => [l.id, marketFor(l)] as const));
  const marketCounts: Record<Market, number> = { local: 0, regional: 0, portland: 0 };
  for (const leadMarket of marketByLead.values()) marketCounts[leadMarket]++;

  // From here on the board is one market's worth of leads. Everything the tab
  // shows — groups, sections, "near your shoots", the header counts — uses this
  // filtered list; only queuedCount and unscoredCount above/below look at every
  // market.
  const market = options?.market ?? null;
  const marketLeads = market ? openLeads.filter((l) => marketByLead.get(l.id) === market) : openLeads;

  const lookups = buildAgentLookups(applyLastContact(agentKeys, lastContact));
  const attachedIdByLead = new Map(
    marketLeads.map((l) => [l.id, findAttachedAgent(l, lookups.byPhone, lookups.byName, lookups.byId)?.id ?? null] as const)
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
  for (const lead of marketLeads) {
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
      market: marketFor(g.entries[0].lead),
      section: g.entries[0].section,
      // Someone he already knows comes first — unless he texted them this
      // week, in which case they wait in Unlikely like everyone else.
      known: group && !isRecentlyTexted(g.textedAt) ? group : undefined,
      officeClient,
      contactLine: contactLine(g.agent, key, g.textedAt),
    };
  });

  // "Near your shoots": a never-texted cold group with an open listing near a home he shot
  // in the last 30 days, so the first text can open with "I just shot a home a
  // few blocks from your listing". Any entry can match; the nearest one across
  // the group wins. Never someone he knows (they're in Agents you know), an
  // Unlikely lead, or an agent who declined. Keys stay in `sections` as well —
  // see LeadsBoard.near.
  const near = new Map<string, { near: NearShoot; leadId: string }>();
  for (const g of groups) {
    // Never a Texted before (or Unlikely) group: those stay in their own
    // section whatever else is true of them (leadSection(), and hard rule 5
    // in docs/AGENT-GUIDE.md).
    if (g.known || g.section === "unlikely" || g.section === "texted") continue;
    if (g.agent && (g.agent.relationshipStatus === "declined" || g.agent.declinedAt)) continue;
    let match: { near: NearShoot; leadId: string } | null = null;
    for (const { lead } of g.entries) {
      const nearest = nearestShoot(lead, recentShoots, shotKeys);
      if (nearest && (!match || nearest.miles < match.near.miles)) match = { near: nearest, leadId: lead.id };
    }
    if (match) near.set(g.key, match);
  }

  // "Farther than 2 hours" (Lukas, 2026-11-14): driving past two hours from
  // Winston is a hassle, so cold Photo/Video/Backup cards out there wait in
  // their own section above Texted before. Measured to the group's nearest
  // listing; Portland (the subcontractor's) and cities missing from the drive
  // table never count as far. Known agents and Near your shoots are left
  // alone, and Texted before / Unlikely never move (hard rule 5).
  const farMinutes = new Map<string, number>();
  for (const g of groups) {
    if (g.known || near.has(g.key)) continue;
    if (g.section !== "photo" && g.section !== "video" && g.section !== "backup") continue;
    let nearest = Infinity;
    for (const { lead } of g.entries) {
      const minutes = marketFor(lead) === "portland" ? 0 : lead.city ? estimateDriveMinutes(lead.city) : null;
      if (minutes != null) nearest = Math.min(nearest, minutes);
    }
    if (nearest !== Infinity && nearest > FAR_DRIVE_MINUTES) farMinutes.set(g.key, nearest);
  }

  const known = groups.filter((g) => g.known);
  const sections: Record<LeadSection, LeadGroup[]> = { photo: [], video: [], backup: [], texted: [], unlikely: [] };
  for (const g of groups) if (!g.known) sections[g.section].push(g);

  // Within a section, the three he texts from (photo, video, backup) go by
  // outreachRank first: listed before coming soon, near before far, a southern
  // or central Oregon number before a Portland one. From the first cold text
  // to 331 agents (through Oct 2026): coming-soon agents answered as often but
  // turned warm half as often (13% vs 29%, the photographer is usually already
  // booked); agents within 45 minutes answered 43% vs about 30% farther out;
  // 541/458 agents became interested twice as often as 503/971 (7.6% vs 3.8%).
  // Photo score, price and brokerage made no difference, so they only break
  // ties. After that: video puts agents he has never texted first, then the
  // priciest listing; backup the priciest; photo the pipeline's priority score.
  // Texted goes nearest first, then by who has waited longest since his last text; unlikely by the
  // priority score.
  //
  // The Portland tab ranks by distance from Oregon City instead (see
  // outreachRank): the photographer is out there, so 503/971 numbers are the
  // local numbers and the drive from Winston says nothing.
  for (const key of LEAD_SECTION_ORDER) {
    sections[key].sort((a, b) =>
      key === "backup"
        ? outreachRank(a, b, market) || (b.best.price ?? 0) - (a.best.price ?? 0)
        : key === "video"
        ? (a.textedAt ? 1 : 0) - (b.textedAt ? 1 : 0) ||
          outreachRank(a, b, market) ||
          (b.best.price ?? 0) - (a.best.price ?? 0)
        : key === "photo"
          ? outreachRank(a, b, market) || byLeadPriority(a.best, b.best)
          : key === "texted"
            ? // Nearest first (Lukas, 2026-11-14: second touches start close to
              // home), then whoever has waited longest since his last text.
              compareDistance(nearestDistance(a, market), nearestDistance(b, market)) ||
              (a.textedAt?.getTime() ?? 0) - (b.textedAt?.getTime() ?? 0) ||
              byLeadPriority(a.best, b.best)
            : byLeadPriority(a.best, b.best)
    );
  }
  known.sort(
    (a, b) =>
      KNOWN_AGENT_GROUP_ORDER.indexOf(a.known!) - KNOWN_AGENT_GROUP_ORDER.indexOf(b.known!) ||
      byLeadPriority(a.best, b.best)
  );
  const far = LEAD_SECTION_ORDER.flatMap((key) => sections[key].filter((g) => farMinutes.has(g.key)));
  far.sort((a, b) => farMinutes.get(a.key)! - farMinutes.get(b.key)!);
  const agentCount = groups.filter((g) => !g.key.startsWith("listing:")).length;

  const recent = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const unscoredCount = openLeads.filter((l) => isUnscored(l) && l.foundAt.getTime() > recent).length;

  return {
    known,
    sections,
    near,
    far,
    openLeadCount: marketLeads.length,
    queuedCount,
    agentCount,
    addressById,
    unscoredCount,
    market,
    marketCounts,
  };
}

/**
 * Who to text first: listed before coming soon, then nearer, then a local
 * number (see the sort above). The Portland tab is simply nearest to Oregon
 * City first (the photographer is based there; Lukas asked for a plain
 * distance sort, 2026-11-12): the drive from Winston says nothing there and
 * 503/971 is the local number. Unknown distance sorts last.
 */
function outreachRank(a: LeadGroup, b: LeadGroup, market: Market | null): number {
  if (market === "portland") return portlandDistance(a) - portlandDistance(b);
  const listed = Number(a.best.isComingSoon) - Number(b.best.isComingSoon);
  if (listed) return listed;
  return (
    driveBand(a.best.city) - driveBand(b.best.city) ||
    areaBand(a.agent?.phone ?? a.best.agentPhone) - areaBand(b.agent?.phone ?? b.best.agentPhone)
  );
}

/** Miles from Oregon City to the group's best listing; unknown is Infinity. */
function portlandDistance(g: LeadGroup): number {
  return milesFromOregonCity(g.best) ?? Infinity;
}

/**
 * How far the group's nearest listing is: drive minutes from Winston, or
 * miles from Oregon City on the Portland tab. Unknown is Infinity.
 */
function nearestDistance(g: LeadGroup, market: Market | null): number {
  let nearest = Infinity;
  for (const { lead } of g.entries) {
    const d =
      market === "portland" ? milesFromOregonCity(lead) : lead.city ? estimateDriveMinutes(lead.city) : null;
    if (d != null) nearest = Math.min(nearest, d);
  }
  return nearest;
}

/** Ascending, with Infinity (unknown) last and equal to itself. */
function compareDistance(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** 541/458 (southern and central Oregon) first, Portland and Vancouver numbers last. */
function areaBand(phone: string | null | undefined): number {
  const code = (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").slice(0, 3);
  if (code === "541" || code === "458") return 0;
  if (code === "503" || code === "971" || code === "360") return 2;
  return 1;
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
