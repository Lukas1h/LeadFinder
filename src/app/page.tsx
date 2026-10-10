import { Fragment, Suspense } from "react";
import { PartyPopper, ChevronRight } from "lucide-react";
import { AgentLeadCard } from "./AgentLeadCard";
import { LeadActions } from "./LeadActions";
import { RefreshButton } from "./RefreshButton";
import { ImportListingButton } from "./ImportListingButton";
import { PassAllListingsButton } from "./PassAllListingsButton";
import { NewBadge, PhotoScoreBadge, ComingSoonBadge, PriceCutBadge, FewPhotosBadge, AgentDeclinedBadge, OfficeClientBadge, UnscoredBadge } from "./badges";
import { FEW_PHOTOS_THRESHOLD, isUnscored } from "@/lib/pipeline";
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

/**
 * This many recent leads without a score means scoring itself is broken, not
 * that a few photos failed to download (a normal day leaves one at most).
 */
const SCORING_DOWN_COUNT = 10;

/**
 * How many cards a section renders before "Show N more". The page was 13 MB
 * with all ~550 cards on it (each is a dozen kilobytes of markup plus its
 * data), and every Pass or Text re-renders the lot. Sections are sorted most
 * worth texting first, so the first sixty are several days of work; the rest
 * are one tap away (?show=backup), and Unlikely, which starts folded shut
 * anyway, renders nothing until asked.
 */
const SECTION_LIMIT = 60;

type LeadsSearchParams = Promise<{ show?: string | string[] }>;

export default function LeadsPage({ searchParams }: { searchParams: LeadsSearchParams }) {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      {/* searchParams is request-time data, so it's read below this boundary. */}
      <Suspense fallback={<LeadsSkeleton />}>
        <LeadsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LeadsContent({ searchParams }: { searchParams: LeadsSearchParams }) {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.

  const { show } = await searchParams;
  // Sections asked for in full: ?show=backup, ?show=backup,unlikely.
  const shown = new Set(([] as string[]).concat(show ?? []).flatMap((s) => s.split(",")).filter(Boolean));

  // Cards show a handful of each listing's photos; the listing dialog fetches
  // the whole gallery when it opens (see ListingModal).
  const { known, sections, openLeadCount, queuedCount, agentCount, addressById, unscoredCount } = await getLeadsBoard({
    cardPhotosOnly: true,
  });

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
            {isUnscored(lead) && <UnscoredBadge />}
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

      {unscoredCount >= SCORING_DOWN_COUNT && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p className="font-medium">Photo scoring isn&rsquo;t running</p>
          <p className="mt-1">
            {unscoredCount} recent listings have no photo score, so they&rsquo;re under Photo opportunities whether
            their photos are bad or not. The usual cause is the Gemini account running out of credit:{" "}
            <a href="https://ai.studio/projects" target="_blank" rel="noreferrer" className="underline">
              top it up
            </a>
            , then tap Refresh and they score themselves.
          </p>
        </div>
      )}

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
            const all = shown.has(key);
            const visible = all ? items : items.slice(0, isUnlikely ? 0 : SECTION_LIMIT);
            const hidden = items.length - visible.length;
            return (
              <section key={key}>
                {(index > 0 || known.length > 0) && <Separator className="mb-8" />}
                <details className="group/details" open={!isUnlikely || all}>
                  <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                    <span className="flex items-center gap-1">
                      <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                      {LEAD_SECTION_LABELS[key]} ({items.length})
                    </span>
                    {isUnlikely && (
                      <PassAllListingsButton listingIds={items.flatMap((g) => g.entries.map((e) => e.lead.id))} />
                    )}
                  </summary>
                  <div className="flex flex-col gap-4 mt-3">
                    {visible.map(card)}
                    {hidden > 0 && (
                      <Link
                        href={`/?show=${[...shown, key].join(",")}`}
                        scroll={false}
                        className="self-center rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {visible.length === 0 ? `Show all ${hidden}` : `Show ${hidden} more`}
                      </Link>
                    )}
                  </div>
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
