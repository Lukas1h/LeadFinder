/**
 * One-off: populates listings.agent_id, the real FK that replaces joining
 * listings to agents on the agent_phone string.
 *
 * Matches on phone first (which is how every existing join worked, so it
 * reproduces today's behavior exactly), then falls back to an unambiguous
 * name — that second pass is the point, since it links listings whose agent
 * only ever existed as an email-only contact and which no phone join could
 * ever reach.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-listing-agent-id.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const [before] = await sql`SELECT
  count(*)::int AS total,
  count(agent_id)::int AS already_linked,
  count(*) FILTER (WHERE agent_phone IS NULL AND agent_name IS NULL)::int AS no_agent_info
  FROM listings`;
console.log("BEFORE:", before);

const byPhone = await sql`
  SELECT l.id, a.id AS agent_id FROM listings l
  JOIN agents a ON a.phone = l.agent_phone
  WHERE l.agent_id IS NULL AND l.agent_phone IS NOT NULL`;

// Only names that resolve to exactly one agent. Two realtors can share a name
// in one market, and attaching a listing to the wrong person's history is
// worse than leaving it unlinked.
const byName = await sql`
  SELECT l.id, a.id AS agent_id FROM listings l
  JOIN agents a ON lower(trim(a.name)) = lower(trim(l.agent_name))
  WHERE l.agent_id IS NULL AND l.agent_phone IS NULL AND l.agent_name IS NOT NULL
    AND (SELECT count(*) FROM agents a2 WHERE lower(trim(a2.name)) = lower(trim(l.agent_name))) = 1`;

console.log(`matched by phone: ${byPhone.length}`);
console.log(`matched by name (unreachable by any phone join): ${byName.length}`);

if (!APPLY) {
  console.log("\ndry run — nothing changed. re-run with --apply");
  process.exit(0);
}

for (const batch of [byPhone, byName]) {
  for (const row of batch) {
    await sql`UPDATE listings SET agent_id = ${row.agent_id} WHERE id = ${row.id}`;
  }
}

const [after] = await sql`SELECT
  count(*)::int AS total,
  count(agent_id)::int AS linked,
  count(*) FILTER (WHERE agent_id IS NULL AND (agent_phone IS NOT NULL OR agent_name IS NOT NULL))::int AS unlinked_with_agent_info,
  count(*) FILTER (WHERE agent_id IS NULL AND agent_phone IS NULL AND agent_name IS NULL)::int AS genuinely_agentless
  FROM listings`;
console.log("AFTER:", after);

// Every phone-based join this replaces should produce the same answer now.
const [drift] = await sql`
  SELECT count(*)::int AS n FROM listings l
  JOIN agents a ON a.phone = l.agent_phone
  WHERE l.agent_id IS DISTINCT FROM a.id`;
console.log(`rows where agent_id disagrees with the old phone join: ${drift.n} (want 0)`);
