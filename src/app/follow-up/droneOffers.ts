import { db } from "@/db";
import { agents, agentInteractions, bookings, listings, messagePresets, messageSends, type Agent } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { firstName } from "@/lib/sms";

/**
 * "Free drone shots this week": the section at the top of the Follow up page
 * while Lukas tries offering complimentary aerials to agents he already knows,
 * wherever he's driving anyway (started 2026-10-11, after the first such email
 * got a yes in two hours). He may drop it; everything for it is in this file,
 * plus the section in FollowUpList and the `droneOffers` field of the phone's
 * GET /follow-up.
 *
 * Who shows: warm and interested agents with a listing in an area he'll be in
 * (home, or a booking in the next week and the towns on the way to it), who
 * haven't heard from him in MIN_GAP_DAYS, haven't been offered this before,
 * have never booked, and aren't snoozed.
 */

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";
/** The same floor the rest of the page uses: nobody within this many days of the last contact. */
const MIN_GAP_DAYS = 10;
const LOOKAHEAD_DAYS = 7;
/** The template these offers are sent from; a send from it means they've had the offer. */
const DRONE_PRESET_NAME = "Follow-up: free drone shots";

/**
 * Towns that are one stop, and what a drive there passes through. By hand,
 * because the drive-time table (lib/driveTime.ts) only knows how far each town
 * is from home, not which towns are on the same road.
 */
const AREAS: { key: string; name: string; cities: string[]; via: string[] }[] = [
  {
    key: "home",
    name: "Roseburg",
    cities: ["roseburg", "winston", "myrtle creek", "riddle", "sutherlin", "canyonville", "glide", "winchester", "tenmile", "oakland", "camas valley", "umpqua", "days creek"],
    via: [],
  },
  { key: "grantsPass", name: "Grants Pass", cities: ["grants pass", "merlin", "rogue river", "gold hill", "wilderville", "selma", "williams", "cave junction"], via: [] },
  {
    key: "medford",
    name: "Medford",
    cities: ["medford", "central point", "central pt", "jacksonville", "phoenix", "talent", "ashland", "white city", "eagle point", "eagle pt", "shady cove", "trail"],
    via: ["grantsPass"],
  },
  { key: "klamath", name: "Klamath Falls", cities: ["klamath falls", "chiloquin", "keno"], via: ["grantsPass", "medford"] },
  { key: "cottageGrove", name: "Cottage Grove", cities: ["cottage grove", "creswell", "drain", "yoncalla", "lorane"], via: [] },
  {
    key: "eugene",
    name: "Eugene",
    cities: ["eugene", "springfield", "pleasant hill", "veneta", "elmira", "junction city", "coburg", "cheshire", "harrisburg", "lowell", "marcola", "walterville", "noti"],
    via: ["cottageGrove"],
  },
  {
    key: "corvallis",
    name: "Corvallis",
    cities: ["corvallis", "albany", "philomath", "lebanon", "monroe", "brownsville", "halsey", "sweet home"],
    via: ["cottageGrove", "eugene"],
  },
  { key: "salem", name: "Salem", cities: ["salem", "keizer", "turner", "aumsville", "stayton", "independence", "monmouth", "dallas"], via: ["cottageGrove", "eugene", "corvallis"] },
  { key: "coosBay", name: "Coos Bay", cities: ["coos bay", "north bend", "coquille", "bandon", "lakeside"], via: [] },
  { key: "reedsport", name: "Reedsport", cities: ["reedsport", "winchester bay", "scottsburg", "elkton", "florence", "mapleton"], via: [] },
];

const norm = (city: string | null | undefined) => city?.trim().toLowerCase() ?? "";
const areaOf = (city: string | null | undefined) => AREAS.find((a) => a.cities.includes(norm(city))) ?? null;

export interface DroneOfferItem {
  agent: Agent;
  lastReplyAt: Date | null;
  /** "Grants Pass · last contact Sep 16" */
  label: string;
  /** A text to start from. The email version is the template named above. */
  suggestion: string;
}

