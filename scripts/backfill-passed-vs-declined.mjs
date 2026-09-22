/**
 * One-off: migrates existing rows onto the passed/declined split.
 *
 * Until 2026-09-22 a single "declined" status meant both "Lukas isn't shooting
 * this property" and "the agent turned Lukas down". Everything written under
 * that status came from one button whose only real meaning was "stop showing me
 * this lead", so it all migrates to "passed". Claiming any of it as a genuine
 * agent rejection would be inventing signal the data never held — the one
 * exception is agents flagged by hand on the Agents tab, which was always a
 * deliberate statement about the person and is preserved.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-passed-vs-declined.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

// Agents flagged declined with no declined listing behind them were marked by
// hand on the Agents tab (markAgentDeclined), which is a real "they said no".
// Computed before the listing migration, since that's what the check reads.
const keep = await sql`
  SELECT a.id, a.name FROM agents a
  WHERE a.declined_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.status = 'declined' AND l.agent_phone = a.phone)`;
const keepIds = keep.map((r) => r.id);

const [before] = await sql`SELECT
  (SELECT count(*)::int FROM listings WHERE status = 'declined') AS declined_listings,
  (SELECT count(*)::int FROM agents WHERE declined_at IS NOT NULL) AS flagged_agents,
  (SELECT count(*)::int FROM message_sends WHERE result = 'declined') AS declined_sends`;

console.log("BEFORE:", before);
console.log(`preserving ${keepIds.length} hand-marked agent decline(s): ${keep.map((r) => r.name).join(", ") || "(none)"}`);

if (!APPLY) {
  console.log("\ndry run — nothing changed. re-run with --apply");
  process.exit(0);
}

// 1. Every existing "declined" listing was lead triage.
const listingsUpdated = await sql`
  UPDATE listings SET status = 'passed' WHERE status = 'declined' RETURNING id`;

// 2. Clear the agent flags that triage created, keeping the hand-marked ones.
const agentsCleared = keepIds.length
  ? await sql`UPDATE agents SET declined_at = NULL
              WHERE declined_at IS NOT NULL AND id <> ALL(${keepIds}) RETURNING id`
  : await sql`UPDATE agents SET declined_at = NULL WHERE declined_at IS NOT NULL RETURNING id`;

// 3. resolveSendOutcome is the only writer of result, and it only ever wrote
//    "declined" off that same listing-status change — so these outcomes were
//    never the agent's answer. Back to "pending" (genuinely unknown), which is
//    what made the messaging page's decline rate meaningless.
const sendsReset = await sql`
  UPDATE message_sends SET result = 'pending' WHERE result = 'declined' RETURNING id`;

const [after] = await sql`SELECT
  (SELECT count(*)::int FROM listings WHERE status = 'declined') AS declined_listings,
  (SELECT count(*)::int FROM listings WHERE status = 'passed') AS passed_listings,
  (SELECT count(*)::int FROM agents WHERE declined_at IS NOT NULL) AS flagged_agents,
  (SELECT count(*)::int FROM message_sends WHERE result = 'declined') AS declined_sends,
  (SELECT count(*)::int FROM message_sends WHERE result = 'pending') AS pending_sends`;

console.log(`\nlistings declined -> passed: ${listingsUpdated.length}`);
console.log(`agents declined_at cleared:  ${agentsCleared.length}`);
console.log(`sends result -> pending:     ${sendsReset.length}`);
console.log("AFTER:", after);
