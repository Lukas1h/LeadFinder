import { Fragment, Suspense } from "react";
import { PartyPopper, ChevronRight } from "lucide-react";
import { AgentLeadCard } from "./AgentLeadCard";
import { LeadActions } from "./LeadActions";
import { RefreshButton } from "./RefreshButton";
import { ImportListingButton } from "./ImportListingButton";
import { PassAllListingsButton } from "./PassAllListingsButton";
import { NewBadge, PhotoScoreBadge, ComingSoonBadge, PriceCutBadge, FewPhotosBadge, AgentDeclinedBadge, OfficeClientBadge } from "./badges";
import { FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { isBuilderListing, LEAD_SECTION_LABELS, LEAD_SECTION_ORDER } from "@/lib/leadSections";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { LeadsSkeleton } from "./loading";
import Link from "next/link";
import { KnownAgentLeads } from "./KnownAgentLeads";
import { getLeadsBoard, type LeadGroup } from "./leads-data";

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

  const { known, sections, openLeadCount, queuedCount, agentCount, addressById } = await getLeadsBoard();

  function card(g: LeadGroup) {
    const lead = g.best;
    const agent = g.agent;
    const ids = g.entries.map((e) => e.lead.id);

    return (
      <AgentLeadCard
        key={g.key}
        agent={agent}
        agentName={lead.agentName}
        brokerName={lead.brokerName}
        contactLine={g.contactLine}
        lead={lead}
        others={g.entries.slice(1).map((e) => e.lead)}
        badges={
          <Fragment key={lead.id}>
            <NewBadge />
            {g.officeClient && <OfficeClientBadge client={g.officeClient} />}
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
            {agentCount} agent{agentCount === 1 ? "" : "s"} · {openLeadCount} listing
            {openLeadCount === 1 ? "" : "s"}
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

      {openLeadCount === 0 ? (
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
