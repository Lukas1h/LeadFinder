import { db } from "@/db";
import { listings, agents } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { LeadActions } from "./LeadActions";

export const dynamic = "force-dynamic";

function formatPrice(price: number | null) {
  if (price == null) return "—";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
            const priorAgentContact =
              lead.agentPhone != null ? agentByPhone.get(lead.agentPhone) : undefined;
            const duplicateAgentListingId =
              priorAgentContact?.lastContactedListingId &&
              priorAgentContact.lastContactedListingId !== lead.id
                ? priorAgentContact.lastContactedListingId
                : null;
            const duplicateAgentAddress = duplicateAgentListingId
              ? addressById.get(duplicateAgentListingId)
              : null;

            return (
              <li
                key={lead.id}
                className="flex flex-col sm:flex-row gap-4 bg-white border border-gray-200 rounded-xl shadow-sm p-4"
              >
                <div className="shrink-0 w-full sm:w-40 h-40 sm:h-32 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                  {lead.photos && lead.photos.length > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lead.photos[0]}
                      alt={lead.address ?? "Listing photo"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-gray-400 text-sm">No photo</span>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={lead.listingUrl ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-900 hover:underline"
                      >
                        {lead.address ?? "Unknown address"}
                      </a>
                      <span className="text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">
                        New
                      </span>
                      {duplicateAgentListingId && (
                        <span
                          title={`Already contacted ${priorAgentContact!.name ?? "this agent"} on ${formatDate(
                            priorAgentContact!.lastContactedAt
                          )} about ${duplicateAgentAddress ?? "another listing"}`}
                          className="text-xs font-medium bg-amber-100 text-amber-800 rounded-full px-2 py-0.5"
                        >
                          ⚠ Already contacted
                        </span>
                      )}
                    </div>

                    <div className="text-xl font-semibold text-gray-900 mt-1">
                      {formatPrice(lead.price)}
                    </div>

                    <div className="text-sm text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      <span>{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
                      <span>
                        {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
                      </span>
                      <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
                      <span>Listed {formatDate(lead.listedAt)}</span>
                    </div>

                    {lead.agentName && (
                      <div className="text-sm mt-1.5">
                        <span className="text-gray-800">{lead.agentName}</span>
                        {lead.brokerName && (
                          <span className="text-gray-400"> · {lead.brokerName}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <LeadActions
                    listingId={lead.id}
                    address={lead.address}
                    agentName={lead.agentName}
                    agentPhone={lead.agentPhone}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
