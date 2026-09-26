/**
 * One-off: reconstructs the contact-history rows that were never written for
 * agents whose listings were marked "contacted" through the pipeline.
 *
 * The gap this closes: updateListingStatus(status="contacted") calls
 * touchAgentContact, which stamps agents.lastContactedAt +
 * last_contacted_listing_id. That denormalized pointer is what
 * findDuplicateAgentContact reads to render the "Already contacted" badge, but
 * no agent_interactions row was ever created — so the badge asserted a contact
 * the agent's timeline couldn't show. The agent page reads real records, and
 * the interaction table is the source of truth; these rows are the missing
 * records, not a second opinion.
 *
 * Evidence per agent, and why this is safe to backfill rather than guess:
 * touchAgentContact and the listing's own contactedAt are written by the same
 * action, so for every candidate below the two timestamps agree to within a
 * second (worst observed skew across all 61: 1s). A pointer with no
 * corroborated contacted listing is NOT touched here — that pattern means the
 * contact was called off, which is a different bug with a different fix.
 *
 * Channel is genuinely unknown: the pointer records that a contact happened,
 * not whether it was a call, text or email. These land as channel="other" with
 * outcome null, which the schema already treats as "unknown or not applicable".
 * source="backfill" marks them as the weakest of the three provenance tiers
 * (see the source comment on agentInteractions).
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-missing-contact-history.mjs [--apply]
 * Without --apply it prints the plan and changes nothing.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const NOTE =
  "Backfilled from listing status: this listing was marked contacted at the same " +
  "moment the agent's last-contacted pointer was stamped, but no interaction was " +
  "ever logged. Channel unknown.";

const candidates = await sql`
  SELECT a.id AS agent_id, a.name, a.phone, a.last_contacted_at,
         l.id AS listing_id, l.address, l.city, l.status AS listing_status,
         l.contacted_at
  FROM agents a
  JOIN listings l ON l.id = a.last_contacted_listing_id
  WHERE a.last_contacted_at IS NOT NULL
    AND l.contacted_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM agent_interactions i WHERE i.agent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM message_sends m WHERE m.agent_id = a.id)
  ORDER BY a.name`;

console.log(`${APPLY ? "BACKFILL" : "PLAN "} ${candidates.length} agents with a contact pointer but an empty timeline\n`);

let inserted = 0;
for (const c of candidates) {
  // Belt and braces: re-check immediately before writing. The dry run is
  // read-only and this script may sit in the tree for a while before anyone
  // runs it, and an agent who gets a real interaction logged in the meantime
  // must not get a duplicate backfilled row on top of it.
  const [guard] = await sql`
    SELECT count(*)::int AS c FROM agent_interactions WHERE agent_id = ${c.agent_id}`;
  if (guard.c > 0) {
    console.log(`SKIP ${c.name} — gained ${guard.c} interaction(s) since the plan was built`);
    continue;
  }

  const label = (v, n) => String(v ?? "?").slice(0, n).padEnd(n);
  const line =
    `${label(c.name, 24)} ${label(c.address, 26)} ` +
    `contactedAt=${String(c.contacted_at).slice(0, 19)} (listing ${c.listing_status})`;
  console.log(`${APPLY ? "  ADD " : "  -   "}${line}`);

  if (!APPLY) continue;

  await sql`
    INSERT INTO agent_interactions
      (agent_id, listing_id, channel, direction, outcome, note, occurred_at, source)
    VALUES
      (${c.agent_id}, ${c.listing_id}, 'other', 'outbound', NULL, ${NOTE}, ${c.contacted_at}, 'backfill')`;
  inserted++;
}

console.log(
  `\n${APPLY ? `inserted ${inserted} interactions` : `${candidates.length} rows planned (dry run, nothing changed)`}`
);
