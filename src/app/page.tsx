import { withLastContactFromHistory } from "@/lib/agentLastContact";
import { Fragment, Suspense } from "react";
import { PartyPopper, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { LeadCard } from "./LeadCard";
import { RefreshButton } from "./RefreshButton";
import { ImportListingButton } from "./ImportListingButton";
import { PassAllListingsButton } from "./PassAllListingsButton";
import { NewBadge, DuplicateAgentBadge, PhotoScoreBadge, ComingSoonBadge, PriceCutBadge, FewPhotosBadge, AgentDeclinedBadge, WarmAgentBadge } from "./badges";
import { findDuplicateAgentContact, byLeadPriority, FEW_PHOTOS_THRESHOLD, findAttachedAgent, buildAgentLookups, isWarmAgentStatus } from "@/lib/pipeline";
import { leadSection, refreshLeadSections, LEAD_SECTION_LABELS, LEAD_SECTION_ORDER, type LeadSection } from "@/lib/leadSections";
import { Separator } from "@/components/ui/separator";
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

  // Every other listing referenced by an agent's last-contacted pointer —
  // used only to name the listing in the duplicate-agent warning below.
  const referencedIds = contactAgents
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

  // Four sections instead of the old "likely / unlikely" split — see
  // lib/leadSections.ts for why the old photo/price test was demoting 86% of
  // the list. The section is decided from the listing plus its resolved
  // agent's status, since "agent declined" and "no agent at all" are both
  // reasons a lead is unreachable.
  // The stored section is what the message dialog's targeting filter reads, so
  // settle it before bucketing rather than deriving a second, possibly
  // different answer here. refreshLeadSections only writes rows that actually
  // moved, so this is cheap on a page load and self-healing when a score or
  // price cut lands after the fact.
  await refreshLeadSections(leads.map((l) => l.id));

  // A new listing from an agent who already knows Lukas is the best moment to
  // get back in touch, so those come out of the four sections into their own,
  // at the top. Display only: the stored leadSection is untouched, since the
  // message recommendation reads it.
  const known: { lead: Listing; group: KnownAgentGroup }[] = [];
  const sections: Record<LeadSection, Listing[]> = { photo: [], video: [], backup: [], unlikely: [] };
  for (const lead of openLeads) {
    const attached = findAttachedAgent(lead, agentByPhone, agentByName, agentById);
    const group = attached ? KNOWN_AGENT_GROUP[attached.relationshipStatus] : undefined;
    if (group) {
      known.push({ lead, group });
      continue;
    }
    const section =
      (lead.leadSection as LeadSection | null) ?? leadSection({
        ...lead,
        relationshipStatus: attached?.relationshipStatus,
        lastContactedAt: attached?.lastContactedAt,
      });
    sections[section].push(lead);
  }
  // Within a section, order by the same priority score the pipeline uses:
  // coming-soon first, then price-weighted photo opportunity, then age.
  for (const key of Object.keys(sections) as LeadSection[]) {
    sections[key].sort(byLeadPriority);
  }
  // Backup and video: agents never contacted first (the untouched
  // relationships), then highest price first within each group.
  const contacted = (lead: Listing) =>
    findAttachedAgent(lead, agentByPhone, agentByName, agentById)?.lastContactedAt ? 1 : 0;
  for (const key of ["backup", "video"] as const) {
    sections[key].sort((a, b) => contacted(a) - contacted(b) || (b.price ?? 0) - (a.price ?? 0));
  }

  known.sort(
    (a, b) =>
      KNOWN_AGENT_GROUP_ORDER.indexOf(a.group) - KNOWN_AGENT_GROUP_ORDER.indexOf(b.group) ||
      byLeadPriority(a.lead, b.lead)
  );

  function card(lead: Listing) {
    const attachedAgent = findAttachedAgent(lead, agentByPhone, agentByName, agentById);
    const duplicateAgent = findDuplicateAgentContact(attachedAgent);
    const agentDeclined = attachedAgent?.relationshipStatus === "declined";

    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <Fragment key={lead.id}>
            <NewBadge />
            {lead.isComingSoon && <ComingSoonBadge />}
            <PriceCutBadge lead={lead} />
            {attachedAgent && isWarmAgentStatus(attachedAgent.relationshipStatus) && (
              <WarmAgentBadge agent={attachedAgent} />
            )}
            {lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD && (
              <FewPhotosBadge count={lead.photoCount} />
            )}
            {lead.score != null && (
              <PhotoScoreBadge score={lead.score} reasoning={lead.scoreReasoning} />
            )}
            {agentDeclined && attachedAgent ? (
              <AgentDeclinedBadge
                agent={attachedAgent}
                duplicateAddress={
                  attachedAgent.lastContactedListingId
                    ? addressById.get(attachedAgent.lastContactedListingId)
                    : undefined
                }
              />
            ) : (
              duplicateAgent && (
                <DuplicateAgentBadge
                  duplicateAgent={duplicateAgent}
                  duplicateAddress={
                    duplicateAgent.lastContactedListingId
                      ? addressById.get(duplicateAgent.lastContactedListingId)
                      : undefined
                  }
                />
              )
            )}
          </Fragment>
        }
        actions={
          <LeadActions
            key={lead.id}
            listingId={lead.id}
            agentName={lead.agentName}
            agentPhone={lead.agentPhone}
            agentEmail={attachedAgent?.email}
            address={lead.address}
            city={lead.city}
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
            {openLeads.length} new listing{openLeads.length === 1 ? "" : "s"}
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
                    From agents you know ({known.length})
                  </span>
                </summary>
                <KnownAgentLeads items={known.map(({ lead, group }) => ({ group, card: card(lead) }))} />
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
                    {isUnlikely && <PassAllListingsButton listingIds={items.map((l) => l.id)} />}
                  </summary>
                  <div className="flex flex-col gap-4 mt-3">{items.map(card)}</div>
                </details>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
