import { db } from "@/db";
import { agents, bookings, listings } from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { brokerageByAgent } from "@/lib/agentBrokerage";
import { estimateDriveMinutes } from "@/lib/driveTime";

/**
 * Brokerages Lukas has shot for, keyed by a normalized office name.
 *
 * Having shot for someone at an agent's office ("I shot 123 Main for Sarah over
 * at Oregon Life Homes") is a warm opener even to an agent he's never met. A
 * client's office is the brokerage typed on their agent record, else their
 * latest listing's broker name; the address is their
 * most recent booking, so the line can name a real shoot.
 *
 * Server-only (it queries the DB).
 */
export interface OfficeClient {
  agentId: string;
  name: string | null;
  brokerage: string;
  address: string | null;
  /** Cities of their jobs and listings — the area the connection means something in. */
  cities: string[];
}

/**
 * "Oregon Life Homes, LLC" and "OREGON LIFE HOMES" are the same office. Only
 * legal suffixes and punctuation go: franchise offices differ by the rest of
 * the name ("Coldwell Banker Bain" vs "Coldwell Banker Professional Group").
 */
export function officeKey(brokerName: string | null): string | null {
  if (!brokerName) return null;
  const key = brokerName
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|co|corp|ltd|pc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key || null;
}

export async function clientOffices(): Promise<Map<string, OfficeClient[]>> {
  const booked = await db
    .select({
      agentId: bookings.contactAgentId,
      address: bookings.address,
      city: bookings.city,
      listingAddress: listings.address,
      listingCity: listings.city,
    })
    .from(bookings)
    .leftJoin(listings, eq(bookings.listingId, listings.id))
    .where(isNotNull(bookings.contactAgentId))
    .orderBy(sql`${bookings.jobDate} desc nulls last`);
  if (booked.length === 0) return new Map();

  const ids = [...new Set(booked.map((b) => b.agentId!))];
  const [brokerages, names] = await Promise.all([
    brokerageByAgent(),
    db.select({ id: agents.id, name: agents.name, brokerage: agents.brokerage }).from(agents).where(inArray(agents.id, ids)),
  ]);
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  const typedById = new Map(names.map((n) => [n.id, n.brokerage]));

  // Every client per office, newest job first: a big franchise office covers
  // several towns, and which client to name depends on where the lead is.
  const offices = new Map<string, OfficeClient[]>();
  const byAgent = new Map<string, OfficeClient>();
  for (const b of booked) {
    const city = b.listingCity ?? b.city;
    const known = byAgent.get(b.agentId!);
    if (known) {
      if (city && !known.cities.includes(city)) known.cities.push(city);
      continue;
    }
    // A brokerage typed on the agent wins; otherwise their latest listing's.
    const brokerage = typedById.get(b.agentId!) || brokerages.get(b.agentId!);
    const key = officeKey(brokerage ?? null);
    if (!brokerage || !key) continue;
    const client: OfficeClient = {
      agentId: b.agentId!,
      name: nameById.get(b.agentId!) ?? null,
      brokerage,
      address: b.listingAddress ?? b.address,
      cities: city ? [city] : [],
    };
    byAgent.set(b.agentId!, client);
    offices.set(key, [...(offices.get(key) ?? []), client]);
  }

  // Where they list counts as their area too: Kristi works out of Eugene even
  // though the job was in Roseburg.
  const listed = byAgent.size === 0 ? [] : await db
    .selectDistinct({ agentId: listings.agentId, city: listings.city })
    .from(listings)
    .where(and(inArray(listings.agentId, [...byAgent.keys()]), isNotNull(listings.city)));
  for (const l of listed) {
    const client = byAgent.get(l.agentId!);
    if (client && l.city && !client.cities.includes(l.city)) client.cities.push(l.city);
  }
  return offices;
}

// "RE/MAX Integrity" is one name across Roseburg and Central Point, and
// shooting for someone three towns away means nothing to the agent. Drive
// times are all measured from Winston, so two towns within half an hour of
// each other on that scale are treated as one area — Sutherlin and Roseburg
// match, Central Point and Roseburg don't. A city missing from the table never
// matches rather than guessing.
const SAME_AREA_MINUTES = 30;

export function sameArea(cityA: string | null, cityB: string): boolean {
  if (!cityA) return false;
  const a = estimateDriveMinutes(cityA);
  const b = estimateDriveMinutes(cityB);
  return a != null && b != null && Math.abs(a - b) <= SAME_AREA_MINUTES;
}

/** The client to name for a lead: same office, and one of their jobs near any of the agent's listings. */
export function officeClientFor(
  offices: Map<string, OfficeClient[]>,
  brokerName: string | null,
  listingCities: (string | null)[]
): OfficeClient | null {
  const clients = offices.get(officeKey(brokerName) ?? "") ?? [];
  return clients.find((c) => c.cities.some((city) => listingCities.some((l) => sameArea(l, city)))) ?? null;
}
