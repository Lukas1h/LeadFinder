import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { LeadCard } from "./LeadCard";
import { NewBadge, DuplicateAgentBadge, PhotoScoreBadge, ComingSoonBadge, FewPhotosBadge } from "./badges";
import { findDuplicateAgentContact, byLeadPriority, FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  // foundAt is transaction-time, so a batch insert gives every row in it
  // the exact same value — listings.id as a tiebreaker keeps order stable
  // across renders instead of reshuffling ties arbitrarily.
  const leads = await db
    .select()
    .from(listings)
    .where(eq(listings.status, "new"))
    .orderBy(desc(listings.foundAt), listings.id);

  const allAgents = await db.select().from(agents);
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
          <>
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
          </>
        }
        actions={
          <LeadActions
            listingId={lead.id}
            address={lead.address}
            agentName={lead.agentName}
            agentPhone={lead.agentPhone}
          />
        }
      />
    );
  }

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Leads</h1>
        <p className="text-sm text-gray-500 mt-1">
          {leads.length} new listing{leads.length === 1 ? "" : "s"}
        </p>
      </header>

      {leads.length === 0 ? (
        <p className="text-gray-500">You&rsquo;re all caught up — no new leads right now.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {newToday.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                New today ({newToday.length})
              </h2>
              <ul className="flex flex-col gap-4">{newToday.map(card)}</ul>
            </section>
          )}

          {earlier.length > 0 && (
            <section className={newToday.length > 0 ? "border-t border-gray-200 pt-8" : undefined}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Earlier ({earlier.length})
              </h2>
              <ul className="flex flex-col gap-4">{earlier.map(card)}</ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
