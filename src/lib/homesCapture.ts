// Files a homes.com agent profile against an agent we already know.
//
// This module never fetches anything itself: it takes the page's HTML plus
// its URL and does the rest (parse it, find the agent it belongs to, write
// the stats onto that agent's row). Two callers, which must agree on what a
// capture means, so the logic lives here:
//
//   - the daily refresh (lib/homesRefresh.ts), which fetches the page
//     through the unblocker and already knows the agent (agentId).
//   - POST /api/agent-profile-capture, the Tampermonkey userscript, which
//     posts a page Lukas opened and leaves the matching to us.
//
// Nothing is created here. A capture that matches no agent is reported as a
// miss, because a miss usually means homes.com's page is about someone we
// don't track, not that a new agent should be invented from it.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { parseHomesProfile, type HomesProfile } from "@/lib/homesProfile";

export interface HomesCaptureInput {
  /** The profile page's HTML, as document.documentElement.outerHTML. */
  html: string;
  /** The profile page's URL. */
  url: string;
  /** Pin the capture to one agent and skip the name/phone lookup. */
  agentId?: string | null;
}

/** Which field tied the page to the agent row. */
export type HomesCaptureMatch = "agentId" | "name" | "phone";

export type HomesCaptureResult =
  | {
      matched: true;
      matchedOn: HomesCaptureMatch;
      agentId: string;
      agentName: string;
      profile: HomesProfile;
    }
  | {
      matched: false;
      reason: string;
      /** Agents whose name or phone fits, when the page could not be pinned to exactly one. */
      candidates?: { id: string; name: string | null; phone: string | null }[];
      profile: HomesProfile | null;
    };

/**
 * "Geoff O'Neill", "Geoff O'neill" and "Geoff Oneill" are the same person to
 * us. homes.com mangles the capitalization of names it imports from MLS
 * ("O'neill"), so matching on the raw name loses real captures.
 *
 * The SQL below has to lower() FIRST: a regexp_replace that keeps only
 * [a-z0-9] strips every capital letter, so "Geoff O'Neill" would reduce to
 * "eoff" and never match. Same key, same order, both sides.
 */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A looser key, for names where one side has an initial the other doesn't:
 * our "Cody M Testa" is their "Cody Testa", our "Shelli R. Neal" is their
 * "Shelli Neal", their "J. Ryan Smith" is our "Ryan Smith". Single-letter
 * tokens (with or without a period, anywhere in the name) go; everything
 * else is compared as before. Only used when the exact key finds nothing,
 * so it can't override a precise match.
 *
 * LOOSE_NAME_SQL_PATTERN is the same pattern for the SQL side; the two must
 * stay identical (scripts/homes-capture-match.test.ts checks they agree).
 */
const LOOSE_NAME_PATTERN = /(^|\s)[a-z]\.?(?=\s|$)/g;
export const LOOSE_NAME_SQL_PATTERN = "(^|\\s)[a-z]\\.?(?=\\s|$)";
export const looseNameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(LOOSE_NAME_PATTERN, " ")
    .replace(/[^a-z0-9]/g, "");

const digits = (phone: string): string => phone.replace(/\D/g, "");

type AgentRow = typeof agents.$inferSelect;
type AgentCandidate = { id: string; name: string | null; phone: string | null };

type AgentLookup =
  | { ok: true; agent: AgentRow; matchedOn: HomesCaptureMatch }
  | { ok: false; reason: string; candidates?: AgentCandidate[] };

async function byName(name: string): Promise<AgentRow[]> {
  return db
    .select()
    .from(agents)
    .where(
      sql`lower(regexp_replace(lower(${agents.name}), '[^a-z0-9]', '', 'g')) = ${nameKey(name)}`
    );
}

/** The same lookup with single-letter tokens (middle initials) dropped from both sides. */
async function byLooseName(name: string): Promise<AgentRow[]> {
  return db
    .select()
    .from(agents)
    .where(
      sql`regexp_replace(regexp_replace(lower(${agents.name}), ${LOOSE_NAME_SQL_PATTERN}, ' ', 'g'), '[^a-z0-9]', '', 'g') = ${looseNameKey(
        name
      )}`
    );
}

async function byPhone(phone: string): Promise<AgentRow[]> {
  return db
    .select()
    .from(agents)
    .where(sql`regexp_replace(${agents.phone}, '[^0-9]', '', 'g') = ${digits(phone)}`);
}

async function findAgent(input: HomesCaptureInput, profile: HomesProfile): Promise<AgentLookup> {
  if (input.agentId) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
    if (!agent) return { ok: false, reason: `No agent with id ${input.agentId}` };
    return { ok: true, agent, matchedOn: "agentId" };
  }

  // Name first: the phone on a homes.com profile is often the office's, and
  // an office number we have on file for one agent must not file another
  // agent's stats onto that agent.
  let nameMatches: AgentRow[] = [];
  if (profile.name) {
    nameMatches = await byName(profile.name);
    if (nameMatches.length === 1) return { ok: true, agent: nameMatches[0], matchedOn: "name" };
    // homes.com drops middle initials from some names ("Cody M Testa" is
    // their "Cody Testa"), so retry without single-letter tokens — but only
    // if the precise key found nothing, so a loose match can never override
    // an exact one.
    if (nameMatches.length === 0) {
      nameMatches = await byLooseName(profile.name);
      if (nameMatches.length === 1) return { ok: true, agent: nameMatches[0], matchedOn: "name" };
    }
  }

  let phoneMatches: AgentRow[] = [];
  if (profile.phone) {
    phoneMatches = await byPhone(profile.phone);
    if (phoneMatches.length === 1 && (!nameMatches.length || nameMatches[0].id === phoneMatches[0].id)) {
      return { ok: true, agent: phoneMatches[0], matchedOn: "phone" };
    }
    // The name matched several agents and the phone picks out one of them.
    if (nameMatches.length > 1 && phoneMatches.length === 1) {
      return { ok: true, agent: phoneMatches[0], matchedOn: "phone" };
    }
  }

  const candidates = (nameMatches.length ? nameMatches : phoneMatches).map((a) => ({
    id: a.id,
    name: a.name,
    phone: a.phone,
  }));

  if (candidates.length > 1) {
    return {
      ok: false,
      reason: `${candidates.length} agents could match this page — pass agentId to say which`,
      candidates,
    };
  }
  return { ok: false, reason: "No agent with that name or phone" };
}

export async function captureHomesProfile(input: HomesCaptureInput): Promise<HomesCaptureResult> {
  const profile = parseHomesProfile(input.html, input.url);
  if (!profile) {
    return { matched: false, reason: "Not a recognizable homes.com profile page", profile: null };
  }

  const found = await findAgent(input, profile);
  if (!found.ok) {
    return { matched: false, reason: found.reason, candidates: found.candidates, profile };
  }

  const agent = found.agent;
  await db
    .update(agents)
    .set({
      homesUrl: profile.url,
      homesLicenseId: profile.licenseId ?? agent.homesLicenseId,
      homesListingsPerYear: profile.dealsThisYear ?? agent.homesListingsPerYear,
      homesAvgSalePrice: profile.avgSalePrice ?? agent.homesAvgSalePrice,
      homesCapturedAt: new Date(),
      // Our own brokerage wins when we have one — it came from the listing
      // MLS feed, which is the better source for the office name.
      brokerage: agent.brokerage ?? profile.brokerage,
    })
    .where(eq(agents.id, agent.id));

  return {
    matched: true,
    matchedOn: found.matchedOn,
    agentId: agent.id,
    agentName: agent.name ?? profile.name ?? "",
    profile,
  };
}
