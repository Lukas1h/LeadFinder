import { db } from "@/db";
import { listings } from "@/db/schema";
import { desc } from "drizzle-orm";

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
  const leads = await db
    .select()
    .from(listings)
    .orderBy(desc(listings.foundAt));

  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-10">
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
        <ul className="divide-y divide-gray-200 border-t border-b border-gray-200">
          {leads.map((lead) => (
            <li key={lead.id} className="py-4 flex flex-col gap-1">
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
