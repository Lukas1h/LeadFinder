/**
 * One-off: seeds contact history for non-cold agents from evidence that already
 * existed but was never recorded as structured interactions — replies sitting
 * in the iCloud inbox, and the hand-written notes on each agent.
 *
 * Two rules keep this from inventing history:
 *
 * 1. Only outbound touches that were NOT templated sends get logged. The cold
 *    emails are already in message_sends and show up in the same timeline, so
 *    re-logging them would double every agent's history.
 * 2. A channel and direction have to be stated, not guessed. "Emailed and they
 *    emailed me back" is an inbound email; "Almost booked, wanted photos by the
 *    28th" is clearly a conversation but says nothing about how it happened, so
 *    it's skipped and reported rather than filed under a made-up channel.
 *
 * Dates are best-effort: exact where the inbox showed one, otherwise the
 * agent's lastContactedAt (a reply lands the same day or soon after).
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-interactions.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

// Replies read off the inbox, dated from the screenshots (taken Tue 2026-09-22,
// so "Thursday" is the 17th and so on). Keyed by the name as the inbox showed
// it; matched to agents by normalized name below.
const INBOX_REPLIES = [
  ["Georgie Lewis", "2026-09-21"],
  ["Aaron Sturdevant", "2026-09-20"],
  ["Melissa Hayes", "2026-09-19"],
  ["Michelle Kohlhoff", "2026-09-18"],
  ["Shawn Gibson", "2026-09-17"],
  ["KayCee Mogel", "2026-09-17"],
  ["Donna Rinaldi", "2026-09-17"],
  ["Jill Souto-Maior", "2026-09-17"],
  ["Jon Sims", "2026-09-17"],
  ["Dyan Lane", "2026-09-17"], // inbox shows the "DeAnna and Dyan" team account
  ["Mary Abbott Portillo", "2026-09-17"],
  ["Laurie Kramer", "2026-09-17"],
  ["Preston Johnson", "2026-09-17"],
  ["Alaina Giguiere", "2026-09-17"],
  ["Caryn Yates", "2026-09-17"],
  ["Paty Emrick", "2026-09-16"],
  ["Travis Krapf", "2026-09-16"],
  ["Kandace Eubank", "2026-09-16"],
  ["Jamie Urwin", "2026-09-16"],
  ["Alex Aaronson", "2026-09-16"],
  ["January Finch", "2026-09-16"],
  ["Rich Brooke", "2026-09-16"],
  ["Damian Pavlov", "2026-09-15"],
  ["Becca Kolibaba", "2026-09-15"],
  ["Sarah Johnston", "2026-09-15"], // inbox shows "Leon & Sarah"; her notes name Leon Stamatis on the thread
  ["Wendy Carpenter-Major", "2026-09-14"],
  ["Carolyn Alexander", "2026-09-14"],
  ["Natalie Rybakov", "2026-09-14"],
];

// Deliberately NOT logged: "Hamilton, Lori — Automatic reply: Out of office
// until September 22". An autoresponder is not the person getting back to you,
// and filing it as one would overstate a relationship that hasn't started.
const SKIPPED_AUTOREPLIES = ["Lori Hamilton"];

// Interactions the notes state outright, beyond the inbound email replies
// above. Each one quotes the phrase it came from so a later reader can check
// the inference rather than trust it.
const FROM_NOTES = [
  { name: "Aisha McDonough", channel: "email", direction: "inbound", because: "they emailed me back saying they would consider me" },
  { name: "Beverly Harrison Campbell", channel: "email", direction: "inbound", because: "Saved me in her file" },
  { name: "Diego Robles", channel: "email", direction: "inbound", because: "said that they'd save me as a backup" },
  { name: "Leanna Langley", channel: "email", direction: "inbound", because: "Interested in using me as a backup" },
  { name: "Wendy Carpenter", channel: "email", direction: "inbound", because: "they emailed me back saying they would consider me" },
  { name: "Rebecca Brosi", channel: "call", direction: "outbound", because: "Emailed and called her" },
  { name: "Paty Emrick", channel: "call", direction: "inbound", because: "Called me. Wants to discuss working together on a listing" },
  { name: "Nataly Mattox", channel: "in_person", direction: "outbound", because: "Did a free video shoot for her" },
  // Tandy's note narrates a whole sequence in one day.
  { name: "Stephen G. Tandy", channel: "call", direction: "inbound", outcome: "voicemail", because: "he called me today and left a voicemail" },
  { name: "Stephen G. Tandy", channel: "call", direction: "outbound", outcome: "voicemail", because: "I called him back and left a voicemail" },
  { name: "Stephen G. Tandy", channel: "text", direction: "outbound", because: "texted him and told him to call me whenever" },
];

const norm = (s) => (s ?? "").trim().toLowerCase();

const agents = await sql`
  SELECT id, name, relationship_status AS rel, last_contacted_at, notes
  FROM agents WHERE relationship_status <> 'cold'`;
const byName = new Map(agents.map((a) => [norm(a.name), a]));

const planned = [];
const unmatched = [];

for (const [name, date] of INBOX_REPLIES) {
  const agent = byName.get(norm(name));
  if (!agent) {
    unmatched.push(name);
    continue;
  }
  planned.push({
    agentId: agent.id,
    agentName: agent.name,
    channel: "email",
    direction: "inbound",
    outcome: null,
    occurredAt: new Date(`${date}T17:00:00Z`),
    note: "Replied to the backup-photographer outreach.",
    why: `inbox reply, ${date}`,
  });
}

for (const item of FROM_NOTES) {
  const agent = byName.get(norm(item.name));
  if (!agent) {
    unmatched.push(item.name);
    continue;
  }
  // No exact date in the notes, so fall back to when they were last contacted.
  const at = agent.last_contacted_at ? new Date(agent.last_contacted_at) : new Date("2026-09-15T17:00:00Z");
  planned.push({
    agentId: agent.id,
    agentName: agent.name,
    channel: item.channel,
    direction: item.direction,
    outcome: item.outcome ?? null,
    occurredAt: at,
    note: `From notes: "${item.because}"`,
    why: "inferred from notes",
  });
}

// Non-cold agents this leaves with nothing — either their notes describe a
// conversation without saying how it happened, or there's nothing on file.
const covered = new Set(planned.map((p) => p.agentId));
const untouched = agents.filter((a) => !covered.has(a.id));

console.log(`non-cold agents: ${agents.length}`);
console.log(`interactions planned: ${planned.length} across ${covered.size} agents\n`);
for (const p of planned) {
  console.log(`  ${p.agentName} — ${p.direction} ${p.channel}${p.outcome ? ` (${p.outcome})` : ""} on ${p.occurredAt.toISOString().slice(0, 10)}  [${p.why}]`);
}

console.log(`\nno interaction inferred (${untouched.length}):`);
for (const a of untouched) {
  console.log(`  ${a.name} [${a.rel}] — ${a.notes ? "notes don't state a channel" : "no notes on file"}`);
}

if (unmatched.length) console.log(`\nin the inbox but not a non-cold agent (skipped): ${unmatched.join(", ")}`);
console.log(`skipped as autoresponders: ${SKIPPED_AUTOREPLIES.join(", ")}`);

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

for (const p of planned) {
  await sql`
    INSERT INTO agent_interactions (agent_id, channel, direction, outcome, note, occurred_at, source)
    VALUES (${p.agentId}, ${p.channel}, ${p.direction}, ${p.outcome}, ${p.note}, ${p.occurredAt}, 'backfill')`;
}

const [after] = await sql`SELECT count(*)::int AS n FROM agent_interactions`;
console.log(`\nwrote ${planned.length}; interactions in db: ${after.n}`);
