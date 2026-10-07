import { withLastContactFromHistory } from "@/lib/agentLastContact";
import { Fragment, Suspense } from "react";
import { PartyPopper, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { listings, agents, type Agent, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { AgentLeadCard } from "./AgentLeadCard";
import { RefreshButton } from "./RefreshButton";
import { ImportListingButton } from "./ImportListingButton";
import { PassAllListingsButton } from "./PassAllListingsButton";
import { NewBadge, PhotoScoreBadge, ComingSoonBadge, PriceCutBadge, FewPhotosBadge, AgentDeclinedBadge } from "./badges";
import { byLeadPriority, FEW_PHOTOS_THRESHOLD, findAttachedAgent, buildAgentLookups } from "@/lib/pipeline";
import {
  refreshLeadSections,
  isBuilderListing,
  lastTextByAgent,
  isRecentlyTexted,
  LEAD_SECTION_LABELS,
  LEAD_SECTION_ORDER,
  type LeadSection,
} from "@/lib/leadSections";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { LeadsSkeleton } from "./loading";
import Link from "next/link";
import { getQueuedListingIds } from "@/lib/queueMessages";
import { KnownAgentLeads, type KnownAgentGroup } from "./KnownAgentLeads";
import type { AgentRelationshipStatus } from "@/db/schema";

const KNOWN_AGENT_GROUP: Partial<Record<AgentRelationshipStatus, KnownAgentGroup>> = {
  regular: "clients",
  worked_once: "clients",
  interested: "interested",
  warm: "warm",
};
const KNOWN_AGENT_GROUP_ORDER: KnownAgentGroup[] = ["clients", "interested", "warm"];

// Server Action timeouts are controlled by the maxDuration of the page
// they're invoked from — triggerManualSync (RefreshButton's action, in
// ./actions.ts) needs headroom for fetchAgentInfo's retry/timeout budget
// in src/lib/zillapi.ts, same reasoning as the cron route's maxDuration.
// Raised from 60 to 300 on 2026-09-10 after real cron runs came in at
// 42-62s with zero photo-scoring work (Zillapi's own listing-search
// latency alone), leaving no margin once Gemini scoring is added on top —
// Hobby plan's actual ceiling (with Fluid compute, on by default) is 300s,
// not 60; the old 60 was an unnecessarily tight self-imposed limit, and
// raising it is free since Vercel bills active CPU time, not wall-clock
// time spent waiting on Zillapi/Gemini.
export const maxDuration = 300;

export default function LeadsPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<LeadsSkeleton />}>
        <LeadsContent />
      </Suspense>
    </main>
  );
}

