/**
 * One-off: re-times inbound replies that were logged before the send they were
 * answering, and re-points the send each one credits.
 *
 * Two ways the bad timestamps got in:
 *
 *  - Local wall-clock written as UTC. An MCP agent reading "10:50 AM" off an
 *    iMessage screenshot logged it as 10:50Z, seven hours before the text
 *    actually went out at 17:50Z. markLatestSendResponded then walked back to
 *    the newest send *before* that time and marked a six-day-old cold email as
 *    replied, which is what Kurt Delahooke's history shows.
 *
 *  - The contact-history backfill, which had a date from a note or a screenshot
 *    but no time, and used 17:00Z as a placeholder. That lands before the sends
 *    it was meant to answer, so those replies matched nothing at all and 17 of
 *    them were never credited to any send.
 *
 * The repair picks, for each reply, the send it was plausibly answering:
 * preferring one on the same channel (a text reply answers a text), the latest
 * such send on or before the end of that reply's Pacific day. The reply is then
 * moved to one minute after that send — we don't know the real reply time, and
 * one minute after claims no more than "after this, same day", which is all the
 * evidence supports.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/fix-reply-timestamps.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);
const iso = (d) => d.toISOString().replace(".000Z", "Z");

const replies = await sql`
  SELECT i.id, i.agent_id, i.occurred_at, i.channel, a.name
  FROM agent_interactions i JOIN agents a ON a.id = i.agent_id
  WHERE i.direction = 'inbound' ORDER BY i.occurred_at`;

const plan = [];

for (const r of replies) {
  const sends = await sql`
    SELECT m.id, m.sent_at, m.channel, m.responded_at, p.name AS preset
    FROM message_sends m JOIN message_presets p ON p.id = m.preset_id
    WHERE m.agent_id = ${r.agent_id} ORDER BY m.sent_at`;
  if (sends.length === 0) continue;

  // The send currently carrying this reply's timestamp, if any — that's the one
  // this reply marked, right or wrong.
  const stamped = sends.find((s) => s.responded_at && +s.responded_at === +r.occurred_at) ?? null;

  // Same channel first — a text reply answers the text, not last week's email.
  // The two tables don't share a vocabulary: agent_interactions.channel says
  // "text" where message_sends.channel says "sms", so comparing them raw
  // silently matches nothing and every text reply falls back to the whole
  // send list.
  const sameChannel = sends.filter((s) => s.channel === (r.channel === "text" ? "sms" : r.channel));
  const pool = sameChannel.length ? sameChannel : sends;

  // Normally the reply answers the newest send that precedes it. When none
  // does, the timestamp itself is early (that's the whole bug), so take the
  // first send that follows it instead — bounded to a day, past which we have
  // no reason to tie the two together.
  const preceding = pool.filter((s) => s.sent_at <= r.occurred_at);
  const following = pool.filter((s) => s.sent_at > r.occurred_at);
  const target =
    preceding.length > 0
      ? preceding[preceding.length - 1]
      : following.length > 0 && +following[0].sent_at - +r.occurred_at < 24 * 3600_000
        ? following[0]
        : null;
  if (!target) continue;

  const needsRetime = r.occurred_at < target.sent_at;
  const needsRepoint = stamped?.id !== target.id;
  if (!needsRetime && !needsRepoint) continue;

  plan.push({
    reply: r,
    target,
    stamped,
    newAt: needsRetime ? new Date(+target.sent_at + 60_000) : r.occurred_at,
    needsRetime,
    needsRepoint,
  });
}

console.log(`inbound replies examined: ${replies.length}`);
console.log(`needing repair: ${plan.length}\n`);

for (const p of plan) {
  console.log(`${p.reply.name}`);
  if (p.needsRetime) {
    console.log(`  reply  ${iso(p.reply.occurred_at)} -> ${iso(p.newAt)}  (1 min after the ${p.target.channel})`);
  }
  if (p.needsRepoint) {
    console.log(
      `  credit ${p.stamped ? `${p.stamped.channel}/${p.stamped.preset} (${iso(p.stamped.sent_at)})` : "nothing"}` +
        ` -> ${p.target.channel}/${p.target.preset} (${iso(p.target.sent_at)})`
    );
  }
}

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

for (const p of plan) {
  if (p.needsRetime) {
    await sql`UPDATE agent_interactions SET occurred_at = ${p.newAt} WHERE id = ${p.reply.id}`;
  }
  if (p.needsRepoint) {
    if (p.stamped) {
      await sql`UPDATE message_sends SET responded_at = NULL WHERE id = ${p.stamped.id}`;
    }
    // Only ever fills an empty slot: responded_at records the FIRST reply, and
    // a send already carrying one was answered by something else.
    await sql`UPDATE message_sends SET responded_at = ${p.newAt}
              WHERE id = ${p.target.id} AND responded_at IS NULL`;
  }
}

const [after] = await sql`
  SELECT count(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responded FROM message_sends`;
const [orphan] = await sql`
  SELECT count(*)::int AS n FROM agent_interactions i
  WHERE i.direction = 'inbound'
    AND EXISTS (SELECT 1 FROM message_sends m WHERE m.agent_id = i.agent_id)
    AND NOT EXISTS (SELECT 1 FROM message_sends m WHERE m.agent_id = i.agent_id AND m.responded_at IS NOT NULL)`;
console.log(`\nsends now marked replied: ${after.responded}`);
console.log(`inbound replies still crediting no send: ${orphan.n}`);
