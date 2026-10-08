import type { Agent, AgentRelationshipStatus, Listing } from "@/db/schema";
import { FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { isBuilderListing } from "@/lib/leadSections";
import { agentDeclinedBadge, fewPhotosBadge, photoScoreTier, priceCutBadge, type BadgeText } from "@/lib/leadBadges";
import type { BookingWithDetails } from "@/app/booked/BookedList";
import type { LeadGroup } from "@/app/leads-data";

/**
 * DB rows → JSON for the iPhone app (/api/app/v1/*).
 *
 * Everything the app shows exists as a React component in the web app, and
 * those components can't be imported server-side (they're "use client"). So
 * each row is flattened to plain data here and the app draws it itself. The
 * wording it needs (badges, caller labels) comes from plain modules that the
 * web components also render from, rather than being retyped — see
 * lib/leadBadges.ts.
 *
 * Dates are left as Date objects: NextResponse.json serializes them to ISO
 * strings on the way out.
 */

/**
 * Postgres `numeric` columns arrive as strings; the app wants JSON numbers, and
 * `number | null` rather than 0 for "not recorded".
 */
function numericToNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `photos` is trimmed to the first URL for list endpoints — a card needs one
 * image, and the full array on every lead would multiply the payload by an
 * order of magnitude. Detail endpoints ask for "all".
 *
 * altZpids is the one column left out: it's Zillow's bookkeeping for
 * deduplication (see lib/listingDedupe.ts), which means nothing to the app.
 */
export function listingJson(l: Listing, photos: "first" | "all") {
  const { altZpids, bedrooms, bathrooms, photos: allPhotos, ...rest } = l;
  void altZpids;

  return {
    ...rest,
    bedrooms: numericToNumber(bedrooms),
    bathrooms: numericToNumber(bathrooms),
    photos: photos === "all" ? allPhotos : allPhotos?.slice(0, 1) ?? [],
  };
}

/**
 * The badges a lead card shows, in the same order card() renders them in
 * src/app/page.tsx.
 */
export function leadBadges(lead: Listing, agent: Agent | null, declinedAddress?: string | null): BadgeText[] {
  const badges: BadgeText[] = [{ kind: "new", label: "New" }];

  if (lead.isComingSoon) badges.push({ kind: "comingSoon", label: "Coming soon" });

  const cut = priceCutBadge(lead);
  if (cut) badges.push(cut);

  if (lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD) {
    badges.push(fewPhotosBadge(lead.photoCount));
  }

  if (lead.score != null) {
    badges.push({ kind: "photoScore", label: photoScoreTier(lead.score).label, detail: lead.scoreReasoning ?? undefined });
  }

  if (isBuilderListing(lead.brokerName)) badges.push({ kind: "builder", label: "Builder" });

  if (agent?.relationshipStatus === "declined") {
    const declined = agentDeclinedBadge(agent, declinedAddress);
    if (declined) badges.push(declined);
  }

  return badges;
}

/** One lead card: the agent, the listing that leads the card, and the rest. */
export function leadGroupJson(g: LeadGroup, addressById: Map<string, string | null>) {
  const best = g.best;
  const agent = g.agent;

  return {
    key: g.key,
    agent: agent ? agentJson(agent) : null,
    // Straight off the best listing, as the web card does — they're the
    // listing's snapshot of the source, which is what's displayed there.
    agentName: best.agentName,
    agentPhone: best.agentPhone,
    brokerName: best.brokerName,
    contactLine: g.contactLine,
    knownGroup: g.known ?? null,
    section: g.section,
    best: listingJson(best, "first"),
    badges: leadBadges(best, agent, agent?.lastContactedListingId ? addressById.get(agent.lastContactedListingId) : null),
    others: g.entries.slice(1).map((e) => listingJson(e.lead, "first")),
    // Every listing in the card, so the app's Pass can drop the whole group the
    // way the web's "Pass all N" does.
    listingIds: g.entries.map((e) => e.lead.id),
  };
}

/** The bare agent row, as the Agents tab shows it. */
export function agentJson(agent: Agent) {
  const { id, name, phone, email, relationshipStatus, lastContactedAt, notes, createdAt } = agent;
  return { id, name, phone, email, relationshipStatus, lastContactedAt, notes, createdAt };
}

export function bookingJson(b: BookingWithDetails) {
  return {
    id: b.id,
    listingId: b.listingId,
    contactAgentId: b.contactAgentId,
    address: b.address,
    city: b.city,
    state: b.state,
    listing: b.listing ? listingJson(b.listing, "first") : null,
    jobDate: b.jobDate,
    lockboxCode: b.lockboxCode,
    notes: b.notes,
    invoiceNote: b.invoiceNote,
    completedAt: b.completedAt,
    invoiceSentAt: b.invoiceSentAt,
    driveHours: b.driveHours,
    editingHours: b.editingHours,
    shootingHours: b.shootingHours,
    logisticsHours: b.logisticsHours,
    additionalCosts: b.additionalCosts,
    createdAt: b.createdAt,
    contactName: b.contactName,
    contactPhone: b.contactPhone,
    lineItems: b.lineItems,
    total: b.lineItems.reduce((sum, item) => sum + item.amount, 0),
    driveTime: b.driveTime,
    invoiceNumber: b.invoiceNumber,
    invoicedAt: b.invoicedAt,
    dropboxFolderLink: b.dropboxFolderLink,
    galleryUrl: b.galleryToken ? `https://gallery.lukashahn.art/${b.galleryToken}` : null,
    // "1811 NE Alameda Ave, Eugene, OR" — what the app hands to Maps for the
    // directions sheet. Empty parts are dropped so a half-filled booking
    // doesn't turn into ", , OR".
    mapsQuery: [b.address, b.city, b.state].filter(Boolean).join(", ") || null,
  };
}

// The tag the app shows next to a caller ID: how Lukas knows them.
const RELATIONSHIP_TAGS: Record<AgentRelationshipStatus, string> = {
  regular: "Client",
  worked_once: "Client",
  interested: "Interested",
  warm: "Warm",
  declined: "Declined",
  // Cold has no relationship to report, so it borrows the one useful fact we
  // do have: who they work for.
  cold: "Realtor",
};

/** "Jane Doe · Warm", or "Jane Doe · Coldwell Banker" for a cold agent. */
export function callerLabel(agent: Pick<Agent, "name" | "relationshipStatus">, brokerage: string | null | undefined): string {
  const tag =
    agent.relationshipStatus === "cold"
      ? brokerage?.trim() || RELATIONSHIP_TAGS.cold
      : RELATIONSHIP_TAGS[agent.relationshipStatus];
  return `${agent.name ?? "Unknown agent"} · ${tag}`;
}

/**
 * The number iOS caller ID matches on: "1" + the 10 digits, as a plain number.
 * Null unless it's exactly a 10-digit US number after dropping a leading 1 —
 * an extension or a foreign number would silently produce a wrong caller ID
 * entry, which is worse than none.
 */
export function callerNumber(phone: string | null | undefined): number | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return Number(digits);
  if (digits.length === 10) return Number(`1${digits}`);
  return null;
}
