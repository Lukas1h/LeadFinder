import { db } from "@/db";
import { listings, agents, LEAD_STATUSES, type LeadStatus } from "@/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { PhotoCarousel } from "./PhotoCarousel";
import { StatusControl } from "./StatusControl";

export const dynamic = "force-dynamic";

const FOLLOW_UP_AFTER_DAYS = 3;

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  booked: "Booked",
  declined: "Declined",
};

function formatPrice(price: number | null) {
  if (price == null) return "—";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function smsHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `sms:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `sms:+${digits}`;
  return null;
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const activeFilter = LEAD_STATUSES.find((s) => s === statusFilter);

  // foundAt is transaction-time, so a batch insert gives every row in it
  // the exact same value — listings.id as a tiebreaker keeps order stable
  // across renders instead of reshuffling ties arbitrarily.
  const allLeads = await db
    .select()
    .from(listings)
    .orderBy(desc(listings.foundAt), listings.id);
  const allAgents = await db.select().from(agents);

  const leadById = new Map(allLeads.map((l) => [l.id, l]));
  const agentByPhone = new Map(allAgents.map((a) => [a.phone, a]));

  const leads = activeFilter ? allLeads.filter((l) => l.status === activeFilter) : allLeads;

  return (
    <main className="max-w-6xl mx-auto w-full px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">LeadFinder</h1>
        <p className="text-sm text-gray-500 mt-1">
          {leads.length} lead{leads.length === 1 ? "" : "s"}
        </p>
        <nav className="flex flex-wrap gap-2 mt-4">
          <Link
            href="/"
            className={`text-sm rounded-full px-3 py-1 border ${
              !activeFilter ? "bg-gray-900 text-white border-gray-900" : "border-gray-300"
            }`}
          >
            All ({allLeads.length})
          </Link>
          {LEAD_STATUSES.map((s) => {
            const count = allLeads.filter((l) => l.status === s).length;
            return (
              <Link
                key={s}
                href={`/?status=${s}`}
                className={`text-sm rounded-full px-3 py-1 border ${
                  activeFilter === s ? "bg-gray-900 text-white border-gray-900" : "border-gray-300"
                }`}
              >
                {STATUS_LABELS[s]} ({count})
              </Link>
            );
          })}
        </nav>
      </header>

      {leads.length === 0 ? (
        <p className="text-gray-500">
          {allLeads.length === 0
            ? "No leads yet. Trigger the sync route to pull new listings."
            : "No leads with this status."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {leads.map((lead) => {
            const needsFollowUp =
              lead.status === "contacted" &&
              lead.contactedAt != null &&
              daysSince(lead.contactedAt) >= FOLLOW_UP_AFTER_DAYS;

            const priorAgentContact =
              lead.agentPhone != null ? agentByPhone.get(lead.agentPhone) : undefined;
            const duplicateAgentWarning =
              priorAgentContact &&
              priorAgentContact.lastContactedListingId != null &&
              priorAgentContact.lastContactedListingId !== lead.id
                ? leadById.get(priorAgentContact.lastContactedListingId)
                : null;

            return (
              <li key={lead.id} className="flex flex-col gap-2">
                <PhotoCarousel
                  photos={lead.photos ?? []}
                  alt={lead.address ?? "Listing photo"}
                />
                <div className="flex items-baseline justify-between gap-4">
                  <a
                    href={lead.listingUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {lead.address ?? "Unknown address"}
                  </a>
                  <span className="font-medium whitespace-nowrap">
                    {formatPrice(lead.price)}
                  </span>
                </div>
                <div className="text-sm text-gray-500 flex flex-wrap gap-x-3">
                  <span>
                    {[lead.city, lead.state, lead.zipcode].filter(Boolean).join(", ")}
                  </span>
                  <span>
                    {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
                  </span>
                  <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
                  <span>Listed {formatDate(lead.listedAt)}</span>
                </div>

                {(lead.brokerName || lead.agentName) && (
                  <div className="text-sm text-gray-600 border-t border-gray-100 pt-2 mt-1 flex items-center justify-between gap-2">
                    <div>
                      {lead.agentName && <div>{lead.agentName}</div>}
                      {lead.brokerName && <div>{lead.brokerName}</div>}
                    </div>
                    {lead.agentPhone && smsHref(lead.agentPhone) && (
                      <a
                        href={smsHref(lead.agentPhone)!}
                        className="shrink-0 text-sm font-medium border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
                      >
                        Text {lead.agentPhone}
                      </a>
                    )}
                  </div>
                )}

                {duplicateAgentWarning && (
                  <p className="text-sm text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    Already contacted {priorAgentContact!.name ?? "this agent"} (same phone) on{" "}
                    {formatDate(priorAgentContact!.lastContactedAt)} about{" "}
                    {duplicateAgentWarning.address ?? "another listing"}.
                  </p>
                )}

                {needsFollowUp && (
                  <p className="text-sm text-blue-600 bg-blue-50 rounded-md px-2 py-1">
                    Contacted {daysSince(lead.contactedAt!)} days ago, no reply yet — follow up?
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 mt-1">
                  <StatusControl listingId={lead.id} status={lead.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
