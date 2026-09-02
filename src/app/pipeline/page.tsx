import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { ne, inArray } from "drizzle-orm";
import { LeadCard } from "../LeadCard";
import { PipelineActions } from "../PipelineActions";
import { StatusBadge, DuplicateAgentBadge, PhotoScoreBadge } from "../badges";
import { findDuplicateAgentContact, FOLLOW_UP_AFTER_DAYS } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";

export const dynamic = "force-dynamic";

function byOldest(a: Listing, b: Listing, field: "statusChangedAt" | "contactedAt") {
  const aTime = a[field]?.getTime() ?? 0;
  const bTime = b[field]?.getTime() ?? 0;
  return aTime - bTime;
}

export default async function PipelinePage() {
  const all = await db.select().from(listings).where(ne(listings.status, "new"));

  const allAgents = await db.select().from(agents);
  const agentByPhone = new Map(allAgents.map((a) => [a.phone, a]));
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

  const replied = all.filter((l) => l.status === "replied").sort((a, b) => byOldest(a, b, "statusChangedAt"));
  const saved = all.filter((l) => l.status === "saved").sort((a, b) => byOldest(a, b, "statusChangedAt"));
  const followUpDue = all
    .filter(
      (l) => l.status === "contacted" && l.contactedAt != null && daysSince(l.contactedAt) >= FOLLOW_UP_AFTER_DAYS
    )
    .sort((a, b) => byOldest(a, b, "contactedAt"));
  const waiting = all
    .filter(
      (l) => l.status === "contacted" && (l.contactedAt == null || daysSince(l.contactedAt) < FOLLOW_UP_AFTER_DAYS)
    )
    .sort((a, b) => byOldest(a, b, "contactedAt"));
  const closed = all
    .filter((l) => l.status === "booked" || l.status === "declined")
    .sort((a, b) => -byOldest(a, b, "statusChangedAt"));

  const needsAttentionCount = replied.length + saved.length + followUpDue.length;

  function card(lead: Listing) {
    const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentByPhone);
    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <>
            <StatusBadge status={lead.status} />
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
          <PipelineActions
            listingId={lead.id}
            status={lead.status}
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
        <h1 className="text-2xl font-semibold text-gray-900">Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          {all.length} lead{all.length === 1 ? "" : "s"} in progress
        </p>
      </header>

      {all.length === 0 ? (
        <p className="text-gray-500">
          Nothing here yet — save or message a lead from the Leads page to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Needs your attention
            </h2>
            {needsAttentionCount === 0 ? (
              <p className="text-gray-400 text-sm">Nothing needs attention right now.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {replied.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-purple-700 mb-2">
                      Replied — respond
                    </h3>
                    <ul className="flex flex-col gap-4">{replied.map(card)}</ul>
                  </div>
                )}
                {saved.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-blue-700 mb-2">Saved — ready to message</h3>
                    <ul className="flex flex-col gap-4">{saved.map(card)}</ul>
                  </div>
                )}
                {followUpDue.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-amber-700 mb-2">Needs follow-up</h3>
                    <ul className="flex flex-col gap-4">{followUpDue.map(card)}</ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {waiting.length > 0 && (
            <section className="border-t border-gray-200 pt-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Waiting on a reply
              </h2>
              <ul className="flex flex-col gap-4">{waiting.map(card)}</ul>
            </section>
          )}

          {closed.length > 0 && (
            <details className="border-t border-gray-200 pt-8">
              <summary className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 cursor-pointer select-none">
                Closed ({closed.length})
              </summary>
              <ul className="flex flex-col gap-4 mt-3">{closed.map(card)}</ul>
            </details>
          )}
        </div>
      )}
    </main>
  );
}
