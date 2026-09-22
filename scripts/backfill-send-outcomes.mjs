/**
 * One-off: applies the two links that never existed, to the history that was
 * already on file.
 *
 * respondedAt could only ever be written by resolveSendOutcome, which finds
 * sends by listingId. 5,146 of 5,217 sends are cold emails to an agent with no
 * listing at all, so no agent-level send had ever been marked replied — not
 * because nobody replied, but because there was no code path that could say so.
 * Every logged inbound interaction now stamps the send it was answering.
 *
 * Bookings had the same shape of problem in reverse: revenue was derived
 * send -> listing -> booking, and every booking so far was arranged directly
 * with an agent and carries no listing, so no preset variant could ever be
 * credited with the work it won.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/backfill-send-outcomes.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);
const ATTRIBUTION_WINDOW_DAYS = 120;

// For each inbound interaction, the agent's latest still-unmarked send that
// predates it — the same rule markLatestSendResponded applies going forward.
const replies = await sql`
  SELECT DISTINCT ON (i.id)
         i.id AS interaction_id, i.occurred_at, a.name AS agent_name, m.id AS send_id, m.sent_at
  FROM agent_interactions i
  JOIN agents a ON a.id = i.agent_id
  JOIN message_sends m
    ON m.agent_id = i.agent_id AND m.sent_at <= i.occurred_at AND m.responded_at IS NULL
  WHERE i.direction = 'inbound'
  ORDER BY i.id, m.sent_at DESC`;

// One send can only be "first replied to" once, so collapse to the earliest
// reply per send rather than letting two interactions fight over it.
const bySend = new Map();
for (const r of replies) {
  const prev = bySend.get(r.send_id);
  if (!prev || new Date(r.occurred_at) < new Date(prev.occurred_at)) bySend.set(r.send_id, r);
}

const bookings = await sql`
  SELECT b.id, b.job_date, b.created_at, b.contact_agent_id, a.name AS agent_name,
         (SELECT coalesce(sum(amount), 0)::int FROM booking_line_items li WHERE li.booking_id = b.id) AS value
  FROM bookings b LEFT JOIN agents a ON a.id = b.contact_agent_id
  WHERE b.message_send_id IS NULL
  ORDER BY b.created_at`;

const attributions = [];
const unattributed = [];
for (const b of bookings) {
  if (!b.contact_agent_id) {
    unattributed.push({ ...b, why: "no contact agent on the booking" });
    continue;
  }
  const bookedAt = b.job_date ?? b.created_at;
  const cutoff = new Date(new Date(bookedAt).getTime() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [send] = await sql`
    SELECT m.id, m.sent_at, p.name AS preset
    FROM message_sends m JOIN message_presets p ON p.id = m.preset_id
    WHERE m.agent_id = ${b.contact_agent_id} AND m.sent_at <= ${bookedAt} AND m.sent_at >= ${cutoff}
    ORDER BY m.sent_at DESC LIMIT 1`;
  if (!send) {
    unattributed.push({ ...b, why: "no outreach to this agent in the window" });
    continue;
  }
  const days = Math.round((new Date(bookedAt) - new Date(send.sent_at)) / 86400000);
  attributions.push({ booking: b, send, days });
}

console.log(`replies that will mark a send responded: ${bySend.size}`);
for (const r of bySend.values()) {
  console.log(`  ${r.agent_name}: reply ${new Date(r.occurred_at).toISOString().slice(0, 10)} -> send ${new Date(r.sent_at).toISOString().slice(0, 10)}`);
}

console.log(`\nbookings that will be attributed: ${attributions.length}`);
for (const a of attributions) {
  console.log(`  ${a.booking.agent_name} — $${a.booking.value} booked, ${a.days}d after "${a.send.preset}" (${new Date(a.send.sent_at).toISOString().slice(0, 10)})`);
}

if (unattributed.length) {
  console.log(`\nleft unattributed (${unattributed.length}):`);
  for (const u of unattributed) console.log(`  ${u.agent_name ?? "(no agent)"} — $${u.value} — ${u.why}`);
}

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

for (const r of bySend.values()) {
  await sql`UPDATE message_sends SET responded_at = ${r.occurred_at} WHERE id = ${r.send_id}`;
}
for (const a of attributions) {
  await sql`UPDATE bookings SET message_send_id = ${a.send.id} WHERE id = ${a.booking.id}`;
  await sql`UPDATE message_sends SET result = 'booked' WHERE id = ${a.send.id}`;
}

const [after] = await sql`SELECT
  count(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responded,
  count(*) FILTER (WHERE result = 'booked')::int AS booked
  FROM message_sends`;
console.log(`\nsends now: ${after.responded} responded, ${after.booked} booked`);
