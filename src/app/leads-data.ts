import { db } from "@/db";
import { listings, agents, type Agent, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { withLastContactFromHistory } from "@/lib/agentLastContact";
import { byLeadPriority, findAttachedAgent, buildAgentLookups } from "@/lib/pipeline";
import { refreshLeadSections, lastTextByAgent, isRecentlyTexted, LEAD_SECTION_ORDER, type LeadSection } from "@/lib/leadSections";
import { getQueuedListingIds } from "@/lib/queueMessages";
import type { KnownAgentGroup } from "@/app/KnownAgentLeads";
import { clientOffices, officeKey, type OfficeClient } from "@/lib/clientOffices";

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
}

export async function getLeadsBoard(): Promise<LeadsBoard> {
  // foundAt is transaction-time, so a batch insert gives every row in it
  // the exact same value — listings.id as a tiebreaker keeps order stable
  // across renders instead of reshuffling ties arbitrarily.
  // Independent of each other, so run them concurrently instead of paying
  // for two sequential round trips to Neon.
  const [leads, allAgents, queuedIds] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(eq(listings.status, "new"))
      .orderBy(desc(listings.foundAt), listings.id),
    db.select().from(agents),
    getQueuedListingIds(),
  ]);
  // A listing with a message waiting in the Queue has been handled — it lives
  // in the Pipeline's Queued section until that message is sent (see
  // getQueuedListingIds).
  const queuedCount = leads.filter((l) => queuedIds.has(l.id)).length;
  const openLeads = leads.filter((l) => !queuedIds.has(l.id));
  const contactAgents = await withLastContactFromHistory(allAgents);
  const { byId: agentById, byPhone: agentByPhone, byName: agentByName } = buildAgentLookups(contactAgents);

  // The listing a declined agent turned down, named in their Declined badge.
  const referencedIds = contactAgents
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

  // Four sections — see lib/leadSections.ts. The stored section is what the
  // message dialog's recommendation reads, so settle it first and bucket from
  // exactly that. refreshLeadSections only writes rows that moved, so this is
  // cheap per load and self-heals when a score, price cut or text lands.
  // Queued ones too: their recommendation reads the same stored section.
  const sectionById = await refreshLeadSections(leads.map((l) => l.id));
  // When each agent was last texted or called: a week's quiet before texting
  // them again, the "Texted Oct 5" on the card, and never-texted agents first.
  const offices = await clientOffices();
  const lastTexted = await lastTextByAgent(
    openLeads.map((l) => findAttachedAgent(l, agentByPhone, agentByName, agentById)?.id).filter((id): id is string => !!id)
  );

  // One card per agent: outreach is about the person now, and each listing is
  // just a reason to text them. Their best open listing leads the card — the
  // strongest section first (a photo pitch beats video beats backup), then the
  // usual priority score — and the rest fold away underneath it. Grouping is
  // display only; each listing keeps its stored section, so if the best one
  // goes away the next one takes its place.
  const byKey = new Map<string, { agent: Agent | null; entries: LeadGroup["entries"]; textedAt: Date | undefined }>();
  for (const lead of openLeads) {
    const attached = findAttachedAgent(lead, agentByPhone, agentByName, agentById);
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
    // knows. Declined agents stay put; the client themself never matches.
    const client = offices.get(officeKey(g.entries[0].lead.brokerName) ?? "");
    const officeClient =
      client && client.agentId !== g.agent?.id && g.agent?.relationshipStatus !== "declined" ? client : null;
    const group = known ?? (officeClient ? ("office" as const) : undefined);
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
  const sections: Record<LeadSection, LeadGroup[]> = { photo: [], video: [], backup: [], unlikely: [] };
  for (const g of groups) if (!g.known) sections[g.section].push(g);

  // Within a section: backup and video put agents he has never texted first,
  // then the priciest listing; photo and unlikely go by the priority score the
  // pipeline uses (coming soon first, then price-weighted photo opportunity).
  for (const key of LEAD_SECTION_ORDER) {
    sections[key].sort((a, b) =>
      key === "backup" || key === "video"
        ? (a.textedAt ? 1 : 0) - (b.textedAt ? 1 : 0) || (b.best.price ?? 0) - (a.best.price ?? 0)
        : byLeadPriority(a.best, b.best)
    );
  }
  known.sort(
    (a, b) =>
      KNOWN_AGENT_GROUP_ORDER.indexOf(a.known!) - KNOWN_AGENT_GROUP_ORDER.indexOf(b.known!) ||
      byLeadPriority(a.best, b.best)
  );
  const agentCount = groups.filter((g) => !g.key.startsWith("listing:")).length;

  return { known, sections, openLeadCount: openLeads.length, queuedCount, agentCount, addressById };
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
