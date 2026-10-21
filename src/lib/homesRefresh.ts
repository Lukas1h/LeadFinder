// Keeps the homes.com stats (deals a year, average sale price, license) fresh
// for everyone Lukas knows: clients, interested and warm agents. Run daily by
// /api/cron/homes-refresh; each run takes whoever is due, oldest first:
// never checked, or last checked more than REFRESH_DAYS ago. Every attempt
// is stamped (homesCheckedAt), found or not, so an agent homes.com doesn't
// list costs one search a month rather than one a day.
//
// Per agent: the profile URL we already have, or the directory search
// (homesApi.ts, plain fetch) narrowed to Oregon and to their name, city and
// brokerage; then the page itself through the unblocker (homesFetch.ts);
// then the parser and the save (homesProfile.ts, homesCapture.ts).

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings, type Agent } from "@/db/schema";
import { searchHomesAgents, HomesBlockedError, type HomesSuggestion } from "./homesApi";
import { fetchHomesProfileHtml, HomesFetchError } from "./homesFetch";
import { captureHomesProfile, looseNameKey, nameKey } from "./homesCapture";
import { parseHomesProfile } from "./homesProfile";

export const REFRESH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** Several same-name profiles in Oregon and nothing to tell them apart: fetch this many and match the phone. */
const MAX_CANDIDATE_FETCHES = 3;
/** This many fetch failures in a row means the service is down or out of credit: stop for today. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Between directory searches: homes.com watches bursts on that API more closely than page loads. */
const SEARCH_PAUSE_MS = 1_500;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface HomesRefreshSummary {
  due: number;
  captured: number;
  notFound: number;
  ambiguous: number;
  failed: number;
  stoppedEarly: string | null;
  log: string[];
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Who's due: people he knows, never checked or checked over REFRESH_DAYS ago. Clients first, then interested, then warm. */
export async function homesRefreshDue(limit: number): Promise<Agent[]> {
  const stale = new Date(Date.now() - REFRESH_DAYS * DAY);
  return db
    .select()
    .from(agents)
    .where(
      and(
        inArray(agents.relationshipStatus, ["regular", "worked_once", "interested", "warm"]),
        isNull(agents.declinedAt),
        isNotNull(agents.name),
        // A capture from the userscript counts as a check.
        or(
          and(isNull(agents.homesCheckedAt), isNull(agents.homesCapturedAt)),
          lt(sql`coalesce(${agents.homesCheckedAt}, ${agents.homesCapturedAt})`, stale)
        )
      )
    )
    .orderBy(
      sql`case ${agents.relationshipStatus} when 'regular' then 0 when 'worked_once' then 0 when 'interested' then 1 else 2 end`,
      sql`coalesce(${agents.homesCheckedAt}, ${agents.homesCapturedAt}) asc nulls first`
    )
    .limit(limit);
}

/** Where we've seen them list and under which office, from our own listings. */
async function whereTheyWork(agentId: string): Promise<{ cities: Set<string>; offices: string[] }> {
  const rows = await db
    .selectDistinct({ city: listings.city, broker: listings.brokerName })
    .from(listings)
    .where(eq(listings.agentId, agentId));
  return {
    cities: new Set(rows.map((r) => lower(r.city)).filter(Boolean)),
    offices: [...new Set(rows.map((r) => lower(r.broker)).filter(Boolean))],
  };
}

export type Pick =
  | { kind: "url"; url: string }
  | { kind: "page"; url: string; html: string }
  | { kind: "none"; note: string };

/**
 * Their profile out of the directory search. The directory is national and
 * full of namesakes (and homes.com keeps duplicate profiles of one person,
 * differing only in capitalization), so: Oregon only, their name (allowing a
 * dropped middle initial), one per person; then their city and office to
 * choose between namesakes; then, still tied, the phone on each page.
 */
/**
 * The names they might be listed under. A double surname is often only one
 * of its halves on homes.com (our "Tiffany Wells - Gidley" is their "Tiffany
 * Gidley"), so each half is tried with the first name.
 */
function nameVariants(name: string): string[] {
  const parts = name.replace(/\s*-\s*/g, "-").split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1] ?? "";
  const variants = [name];
  // The search matches the term literally, so "Gwendolyn E Christensen" finds nothing where "Gwendolyn Christensen" does.
  const noInitials = parts.filter((p) => !/^[a-z]\.?$/i.test(p)).join(" ");
  if (noInitials && noInitials !== name) variants.push(noInitials);
  if (parts.length > 1 && last.includes("-")) for (const half of last.split("-")) variants.push(`${first} ${half}`);
  return [...new Set(variants)];
}

/** Oregon results for this name, exact first, else allowing initials one side has and the other doesn't. */
function oregonMatches(results: HomesSuggestion[], name: string): HomesSuggestion[] {
  const or = results.filter((s) => s.state === "OR");
  const exact = or.filter((s) => nameKey(s.name) === nameKey(name));
  return exact.length ? exact : or.filter((s) => looseNameKey(s.name) === looseNameKey(name));
}

