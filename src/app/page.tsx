import { db } from "@/db";
import { listings } from "@/db/schema";
import { desc } from "drizzle-orm";
import { PhotoCarousel } from "./PhotoCarousel";

export const dynamic = "force-dynamic";

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

export default async function LeadsPage() {
  const leads = await db
    .select()
    .from(listings)
    .orderBy(desc(listings.foundAt));

  return (
    <main className="max-w-6xl mx-auto w-full px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">LeadFinder</h1>
        <p className="text-sm text-gray-500 mt-1">
          {leads.length} lead{leads.length === 1 ? "" : "s"}
        </p>
      </header>

      {leads.length === 0 ? (
        <p className="text-gray-500">
          No leads yet. Trigger the sync route to pull new listings.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {leads.map((lead) => (
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