async function LeadsContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.

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
  const addressById = new Map(referencedListings.map((l) => [l.id, l.address]));

  // Four sections — see lib/leadSections.ts. The stored section is what the
  // message dialog's recommendation reads, so settle it first and bucket from
  // exactly that. refreshLeadSections only writes rows that moved, so this is
  // cheap per load and self-heals when a score, price cut or text lands.
  // Queued ones too: their recommendation reads the same stored section.
  const sectionById = await refreshLeadSections(leads.map((l) => l.id));
  // When each agent was last texted or called: a week's quiet before texting
  // them again, the "Texted Oct 5" on the card, and never-texted agents first.
  const lastTexted = await lastTextByAgent(
    openLeads.map((l) => findAttachedAgent(l, agentByPhone, agentByName, agentById)?.id).filter((id): id is string => !!id)
  );

  // One card per agent: outreach is about the person now, and each listing is
  // just a reason to text them. Their best open listing leads the card — the
  // strongest section first (a photo pitch beats video beats backup), then the
  // usual priority score — and the rest fold away underneath it. Grouping is
  // display only; each listing keeps its stored section, so if the best one
  // goes away the next one takes its place.
  type Entry = { lead: Listing; section: LeadSection };
  type AgentGroupRow = {
    key: string;
    agent: Agent | null;
    entries: Entry[];
    textedAt: Date | undefined;
    best: Listing;
    section: LeadSection;
    known: KnownAgentGroup | undefined;
  };
  const byKey = new Map<string, { agent: Agent | null; entries: Entry[]; textedAt: Date | undefined }>();
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

  const groups: AgentGroupRow[] = [...byKey.entries()].map(([key, g]) => {
    g.entries.sort(
      (a, b) =>
        LEAD_SECTION_ORDER.indexOf(a.section) - LEAD_SECTION_ORDER.indexOf(b.section) ||
        byLeadPriority(a.lead, b.lead)
    );
    const known = g.agent ? KNOWN_AGENT_GROUP[g.agent.relationshipStatus] : undefined;
    return {
      key,
      ...g,
      best: g.entries[0].lead,
      section: g.entries[0].section,
      // Someone he already knows comes first — unless he texted them this
      // week, in which case they wait in Unlikely like everyone else.
      known: known && !isRecentlyTexted(g.textedAt) ? known : undefined,
    };
  });

  const known = groups.filter((g) => g.known);
  const sections: Record<LeadSection, AgentGroupRow[]> = { photo: [], video: [], backup: [], unlikely: [] };
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

  function contactLine(g: AgentGroupRow): string | null {
    if (g.textedAt) return `Texted ${shortDate(g.textedAt)}`;
    if (g.agent?.lastContactedAt) return `Never texted · emailed ${shortDate(g.agent.lastContactedAt)}`;
    return g.agent || !g.key.startsWith("listing:") ? "Never contacted" : null;
  }

  function card(g: AgentGroupRow) {
    const lead = g.best;
    const agent = g.agent;
    const ids = g.entries.map((e) => e.lead.id);

    return (
      <AgentLeadCard
        key={g.key}
        agent={agent}
        agentName={lead.agentName}
        brokerName={lead.brokerName}
        contactLine={contactLine(g)}
        lead={lead}
        others={g.entries.slice(1).map((e) => e.lead)}
        badges={
          <Fragment key={lead.id}>
            <NewBadge />
            {lead.isComingSoon && <ComingSoonBadge />}
            <PriceCutBadge lead={lead} />
            {lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD && (
              <FewPhotosBadge count={lead.photoCount} />
            )}
            {lead.score != null && <PhotoScoreBadge score={lead.score} reasoning={lead.scoreReasoning} />}
            {isBuilderListing(lead.brokerName) && <Badge variant="outline">Builder</Badge>}
            {agent?.relationshipStatus === "declined" && (
              <AgentDeclinedBadge
                agent={agent}
                duplicateAddress={
                  agent.lastContactedListingId ? addressById.get(agent.lastContactedListingId) : undefined
                }
              />
            )}
          </Fragment>
        }
        actions={
          <LeadActions
            key={lead.id}
            listingId={lead.id}
            agentName={lead.agentName}
            agentPhone={lead.agentPhone}
            agentEmail={agent?.email}
            address={lead.address}
            city={lead.city}
            passListingIds={ids}
          />
        }
      />
    );
  }

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {agentCount} agent{agentCount === 1 ? "" : "s"} · {openLeads.length} listing
            {openLeads.length === 1 ? "" : "s"}
            {queuedCount > 0 && (
              <>
                {" · "}
                <Link href="/queue" className="text-primary hover:underline">
                  {queuedCount} queued
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ImportListingButton />
          <RefreshButton />
        </div>
      </header>

      {openLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <PartyPopper className="size-8" />
          <p>You&rsquo;re all caught up — no new leads right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {known.length > 0 && (
            <section>
              <details className="group/details" open>
                <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                  <span className="flex items-center gap-1">
                    <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                    Agents you know ({known.length})
                  </span>
                </summary>
                <KnownAgentLeads items={known.map((g) => ({ group: g.known!, card: card(g) }))} />
              </details>
            </section>
          )}
          {LEAD_SECTION_ORDER.map((key, index) => {
            const items = sections[key];
            if (items.length === 0) return null;
            const isUnlikely = key === "unlikely";
            return (
              <section key={key}>
                {(index > 0 || known.length > 0) && <Separator className="mb-8" />}
                <details className="group/details" open={!isUnlikely}>
                  <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                    <span className="flex items-center gap-1">
                      <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                      {LEAD_SECTION_LABELS[key]} ({items.length})
                    </span>
                    {isUnlikely && (
                      <PassAllListingsButton listingIds={items.flatMap((g) => g.entries.map((e) => e.lead.id))} />
                    )}
                  </summary>
                  <div className="flex flex-col gap-4 mt-3">{items.map(card)}</div>
                </details>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Saved, contacted and imported listings live in the{" "}
        <Link href="/pipeline" className="text-primary hover:underline">
          Pipeline
        </Link>
        .
      </p>
    </>
  );
}

/** "Oct 5" in Pacific time — this renders on the server, which runs in UTC. */
function shortDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}
