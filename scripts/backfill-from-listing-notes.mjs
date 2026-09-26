/**
 * One-off: reconstructs contact history from the hand-written notes on pipeline
 * listings, for the subset of notes that actually describe a contact that
 * already happened.
 *
 * Sibling to backfill-interactions.mjs, which works from agents.notes and a
 * hand-read inbox list. This one reads listings.notes, and most of those are
 * not contact history at all — the majority are listing triage ("Video
 * opportunity", "bad phone pictures", "Not looking to get photos done"), which
 * is why every entry below is hand-picked and quotes the phrase it came from
 * rather than pattern-matched.
 *
 * Two rules, both inherited from that script:
 *
 * 1. A channel and direction have to be stated, not guessed. Notes that are a
 *    future task ("Call him on the 10th", "Need to call him about other
 *    listing") or that imply a conversation without saying how it happened
 *    ("Worked with Roger before") are left alone and reported, not filed under
 *    an invented channel.
 * 2. Don't double-log. Templated sends are already in message_sends. More
 *    importantly, backfill-missing-contact-history.mjs already reconstructed a
 *    channel="other" row for 61 agents from their listing's contactedAt — and
 *    for several of those the note is what identifies that same contact. Those
 *    rows are UPGRADED in place (channel and outcome filled in, note replaced
 *    with the quoted phrase) instead of gaining a second row for one call.
 *
 * Dates are estimates, in this order: a date stated in the note, then the
 * listing's contactedAt (the app's own record of contact for that property),
 * then statusChangedAt (roughly when the note was written during triage), then
 * the agent's lastContactedAt. Each resolved date is printed with which anchor
 * supplied it so a wrong guess is traceable rather than invisible.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-from-listing-notes.mjs [--apply]
 * Without --apply it prints the plan and changes nothing.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

// address -> the contact the note states. `because` is quoted verbatim from the
// note so a later reader can check the inference rather than trust it.
const CANDIDATES = [
  { address: "255 Beach Blvd", agent: "Rebecca Brosi", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Called and left a voicemail. Text her in a little bit if she doesn't call back." },
  { address: "3780 Victor Point Rd NE", agent: "Dixon Bledsoe", channel: "call", direction: "outbound", outcome: null,
    because: "Called. Going to ask seller." },
  { address: "591 NW Douglas Blvd", agent: "Beverly Walters", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called her. She's gonna talk to the seller." },
  { address: "977 E 4th Ave", agent: "Tim Snyder", channel: "call", direction: "inbound", outcome: "answered",
    because: "Called me back, says he'll call me tomorrow (15th)", explicitDate: "2026-09-14" },
  { address: "2286 N 22nd Ct", agent: "Annette Prater", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Call and left a voicemail" },
  { address: "600 Queens Ct", agent: "Sally Jo Wickham", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called. They already have a photographer. Had me text some info though" },
  { address: "3588 Dogwood Dr S", agent: "Cece Mosher", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called the realtor. Said she has to ask the owner if they can afford that." },
  { address: "2712 NW Daysha Dr", agent: "Ryan Fox", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called and he said to email him" },
  { address: "307 Manzanita Dr", agent: "Sam Johnson", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Called and left a voicemail" },
  { address: "4415 SE 26th Ave", agent: "Andrew Galler CRS", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Called and left voicemail." },
  { address: "4415 SE 26th Ave", agent: "Andrew Galler CRS", channel: "text", direction: "outbound", outcome: "sent",
    because: "Also texted.", distinct: true },
  { address: "10175 SW Highland Dr", agent: "Elizabeth Young", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Called and left a voicemail" },
  { address: "1395 W Meadows Dr NW", agent: "Caralee Slowik", channel: "email", direction: "outbound", outcome: "sent",
    because: "Already had photos but had me email her info." },
  { address: "70 Grand View Dr", agent: "Teresa Moshofsky", channel: "call", direction: "outbound", outcome: "voicemail",
    because: "Video. Called and left a voicemail" },
  { address: "908 Water Ave NE", agent: "Doug Hall", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called. Declined." },
  { address: "6390 NW Sumac Dr", agent: "Jill Schuster", channel: "call", direction: "outbound", outcome: "answered",
    because: "Booked but then fell through because they found someone cheaper." },
  { address: "6897 NW 163rd Ave", agent: "Annie Le", channel: "call", direction: "outbound", outcome: "answered",
    because: "Called and talk to her. Already has a photographer." },
];

const pad = (v, n) => String(v ?? "—").slice(0, n).padEnd(n);
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

const inserts = [];
const upgrades = [];
const skipped = [];

for (const c of CANDIDATES) {
  const [listing] = await sql`
    SELECT id, address, agent_id, contacted_at, status_changed_at
    FROM listings WHERE address = ${c.address} AND agent_id IS NOT NULL
    ORDER BY found_at LIMIT 1`;
  if (!listing) {
    skipped.push(`${c.address} / ${c.agent}: no attached agent row on the listing`);
    continue;
  }
  // Same address imported twice would make the date anchor a coin flip.
  const [dupes] = await sql`
    SELECT count(*)::int AS c FROM listings WHERE address = ${c.address} AND agent_id IS NOT NULL`;
  if (dupes.c > 1) {
    skipped.push(`${c.address} / ${c.agent}: ${dupes.c} listings share this address, refusing to guess which`);
    continue;
  }

  // Date anchors, most trustworthy first.
  let at = null;
  let anchor = null;
  if (c.explicitDate) {
    at = c.explicitDate;
    anchor = "stated in note";
  } else if (listing.contacted_at) {
    at = day(listing.contacted_at);
    anchor = "listing.contactedAt";
  } else if (listing.status_changed_at) {
    at = day(listing.status_changed_at);
    anchor = "listing.statusChangedAt";
  } else {
    const [a] = await sql`SELECT last_contacted_at FROM agents WHERE id = ${listing.agent_id}`;
    if (!a?.last_contacted_at) {
      skipped.push(`${c.address} / ${c.agent}: no date anchor available`);
      continue;
    }
    at = day(a.last_contacted_at);
    anchor = "agent.lastContactedAt";
  }

  const note = `From listing notes: "${c.because}"`;

  // Already logged with the same channel and direction on the same day?
  const [same] = await sql`
    SELECT id FROM agent_interactions
    WHERE agent_id = ${listing.agent_id} AND channel = ${c.channel}
      AND direction = ${c.direction} AND occurred_at >= ${at}::date
      AND occurred_at < (${at}::date + interval '1 day')
    LIMIT 1`;
  if (same) {
    skipped.push(`${c.address} / ${c.agent}: ${c.direction} ${c.channel} on ${at} already logged`);
    continue;
  }

  // The reconstruction backfill already put a channel-agnostic row here for
  // this same contact. Fill in what the note knows instead of adding a second
  // row, or one call would appear twice in the timeline. Skipped when the note
  // describes a *separate* touch in the same sentence ("Called and left
  // voicemail. Also texted.") — that one is its own contact, and letting it
  // match here would overwrite the call it just filled in.
  const [vague] = c.distinct
    ? []
    : await sql`
        SELECT id FROM agent_interactions
        WHERE agent_id = ${listing.agent_id} AND channel = 'other' AND source = 'backfill'
          AND occurred_at >= ${at}::date AND occurred_at < (${at}::date + interval '1 day')
        LIMIT 1`;
  if (vague) {
    upgrades.push({ ...c, agentId: listing.agent_id, at, anchor, note, id: vague.id });
    continue;
  }

  inserts.push({ ...c, agentId: listing.agent_id, at, anchor, note });
}

console.log(`${CANDIDATES.length} notes state a completed contact with a known channel\n`);
console.log(`INSERT ${inserts.length}   (new contact not in the timeline at all)`);
for (const p of inserts) {
  console.log(`  ${pad(p.agent, 20)} ${pad(p.at, 11)} ${pad(p.direction, 8)} ${pad(p.channel, 6)} ${pad(p.outcome ?? "-", 9)} via ${p.anchor}`);
}
console.log(`\nUPGRADE ${upgrades.length}  (fills the channel into a channel-agnostic reconstructed row)`);
for (const p of upgrades) {
  console.log(`  ${pad(p.agent, 20)} ${pad(p.at, 11)} ${pad(p.direction, 8)} ${pad(p.channel, 6)} ${pad(p.outcome ?? "-", 9)} via ${p.anchor}`);
}
console.log(`\nSKIP ${skipped.length}`);
for (const s of skipped) console.log(`  - ${s}`);

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

for (const p of upgrades) {
  await sql`
    UPDATE agent_interactions
    SET channel = ${p.channel}, outcome = ${p.outcome}, note = ${p.note}
    WHERE id = ${p.id}`;
}
for (const p of inserts) {
  await sql`
    INSERT INTO agent_interactions (agent_id, listing_id, channel, direction, outcome, note, occurred_at, source)
    VALUES (${p.agentId},
            (SELECT id FROM listings WHERE address = ${p.address} LIMIT 1),
            ${p.channel}, ${p.direction}, ${p.outcome}, ${p.note}, ${p.at}::date, 'backfill')`;
}

const [after] = await sql`SELECT count(*)::int AS n FROM agent_interactions`;
console.log(`\nupgraded ${upgrades.length}, inserted ${inserts.length}; interactions in db: ${after.n}`);
