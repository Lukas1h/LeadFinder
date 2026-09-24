import { Fragment, Suspense } from "react";
import { PartyPopper, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { LeadCard } from "./LeadCard";
import { RefreshButton } from "./RefreshButton";
import { ImportListingButton } from "./ImportListingButton";
import { MarkAllNotInterestedButton } from "./MarkAllNotInterestedButton";
import { NewBadge, DuplicateAgentBadge, PhotoScoreBadge, ComingSoonBadge, FewPhotosBadge, AgentDeclinedBadge, WarmAgentBadge } from "./badges";
import { findDuplicateAgentContact, byLeadPriority, FEW_PHOTOS_THRESHOLD, isUnlikelyLeadMatch, findAttachedAgent, buildAgentLookups, isWarmAgentStatus } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";
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
  const { byId: agentById, byPhone: agentByPhone, byName: agentByName } = buildAgentLookups(allAgents);

  // Every other listing referenced by an agent's last-contacted pointer —
  // used only to name the listing in the duplicate-agent warning below.
  const referencedIds = allAgents
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

  // Listings unlikely to be good matches (high photo score with price < $650k,
  // or agent marked declined) are demoted to a dedicated section at the bottom.
  const likelyLeads: Listing[] = [];
  const unlikelyMatches: Listing[] = [];
  for (const lead of leads) {
    if (isUnlikelyLeadMatch(lead, agentByPhone, agentByName)) {
      unlikelyMatches.push(lead);
    } else {
      likelyLeads.push(lead);
    }
  }

  // Cron runs once/day, so anything found in the last 24h is "today's
  // batch" — everything else is backlog from a day (or several) you
  // haven't gotten to yet. Within each, priority order combines coming-soon
  // status, price-weighted photo opportunity, and listing age (see
  // leadPriorityScore in lib/pipeline.ts).
  const newToday = likelyLeads.filter((l) => daysSince(l.foundAt) < 1).sort(byLeadPriority);
  const earlier = likelyLeads.filter((l) => daysSince(l.foundAt) >= 1).sort(byLeadPriority);
  unlikelyMatches.sort(byLeadPriority);

  function card(lead: Listing) {
    const attachedAgent = findAttachedAgent(lead, agentByPhone, agentByName, agentById);
    const duplicateAgent = findDuplicateAgentContact(attachedAgent, lead.id);
    const agentDeclined = attachedAgent?.relationshipStatus === "declined";

    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <Fragment key={lead.id}>
            <NewBadge />
            {lead.isComingSoon && <ComingSoonBadge />}
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
          {newToday.length === 0 && earlier.length === 0 && unlikelyMatches.length > 0 && (
            <p className="text-muted-foreground/70 text-sm">No new priority leads right now.</p>
          )}

          {newToday.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                New today ({newToday.length})
              </h2>
              <div className="flex flex-col gap-4">{newToday.map(card)}</div>
            </section>
          )}

          {earlier.length > 0 && (
            <section>
              {newToday.length > 0 && <Separator className="mb-8" />}
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Earlier ({earlier.length})
              </h2>
              <div className="flex flex-col gap-4">{earlier.map(card)}</div>
            </section>
          )}

          {unlikelyMatches.length > 0 && (
            <section>
              {(newToday.length > 0 || earlier.length > 0) && <Separator className="mb-8" />}
              <details className="group/details">
                <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                  <span className="flex items-center gap-1">
                    <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                    Unlikely matches ({unlikelyMatches.length})
                  </span>
                  <MarkAllNotInterestedButton listingIds={unlikelyMatches.map((l) => l.id)} />
                </summary>
                <div className="flex flex-col gap-4 mt-3">{unlikelyMatches.map(card)}</div>
              </details>
            </section>
          )}
        </div>
      )}
    </>
  );
}