export interface DroneOfferGroup {
  /** "Thu, Oct 15 · Klamath Falls trip (through Grants Pass, Medford)" */
  title: string;
  items: DroneOfferItem[];
  /** Agents he knows here who heard from him too recently to ask, so an empty group explains itself. */
  heldBack: number;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export async function getDroneOffers(): Promise<DroneOfferGroup[]> {
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return [];
  const ids = known.map((a) => a.id);
  // Read after the first query, not before: the clock can't be read ahead of
  // request-time data while the page is prerendered (the build fails on it).
  const now = Date.now();
  const todayKey = dayKey(new Date(now));

  const [trips, cities, sends, interactions, booked] = await Promise.all([
    // Jobs still to shoot in the coming week: where he'll be.
    db
      .select({ jobDate: bookings.jobDate, city: sql<string | null>`coalesce(${bookings.city}, ${listings.city})` })
      .from(bookings)
      .leftJoin(listings, eq(bookings.listingId, listings.id))
      .where(
        and(
          isNull(bookings.completedAt),
          gte(bookings.jobDate, new Date(now - DAY)),
          lt(bookings.jobDate, new Date(now + LOOKAHEAD_DAYS * DAY))
        )
      ),
    db
      .select({ agentId: listings.agentId, city: listings.city, at: sql<Date>`max(coalesce(${listings.listedAt}, ${listings.foundAt}))` })
      .from(listings)
      .where(inArray(listings.agentId, ids))
      .groupBy(listings.agentId, listings.city),
    db
      .select({ agentId: messageSends.agentId, sentAt: messageSends.sentAt, respondedAt: messageSends.respondedAt, preset: messagePresets.name })
      .from(messageSends)
      .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
      .where(inArray(messageSends.agentId, ids)),
    db
      .select({ agentId: agentInteractions.agentId, direction: agentInteractions.direction, at: agentInteractions.occurredAt, note: agentInteractions.note })
      .from(agentInteractions)
      .where(inArray(agentInteractions.agentId, ids)),
    db.select({ agentId: bookings.contactAgentId }).from(bookings).where(inArray(bookings.contactAgentId, ids)),
  ]);

  const lastTouch = new Map<string, number>();
  const lastIn = new Map<string, number>();
  const offered = new Set<string>(booked.map((b) => b.agentId!).filter(Boolean));
  const bump = (map: Map<string, number>, id: string, t: number) => map.set(id, Math.max(map.get(id) ?? 0, t));
  for (const a of known) if (a.lastContactedAt) bump(lastTouch, a.id, a.lastContactedAt.getTime());
  for (const s of sends) {
    if (!s.agentId) continue;
    bump(lastTouch, s.agentId, s.sentAt.getTime());
    if (s.respondedAt) {
      bump(lastTouch, s.agentId, s.respondedAt.getTime());
      bump(lastIn, s.agentId, s.respondedAt.getTime());
    }
    if (s.preset === DRONE_PRESET_NAME) offered.add(s.agentId);
  }
  for (const i of interactions) {
    bump(lastTouch, i.agentId, i.at.getTime());
    if (i.direction === "inbound") bump(lastIn, i.agentId, i.at.getTime());
    // Offers made outside the app are logged by hand, in his words.
    else if (/drone|aerial/i.test(i.note ?? "")) offered.add(i.agentId);
  }

  // Each agent's towns, newest listing first.
  const townsOf = new Map<string, { city: string; at: number }[]>();
  for (const c of cities) {
    if (!c.agentId || !c.city) continue;
    const list = townsOf.get(c.agentId) ?? [];
    list.push({ city: c.city, at: new Date(c.at).getTime() });
    townsOf.set(c.agentId, list);
  }
  for (const list of townsOf.values()) list.sort((a, b) => b.at - a.at);

  // The stops: each trip out of the home area, soonest first, then home on any day.
  interface Stop {
    title: string;
    /** Lowercased towns that count as this stop. */
    cities: Set<string>;
    /** How the text says when: "on Thursday", "today". Null for home. */
    when: string | null;
  }
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (const t of trips.filter((t) => t.jobDate && t.city).sort((a, b) => a.jobDate!.getTime() - b.jobDate!.getTime())) {
    const area = areaOf(t.city);
    if (area?.key === "home") continue;
    const key = `${dayKey(t.jobDate!)}|${area?.key ?? norm(t.city)}`;
    if (dayKey(t.jobDate!) < todayKey || seen.has(key)) continue;
    seen.add(key);
    const through = (area?.via ?? []).map((k) => AREAS.find((a) => a.key === k)!);
    const day = t.jobDate!.toLocaleDateString("en-US", { weekday: "long", timeZone: TZ });
    stops.push({
      title:
        `${t.jobDate!.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}, ${shortDate(t.jobDate!)} · ${area?.name ?? t.city!.trim()} trip` +
        (through.length ? ` (through ${through.map((a) => a.name).join(", ")})` : ""),
      cities: new Set([...(area?.cities ?? [norm(t.city)]), ...through.flatMap((a) => a.cities)]),
      when: dayKey(t.jobDate!) === todayKey ? "today" : `on ${day}`,
    });
  }
  const home = AREAS.find((a) => a.key === "home")!;
  stops.push({ title: `Any day · around ${home.name}`, cities: new Set(home.cities), when: null });

  const groups: DroneOfferGroup[] = stops.map((s) => ({ title: s.title, items: [], heldBack: 0 }));
  for (const agent of known) {
    if (offered.has(agent.id)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const towns = townsOf.get(agent.id) ?? [];
    // The first stop any of their towns is on: a dated trip before home.
    let at = -1;
    let town: string | null = null;
    for (let i = 0; i < stops.length && at < 0; i++) {
      const match = towns.find((t) => stops[i].cities.has(norm(t.city)));
      if (match) {
        at = i;
        town = match.city.trim();
      }
    }
    if (at < 0 || !town) continue;

    const touched = lastTouch.get(agent.id) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      groups[at].heldBack++;
      continue;
    }
    const name = firstName(agent.name);
    const hey = name ? `Hey ${name}!` : "Hey there!";
    const when = stops[at].when;
    groups[at].items.push({
      agent,
      lastReplyAt: lastIn.has(agent.id) ? new Date(lastIn.get(agent.id)!) : null,
      label: `${town} · ${touched ? `last contact ${shortDate(new Date(touched))}` : "no contact logged"}`,
      suggestion: when
        ? `${hey} I'm going to be in ${town} ${when}, thought I'd check in and say hi. While I'm over there, do you have any properties that need some complimentary drone shots done? I'd love to help you out if so!`
        : `${hey} Thought I'd check in and say hi. I'm doing some complimentary drone shots around ${town} this week, do you have any properties that could use some? I'd love to help you out if so!`,
    });
  }

  const rank = (a: Agent) => (a.relationshipStatus === "interested" ? 0 : 1);
  const newest = (a: Agent) => townsOf.get(a.id)?.[0]?.at ?? 0;
  for (const g of groups) g.items.sort((x, y) => rank(x.agent) - rank(y.agent) || newest(y.agent) - newest(x.agent));
  return groups.filter((g) => g.items.length > 0 || g.heldBack > 0);
}
