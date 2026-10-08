import { db } from "@/db";
import { agents, bookings, listings } from "@/db/schema";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { brokerageByAgent } from "@/lib/agentBrokerage";

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

export async function clientOffices(): Promise<Map<string, OfficeClient>> {
  const booked = await db
    .select({ agentId: bookings.contactAgentId, address: bookings.address, listingAddress: listings.address })
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

  const offices = new Map<string, OfficeClient>();
  for (const b of booked) {
    // A brokerage typed on the agent wins; otherwise their latest listing's.
    const brokerage = typedById.get(b.agentId!) || brokerages.get(b.agentId!);
    const key = officeKey(brokerage ?? null);
    // Newest job first, so the first client seen per office is the freshest intro.
    if (!brokerage || !key || offices.has(key)) continue;
    offices.set(key, {
      agentId: b.agentId!,
      name: nameById.get(b.agentId!) ?? null,
      brokerage,
      address: b.listingAddress ?? b.address,
    });
  }
  return offices;
}
