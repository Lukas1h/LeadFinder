import { Fragment, Suspense } from "react";
import { PartyPopper } from "lucide-react";
import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { LeadCard } from "./LeadCard";
import { RefreshButton } from "./RefreshButton";
import { NewBadge, DuplicateAgentBadge, PhotoScoreBadge, ComingSoonBadge, FewPhotosBadge } from "./badges";
import { findDuplicateAgentContact, byLeadPriority, FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { LeadsSkeleton } from "./loading";

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
  const agentByPhone = new Map(allAgents.map((a) => [a.phone, a]));

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

  // Cron runs once/day, so anything found in the last 24h is "today's
  // batch" — everything else is backlog from a day (or several) you
  // haven't gotten to yet. Within each, priority order is: coming-soon,
  // then very-few-photos, then bad-photo-score, then everything else
  // (see byLeadPriority in lib/pipeline.ts).
  const newToday = leads.filter((l) => daysSince(l.foundAt) < 1).sort(byLeadPriority);
  const earlier = leads.filter((l) => daysSince(l.foundAt) >= 1).sort(byLeadPriority);

  function card(lead: Listing) {
    const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentByPhone);

    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <Fragment key={lead.id}>
            <NewBadge />
            {lead.isComingSoon && <ComingSoonBadge />}
            {lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD && (
              <FewPhotosBadge count={lead.photoCount} />
            )}
            {lead.score != null && (
              <PhotoScoreBadge score={lead.score} reasoning={lead.scoreReasoning} />
            )}
            {duplicateAgent && (
              <DuplicateAgentBadge
                duplicateAgent={duplicateAgent}
                duplicateAddress={addressById.get(duplicateAgent.lastContactedListingId!)}
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
        <RefreshButton />
      </header>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <PartyPopper className="size-8" />
          <p>You&rsquo;re all caught up — no new leads right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
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
        </div>
      )}
    </>
  );
}