/**
 * Search until something in Oregon fits: the name as is, then with "Oregon"
 * appended (a common name like "Ryan Smith" fills the national results
 * before any Oregon agent turns up), then each half of a double surname.
 */
async function searchOregon(name: string): Promise<HomesSuggestion[]> {
  for (const variant of nameVariants(name)) {
    for (const term of [variant, `${variant} Oregon`]) {
      const results = await searchHomesAgents(term);
      await pause(SEARCH_PAUSE_MS);
      const found = oregonMatches(results, variant);
      if (found.length) return found;
    }
  }
  return [];
}

export async function findProfile(agent: Agent): Promise<Pick> {
  const name = agent.name!;
  const named = await searchOregon(name);

  const people = new Map<string, HomesSuggestion>();
  for (const s of named) {
    const key = `${lower(s.city)}|${lower(s.brokerage)}`;
    if (!people.has(key)) people.set(key, s);
  }
  const candidates = [...people.values()];
  if (candidates.length === 0) return { kind: "none", note: "not found on homes.com" };
  if (candidates.length === 1) return { kind: "url", url: `https://www.homes.com${candidates[0].path}` };

  const { cities, offices } = await whereTheyWork(agent.id);
  if (agent.brokerage) offices.push(lower(agent.brokerage));
  const score = (s: HomesSuggestion) =>
    (cities.has(lower(s.city)) ? 2 : 0) + (offices.some((o) => o && lower(s.brokerage).includes(o.slice(0, 12))) ? 2 : 0);
  const ranked = candidates.map((s) => ({ s, score: score(s) })).sort((a, b) => b.score - a.score);
  if (ranked[0].score > 0 && ranked[0].score > ranked[1].score) {
    return { kind: "url", url: `https://www.homes.com${ranked[0].s.path}` };
  }

  // Still tied: the phone on the page decides.
  const phone = digits(agent.phone);
  if (phone.length === 10) {
    for (const { s } of ranked.slice(0, MAX_CANDIDATE_FETCHES)) {
      const url = `https://www.homes.com${s.path}`;
      const html = await fetchHomesProfileHtml(url);
      if (digits(parseHomesProfile(html, url)?.phone) === phone) return { kind: "page", url, html };
    }
  }
  return { kind: "none", note: `ambiguous: ${candidates.length} Oregon agents named ${name}` };
}

async function stamp(agentId: string, note: string) {
  await db.update(agents).set({ homesCheckedAt: new Date(), homesCheckNote: note }).where(eq(agents.id, agentId));
}

/** One run: up to `limit` agents, stopping before `deadline` (ms since epoch) so the function isn't cut off mid-save. */
export async function refreshHomesStats(opts: { limit: number; deadline: number }): Promise<HomesRefreshSummary> {
  const due = await homesRefreshDue(opts.limit);
  const summary: HomesRefreshSummary = {
    due: due.length,
    captured: 0,
    notFound: 0,
    ambiguous: 0,
    failed: 0,
    stoppedEarly: null,
    log: [],
  };
  let failuresInARow = 0;

  for (const agent of due) {
    if (Date.now() > opts.deadline) {
      summary.stoppedEarly = "out of time; the rest go tomorrow";
      break;
    }
    try {
      const pick = agent.homesUrl ? ({ kind: "url", url: agent.homesUrl } as Pick) : await findProfile(agent);
      if (pick.kind === "none") {
        await stamp(agent.id, pick.note);
        if (pick.note.startsWith("ambiguous")) summary.ambiguous++;
        else summary.notFound++;
        summary.log.push(`${agent.name}: ${pick.note}`);
        failuresInARow = 0;
        continue;
      }
      const html = pick.kind === "page" ? pick.html : await fetchHomesProfileHtml(pick.url);
      const result = await captureHomesProfile({ html, url: pick.url, agentId: agent.id });
      if (result.matched) {
        await stamp(agent.id, "captured");
        summary.captured++;
        summary.log.push(
          `${agent.name}: ${result.profile.dealsThisYear ?? "?"} deals/yr, avg $${result.profile.avgSalePrice ?? "?"}`
        );
      } else {
        await stamp(agent.id, result.reason);
        summary.notFound++;
        summary.log.push(`${agent.name}: ${result.reason}`);
      }
      failuresInARow = 0;
    } catch (error) {
      // Blocked or a service error: no stamp, so they're first in line tomorrow.
      summary.failed++;
      failuresInARow++;
      const message = error instanceof Error ? error.message : String(error);
      summary.log.push(`${agent.name}: failed (${message})`);
      if (!(error instanceof HomesBlockedError || error instanceof HomesFetchError)) console.error("homes refresh", error);
      if (failuresInARow >= MAX_CONSECUTIVE_FAILURES) {
        summary.stoppedEarly = `${MAX_CONSECUTIVE_FAILURES} failures in a row (${message})`;
        break;
      }
    }
  }
  return summary;
}
