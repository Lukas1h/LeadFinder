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
import { leadSectionForListing, refreshLeadSections, LEAD_SECTION_LABELS, LEAD_SECTION_ORDER, type LeadSection } from "@/lib/leadSections";
import { Separator } from "@/components/ui/separator";
import { LeadsSkeleton } from "./loading";

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
  const [leads, allAgents] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(eq(listings.status, "new"))
      .orderBy(desc(listings.foundAt), listings.id),
    db.select().from(agents),
  ]);
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

  const sections: Record<LeadSection, Listing[]> = { photo: [], video: [], backup: [], unlikely: [] };
  for (const lead of leads) {
    const attached = findAttachedAgent(lead, agentByPhone, agentByName, agentById);
    const section =
      (lead.leadSection as LeadSection | null) ?? leadSectionForListing(lead, attached?.relationshipStatus);
    sections[section].push(lead);
  }
  // Within a section, order by the same priority score the pipeline uses:
  // coming-soon first, then price-weighted photo opportunity, then age.
  for (const key of Object.keys(sections) as LeadSection[]) {
    sections[key].sort(byLeadPriority);
  }

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
            {leads.length} new listing{leads.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ImportListingButton />
          <RefreshButton />
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <PartyPopper className="size-8" />
          <p>You&rsquo;re all caught up — no new leads right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {LEAD_SECTION_ORDER.map((key, index) => {
            const items = sections[key];
            if (items.length === 0) return null;
            const isUnlikely = key === "unlikely";
            return (
              <section key={key}>
                {index > 0 && <Separator className="mb-8" />}
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
