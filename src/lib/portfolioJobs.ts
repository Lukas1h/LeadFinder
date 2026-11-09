import { and, desc, eq, isNotNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, listings, type PortfolioListing } from "@/db/schema";
import { formatPrice } from "@/lib/format";
import { marketNews } from "@/lib/marketStatus";

/** Finished jobs with a gallery, newest first, as listing cards — plus the bare city, for ranking by distance. */
export async function finishedJobs(extra?: SQL, limit = 60): Promise<{ listing: PortfolioListing; city: string }[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
      completedAt: bookings.completedAt,
      invoicedAt: bookings.invoicedAt,
      marketStatus: bookings.marketStatus,
      price: listings.price,
      beds: listings.bedrooms,
      baths: listings.bathrooms,
      sqft: listings.livingArea,
      homeType: listings.homeType,
      zipcode: listings.zipcode,
      listingAgent: listings.agentName,
      listingBroker: listings.brokerName,
      contactName: agents.name,
      contactBrokerage: agents.brokerage,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(agents, eq(agents.id, bookings.contactAgentId))
    .where(and(isNotNull(bookings.dropboxFolderLink), or(isNotNull(bookings.completedAt), isNotNull(bookings.invoicedAt)), extra))
    .orderBy(desc(bookings.completedAt), desc(bookings.invoicedAt))
    .limit(limit);

  return rows.map((r) => {
    const finished = r.completedAt ?? r.invoicedAt;
    const recent = finished != null && Date.now() - finished.getTime() < 45 * 24 * 60 * 60 * 1000;
    const listing: PortfolioListing = {
      bookingId: r.bookingId,
      status: marketLabel(r.marketStatus) ?? (recent ? "Just listed" : "Recent work"),
      price: r.price != null ? formatPrice(r.price) : "",
      beds: r.beds != null ? String(Number(r.beds)) : "",
      baths: r.baths != null ? String(Number(r.baths)) : "",
      sqft: r.sqft != null ? r.sqft.toLocaleString("en-US") : "",
      type: homeTypeLabel(r.homeType),
      address: r.address ?? "",
      city: [r.city, [r.state ?? "OR", r.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      agent: r.listingAgent ?? r.contactName ?? "",
      brokerage: r.listingBroker ?? r.contactBrokerage ?? "",
    };
    return { listing, city: r.city ?? "" };
  });
}

/** The card badge for a job whose listing has moved on (lib/marketStatus.ts's nightly check). */
function marketLabel(status: string | null): string | null {
  const kind = marketNews(status);
  return kind === "sold" ? "Sold" : kind === "pending" ? "Pending" : kind === "under_contract" ? "Under contract" : null;
}

/** Zillow's "SINGLE_FAMILY" → "Single family". */
function homeTypeLabel(homeType: string | null): string {
  if (!homeType) return "";
  const words = homeType.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
