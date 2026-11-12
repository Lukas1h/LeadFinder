import { db } from "@/db";
import { agents } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { marketFor, type Market } from "@/lib/markets";

/** Portland, its 971 overlay and Vancouver WA — the metro's area codes. */
const PORTLAND_AREA_CODES = new Set(["503", "971", "360"]);

/** The area code of a phone number as stored (any formatting, optional leading 1). */
function areaCode(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  return digits.length === 10 ? digits.slice(0, 3) : null;
}

/**
 * The market each agent belongs to, for splitting the Home funnel by market.
 *
 * An agent row has no address of its own, so this takes the best clue it has,
 * in order:
 *
 * 1. Their most recent listing (by foundAt) — where they actually work, and
 *    the only clue that carries a geocode for cities missing from the drive
 *    table. The latest one rather than homeCity because homeCity is only
 *    refreshed for agents he knows, and a stale city moves them to the wrong
 *    tab.
 * 2. agents.homeCity, the city most of their tracked listings are in (see
 *    lib/agentHomeCity.ts). Agents carry no state — everyone on file is in
 *    Oregon or Washington, and the WA cases have a listing anyway.
 * 3. The phone's area code: 503/971/360 is the Portland metro, anything else
 *    (including no phone) is regional. Never local — without an address,
 *    claiming someone is in the home ring is the guess most likely to be
 *    wrong.
 *
 * Two queries (one DISTINCT ON over listings, one over agents). Server-only.
 */
export async function agentMarkets(ids: string[]): Promise<Map<string, Market>> {
  const unique = [...new Set(ids)];
  const byAgent = new Map<string, Market>();
  if (unique.length === 0) return byAgent;

  const [latest, known] = await Promise.all([
    // DISTINCT ON needs its expressions to match the leftmost ORDER BY, which
    // the query builder can't express, so this one is raw (as agentBrokerage).
    db.execute(sql`
      select distinct on (agent_id) agent_id, city, state, lat, lng, geocode_source, found_at
      from listings
      where agent_id in (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
      order by agent_id, found_at desc
    `),
    db
      .select({ id: agents.id, homeCity: agents.homeCity, phone: agents.phone })
      .from(agents)
      .where(inArray(agents.id, unique)),
  ]);

  const listingByAgent = new Map(
    (
      latest.rows as {
        agent_id: string;
        city: string | null;
        state: string | null;
        lat: number | null;
        lng: number | null;
        geocode_source: string | null;
      }[]
    ).map((row) => [row.agent_id, row] as const),
  );
  const agentById = new Map(known.map((a) => [a.id, a] as const));

  // Over the ids asked for, not the agent rows, so every id gets a market and
  // callers can bucket every agent they tally.
  for (const id of unique) {
    const listing = listingByAgent.get(id);
    if (listing) {
      byAgent.set(
        id,
        marketFor({
          city: listing.city,
          state: listing.state,
          lat: listing.lat,
          lng: listing.lng,
          geocodeSource: listing.geocode_source,
        }),
      );
      continue;
    }
    const agent = agentById.get(id);
    if (agent?.homeCity) {
      byAgent.set(id, marketFor({ city: agent.homeCity }));
      continue;
    }
    const code = areaCode(agent?.phone ?? null);
    byAgent.set(id, code && PORTLAND_AREA_CODES.has(code) ? "portland" : "regional");
  }
  return byAgent;
}
