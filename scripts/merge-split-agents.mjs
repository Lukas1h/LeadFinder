/**
 * One-off: merges agent rows that are the same human split across two records —
 * one created email-only by a cold-email import, one created phone-only by
 * touchAgentContact/touchAgentDeclined (which upsert on agents.phone and so can
 * never match an email-only row).
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/merge-split-agents.mjs [--apply]
 * Without --apply it prints the plan and changes nothing.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const REL_RANK = { cold: 0, warm: 1, interested: 2, worked_once: 3, regular: 4 };

const rows = await sql`
  WITH split AS (
    SELECT lower(trim(name)) AS norm_name FROM agents
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY 1 HAVING count(*) > 1
      AND count(*) FILTER (WHERE email IS NOT NULL AND phone IS NULL) > 0
      AND count(*) FILTER (WHERE phone IS NOT NULL AND email IS NULL) > 0
  )
  SELECT a.*, lower(trim(a.name)) AS norm_name,
         (SELECT count(*)::int FROM message_sends m WHERE m.agent_id = a.id) AS sends
  FROM agents a JOIN split s ON lower(trim(a.name)) = s.norm_name
  ORDER BY a.name`;

const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.norm_name)) groups.set(r.norm_name, []);
  groups.get(r.norm_name).push(r);
}

const newer = (a, b) => (!a ? b : !b ? a : new Date(a) >= new Date(b) ? a : b);

let merged = 0;
for (const [norm, pair] of groups) {
  if (pair.length !== 2) {
    console.log(`SKIP ${norm}: ${pair.length} rows, not a clean pair — handle by hand`);
    continue;
  }
  // Keep whichever row carries the send history; that minimizes repointing and
  // keeps the row the CRM already treats as the real one.
  const [winner, loser] = [...pair].sort(
    (a, b) => b.sends - a.sends || (b.email ? 1 : 0) - (a.email ? 1 : 0) || new Date(a.created_at) - new Date(b.created_at)
  );

  const notes = [winner.notes, loser.notes].filter(Boolean).join("\n\n");
  const rel =
    (REL_RANK[winner.relationship_status] ?? 0) >= (REL_RANK[loser.relationship_status] ?? 0)
      ? winner.relationship_status
      : loser.relationship_status;
  const lastContactedAt = newer(winner.last_contacted_at, loser.last_contacted_at);
  // Keep the listing pointer that goes with whichever contact was more recent.
  const lastListing =
    lastContactedAt && loser.last_contacted_at && +new Date(lastContactedAt) === +new Date(loser.last_contacted_at)
      ? (loser.last_contacted_listing_id ?? winner.last_contacted_listing_id)
      : (winner.last_contacted_listing_id ?? loser.last_contacted_listing_id);

  console.log(
    `${APPLY ? "MERGE" : "PLAN "} ${winner.name}: keep ${winner.id.slice(0, 8)} ` +
      `(${winner.email ?? winner.phone}, ${winner.sends} sends) ` +
      `<- drop ${loser.id.slice(0, 8)} (${loser.email ?? loser.phone}, ${loser.sends} sends)`
  );

  if (!APPLY) continue;

  // Order matters: both FKs are onDelete:"set null", so history has to be
  // repointed before the loser row goes away or it's silently orphaned. The
  // delete also has to land before the winner takes the loser's phone/email,
  // since both columns are UNIQUE. One transaction so a failure can't leave
  // the pair half-merged.
  await sql.transaction([
    sql`UPDATE message_sends SET agent_id = ${winner.id} WHERE agent_id = ${loser.id}`,
    sql`UPDATE bookings SET contact_agent_id = ${winner.id} WHERE contact_agent_id = ${loser.id}`,
    sql`DELETE FROM agents WHERE id = ${loser.id}`,
    sql`
      UPDATE agents SET
        phone = ${winner.phone ?? loser.phone},
        email = ${winner.email ?? loser.email},
        name = ${winner.name ?? loser.name},
        notes = ${notes || null},
        relationship_status = ${rel},
        last_contacted_at = ${lastContactedAt},
        last_contacted_listing_id = ${lastListing},
        declined_at = ${newer(winner.declined_at, loser.declined_at)},
        realtor_profile_url = ${winner.realtor_profile_url ?? loser.realtor_profile_url},
        avg_listings_per_year = ${winner.avg_listings_per_year ?? loser.avg_listings_per_year},
        avg_listing_price = ${winner.avg_listing_price ?? loser.avg_listing_price},
        created_at = ${new Date(winner.created_at) <= new Date(loser.created_at) ? winner.created_at : loser.created_at}
      WHERE id = ${winner.id}`,
  ]);
  merged++;
}

console.log(`\n${APPLY ? `merged ${merged} pairs` : `${groups.size} pairs planned (dry run, nothing changed)`}`);
