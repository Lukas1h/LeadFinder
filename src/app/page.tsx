import { db } from "@/db";
import { listings, agents } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";
import { LeadCard } from "./LeadCard";
import { NewBadge, DuplicateAgentBadge } from "./badges";
import { findDuplicateAgentContact } from "@/lib/pipeline";

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
        <ul className="flex flex-col gap-4">
          {leads.map((lead) => {
            const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentByPhone);

            return (
              <LeadCard
                key={lead.id}
                lead={lead}
                badges={
                  <>
                    <NewBadge />
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
          })}
        </ul>
      )}
    </main>
  );
}
