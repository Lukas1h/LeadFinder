// Shared screening logic for the warm-agent guard.
//
// Used by scripts/warmGuard.ts (the CLI that reports counts on a list) and by
// scripts/coldOutreachApiRunner.ts (which re-screens immediately before it
// sends). The second use is the important one: the runner refuses to start if
// any candidate in the list matches an agent we already have a relationship
// with, so a list that reached the runner by any route — a stale file, a
// hand-edited module, an export nobody cleaned — still cannot cold-email a warm
// agent. The guard is not a step someone has to remember; it's a gate the
// sender can't pass.

import { neon } from "@neondatabase/serverless";
import { preparePerson, matchPrepared } from "./warmGuard.mjs";

export type Verdict = "block" | "review" | "clear";

export interface KnownAgent {
  name: string;
  email: string | null;
  phone: string | null;
  relationshipStatus: string;
  reasons: string[];
}

export interface Candidate {
  name: string;
  email: string;
  phone: string | null;
  [k: string]: unknown;
}

export interface Hold extends Candidate {
  verdict: Verdict;
  score: number;
  tier: string;
  why: string;
  matchedName?: string;
  matchedStatus?: string;
}

export type Prepared = ReturnType<typeof preparePerson> & {
  reasons: string[];
  relationshipStatus: string;
};

/**
 * Every agent a cold email must never reach: anything other than an untouched
 * cold lead. A non-cold relationship status, a declinedAt, or any record of
 * contact — a send, a booking, a logged interaction — puts an agent here.
 *
 * Deliberately wide. A cold agent we emailed once and never heard back is
 * exactly the person whose name is most likely to reappear in the next export
 * under a different address, and "we emailed them and they ignored it" is not
 * a licence to email them again as a stranger.
 */
export async function loadProtected(databaseUrl = process.env.DATABASE_URL): Promise<KnownAgent[]> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to load the protected agent list");
  const sql = neon(databaseUrl);
  const rows = await sql`
    select a.name, a.email, a.phone, a.relationship_status,
           a.declined_at is not null as declined,
           a.last_contacted_at is not null as contacted,
           exists (select 1 from bookings b where b.contact_agent_id = a.id) as booked,
           exists (select 1 from agent_interactions i where i.agent_id = a.id) as interacted
      from agents a
  `;
  return rows
    .filter((r: any) => r.relationship_status !== "cold" || r.declined ||
      r.contacted || r.booked || r.interacted)
    .map((r: any) => {
      const reasons: string[] = [];
      if (r.relationship_status !== "cold") reasons.push(`status:${r.relationship_status}`);
      if (r.declined) reasons.push("declined");
      if (r.booked) reasons.push("booked");
      if (r.interacted) reasons.push("interacted");
      if (r.contacted) reasons.push("contacted");
      return {
        name: r.name || "",
        email: r.email,
        phone: r.phone,
        relationshipStatus: r.relationship_status,
        reasons,
      };
    });
}

export function prepareAll(protectedAgents: KnownAgent[]): Prepared[] {
  return protectedAgents.map((a) =>
    Object.assign(preparePerson(a), {
      reasons: a.reasons,
      relationshipStatus: a.relationshipStatus,
    }),
  );
}

/**
 * Screen one candidate against every protected agent.
 *
 * This is a full cross-product, deliberately. An earlier version bucketed
 * protected agents by the first four letters of the surname to cut the work,
 * and that bucket became a source of FALSE CLEARS: "KayCee Mogle" landed in
 * bucket "mogl" while the warm agent "KayCee Mogel" sat in "moge", so the two
 * never met and a warm agent cleared as a stranger. A prefilter that can hide a
 * match is worse than a slow one, so the name pass compares everything and
 * preparePerson() does the per-row parsing once up front.
 */
export function screenCandidate(cand: Candidate, prepared: Prepared[]): Hold | null {
  const cp = preparePerson(cand);
  let best: Hold | null = null;
  for (const pp of prepared) {
    const r = matchPrepared(cp, pp);
    if (r.verdict === "clear") continue;
    if (!best || r.score > best.score) {
      best = {
        ...cand,
        verdict: r.verdict as Verdict,
        score: r.score,
        tier: r.tier,
        why: `${r.why} [${pp.reasons.join(", ") || "known"}]`,
        matchedName: pp.name,
        matchedStatus: pp.relationshipStatus,
      };
    }
    // Nothing outscores a hard identifier hit, so stop looking.
    if (best.score >= 95) break;
  }
  return best;
}

/** Screen a whole list. Returns the holds and the rows that cleared. */
export function screenList(
  candidates: Candidate[],
  prepared: Prepared[],
): { holds: Hold[]; clear: Candidate[] } {
  const holds: Hold[] = [];
  const clear: Candidate[] = [];
  for (const c of candidates) {
    const h = screenCandidate(c, prepared);
    if (h) holds.push(h);
    else clear.push(c);
  }
  return { holds, clear };
}
