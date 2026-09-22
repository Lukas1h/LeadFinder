/**
 * One-off: the five people who replied to the backup-photographer outreach but
 * were still filed as "cold", skipped by backfill-interactions.mjs because that
 * script only covered non-cold agents.
 *
 * Their replies are hard evidence and all five get one logged. Their status is
 * a separate question with a different answer per person: replying is not the
 * same as being a prospect, and three of these five were already assessed and
 * correctly left cold. Only the two with no such assessment get bumped.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-cold-repliers.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const REPLIERS = [
  {
    id: "c0a9f6fb-3028-404d-93a8-133953734f41",
    name: "Shawn Gibson",
    repliedOn: "2026-09-17",
    // No note on file and never marked declined — nobody has judged this one
    // either way, and a reply is the only signal there is.
    bumpTo: "interested",
    note: "Replied to the backup-photographer outreach.",
  },
  {
    id: "477a7c39-a958-4bd5-8793-9fa1b2220fc5",
    name: "Alex Aaronson",
    repliedOn: "2026-09-16",
    bumpTo: "interested",
    note: "Replied to the backup-photographer outreach, acknowledging the availability info.",
  },
  {
    id: "eb27a6d9-ccc1-4357-8986-9c4cbad31772",
    name: "Donna Rinaldi",
    repliedOn: "2026-09-17",
    // Her note already says "Budget constraints - not a fit". She engaged, but
    // that engagement was assessed and the answer was no; promoting her would
    // overwrite a judgment already made.
    bumpTo: null,
    note: "Replied: has never paid over $450 for photos, drone and walkthrough.",
  },
  {
    id: "6ad2f6c4-875a-44a4-93a8-296d177694c8",
    name: "Jamie Urwin",
    repliedOn: "2026-09-16",
    // Hand-marked declined, and the note says the pricing was too expensive.
    bumpTo: null,
    note: "Replied: liked the photos, said the pricing is over double what he pays.",
  },
  {
    id: "b89aebfa-c7c5-4001-8063-de3953a130e6",
    name: "Caryn Yates",
    repliedOn: "2026-09-17",
    // Replied to say she isn't an agent at all, so she was never a prospect.
    bumpTo: null,
    note: "Replied: not an active agent, works for the home office.",
    setNotes: "Replied to outreach to say she is not an active agent, but works for the home office. Not a prospect.",
  },
];

const rows = await sql`
  SELECT id, name, relationship_status AS rel, declined_at, notes FROM agents
  WHERE id = ANY(${REPLIERS.map((r) => r.id)})`;
const byId = new Map(rows.map((r) => [r.id, r]));

console.log("plan:\n");
for (const r of REPLIERS) {
  const current = byId.get(r.id);
  if (!current) {
    console.log(`  ${r.name}: NOT FOUND — skipping`);
    continue;
  }
  const statusLine = r.bumpTo
    ? `cold -> ${r.bumpTo}`
    : `stays cold${current.declined_at ? " (declined)" : ""} — already assessed`;
  console.log(`  ${r.name}: log inbound email ${r.repliedOn} | ${statusLine}`);
  if (r.setNotes && !current.notes) console.log(`      + notes: "${r.setNotes}"`);
}

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

let logged = 0;
let bumped = 0;
for (const r of REPLIERS) {
  const current = byId.get(r.id);
  if (!current) continue;

  await sql`
    INSERT INTO agent_interactions (agent_id, channel, direction, note, occurred_at, source)
    VALUES (${r.id}, 'email', 'inbound', ${r.note}, ${new Date(`${r.repliedOn}T17:00:00Z`)}, 'backfill')`;
  logged++;

  if (r.bumpTo) {
    await sql`UPDATE agents SET relationship_status = ${r.bumpTo} WHERE id = ${r.id}`;
    bumped++;
  }
  // Only fills an empty notes field — never overwrites something hand-written.
  if (r.setNotes && !current.notes) {
    await sql`UPDATE agents SET notes = ${r.setNotes} WHERE id = ${r.id}`;
  }
}

console.log(`\nlogged ${logged} replies, bumped ${bumped} off cold`);
