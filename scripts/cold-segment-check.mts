/**
 * How would the cold-text list split by "does this agent already have a
 * photographer?" — and where should the line be?
 *
 *   npx tsx scripts/cold-segment-check.mts
 *
 * Read-only (SELECT only). Counts only: no names, phones or emails.
 *
 * Audience: cold agents Lukas has texted at least once and who have never
 * texted/called/emailed back — the list a cold follow-up would go to. For each,
 * src/lib/coldFollowUp/segment.ts collapses their listings' photo scores into a
 * recency-weighted mean and calls them has_photographer / no_photographer /
 * unknown. This prints that split, plus the same split at neighbouring
 * thresholds so the 7 in HAS_PHOTOGRAPHER_MIN_SCORE can be sanity-checked
 * before it's trusted.
 */

import { config } from "dotenv";
import type { AgentSegment, ColdSegment } from "../src/lib/coldFollowUp/segment";

config({ path: ".env.local", quiet: true });

const { and, eq, exists, isNull, notExists, sql } = await import("drizzle-orm");
const { db } = await import("../src/db/index");
const { agents, agentInteractions } = await import("../src/db/schema");
const {
  HAS_PHOTOGRAPHER_MIN_SCORE,
  MIN_SCORED_LISTINGS,
  SCORE_HALF_LIFE_DAYS,
  HIGH_END_PRICE,
  loadAgentSegments,
} = await import("../src/lib/coldFollowUp/segment");

const SEGMENTS: ColdSegment[] = ["has_photographer", "no_photographer", "unknown"];

/** "has_photographer"/"no_photographer" at another threshold, same weights. */
function segmentAt(agent: AgentSegment, minScore: number): ColdSegment {
  if (agent.scoredListings < MIN_SCORED_LISTINGS || agent.weightedScore === null) {
    return "unknown";
  }
  return agent.weightedScore >= minScore ? "has_photographer" : "no_photographer";
}

function countSegments(
  segments: Map<string, AgentSegment>,
  minScore?: number,
): Record<ColdSegment, number> {
  const counts: Record<ColdSegment, number> = {
    has_photographer: 0,
    no_photographer: 0,
    unknown: 0,
  };
  for (const agent of segments.values()) {
    counts[minScore === undefined ? agent.segment : segmentAt(agent, minScore)] += 1;
  }
  return counts;
}

function printCounts(label: string, counts: Record<ColdSegment, number>): void {
  console.log(
    `${label.padEnd(28)} has_photographer ${String(counts.has_photographer).padStart(4)}` +
      `   no_photographer ${String(counts.no_photographer).padStart(4)}` +
      `   unknown ${String(counts.unknown).padStart(4)}`,
  );
}

// Cold, not declined, texted at least once outbound by text, never replied on
// any channel.
const rows = await db
  .select({ id: agents.id })
  .from(agents)
  .where(
    and(
      eq(agents.relationshipStatus, "cold"),
      isNull(agents.declinedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(agentInteractions)
          .where(
            and(
              eq(agentInteractions.agentId, agents.id),
              eq(agentInteractions.channel, "text"),
              eq(agentInteractions.direction, "outbound"),
            ),
          ),
      ),
      notExists(
        db
          .select({ one: sql`1` })
          .from(agentInteractions)
          .where(
            and(
              eq(agentInteractions.agentId, agents.id),
              eq(agentInteractions.direction, "inbound"),
            ),
          ),
      ),
    ),
  );

const agentIds = rows.map((row) => row.id);
const segments = await loadAgentSegments(agentIds);

console.log("Cold-texted, never replied");
console.log(
  `  agents ${agentIds.length} · min score ${HAS_PHOTOGRAPHER_MIN_SCORE}` +
    ` · min listings ${MIN_SCORED_LISTINGS}` +
    ` · half-life ${SCORE_HALF_LIFE_DAYS}d · high-end $${HIGH_END_PRICE.toLocaleString("en-US")}`,
);
console.log("");

printCounts("segment", countSegments(segments));

const unknown = [...segments.values()].filter((agent) => agent.segment === "unknown");
const unknownNoScore = unknown.filter((agent) => agent.scoredListings === 0).length;
console.log(
  `  unknown detail: ${unknownNoScore} with no scored listing,` +
    ` ${unknown.length - unknownNoScore} with only 1 (need ${MIN_SCORED_LISTINGS})`,
);

const highEnd = [...segments.values()].filter((agent) => agent.highEnd).length;
console.log(`high-end (median price): ${highEnd} of ${agentIds.length}`);
console.log("");

// weightedScore rounded to the nearest integer, among agents with any score.
const histogram = new Map<number, number>();
for (const agent of segments.values()) {
  if (agent.weightedScore === null) continue;
  const bucket = Math.round(agent.weightedScore);
  histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
}
const scored = [...histogram.values()].reduce((sum, n) => sum + n, 0);
console.log(`weighted score histogram (${scored} agents with a scored listing)`);
for (const bucket of [...histogram.keys()].sort((a, b) => a - b)) {
  const n = histogram.get(bucket) ?? 0;
  console.log(`  ${String(bucket).padStart(2)} │ ${"█".repeat(n)} ${n}`);
}
console.log("");

console.log("If the threshold were:");
for (const minScore of [6, 7, 8]) {
  printCounts(`  min score ${minScore}`, countSegments(segments, minScore));
}

process.exit(0);
