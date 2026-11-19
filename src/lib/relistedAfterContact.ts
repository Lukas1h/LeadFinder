import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * "Listed without you" (Lukas, 2026-11-18): a warm or interested agent who
 * put up another listing after he first contacted them and didn't book him
 * for it. They went and listed with someone else's photos, so they're less
 * keen than their status says, and are handled apart from the rest of
 * warm/interested (their own badge, Agents section and count).
 *
 * A listing counts when its listed date (listed_at, else found_at) is more
 * than GRACE_DAYS after his first real outbound contact (a sent text, call or
 * email, not a pending or "not sent" one), it isn't coming soon (he could
 * still get that shoot), and no booking is linked to it either way.
 *
 * Recomputes every agent's agents.relisted_* columns in one statement:
 * warm/interested agents with such listings get the count, the newest one's
 * date and id; everyone else is cleared, so a booking (status moves on to
 * worked_once) takes the flag off by itself. Run nightly from
 * /api/cron/market-status. Returns how many agents are flagged.
 */
export const RELISTED_GRACE_DAYS = 3;

export async function refreshRelistedAfterContact(): Promise<number> {
  await db.execute(sql`
    with first_contact as (
      select agent_id, min(occurred_at) as at
        from agent_interactions
       where direction = 'outbound'
         and pending_since is null
         and (outcome is null or outcome <> 'not_sent')
       group by agent_id
    ),
    relisted as (
      select distinct on (a.id)
             a.id,
             l.id as listing_id,
             coalesce(l.listed_at, l.found_at) as listed,
             count(*) over (partition by a.id) as n
        from agents a
        join first_contact fc on fc.agent_id = a.id
        join listings l on l.agent_id = a.id
       where a.relationship_status in ('warm', 'interested')
         and coalesce(l.listed_at, l.found_at) > fc.at + interval '${sql.raw(String(RELISTED_GRACE_DAYS))} days'
         and not l.is_coming_soon
         and l.booking_id is null
         and not exists (select 1 from bookings b where b.listing_id = l.id)
       order by a.id, coalesce(l.listed_at, l.found_at) desc
    ),
    cleared as (
      update agents a
         set relisted_after_contact_at = null, relisted_count = 0, relisted_listing_id = null
       where (a.relisted_count <> 0 or a.relisted_after_contact_at is not null)
         and a.id not in (select id from relisted)
    )
    update agents a
       set relisted_after_contact_at = r.listed, relisted_count = r.n, relisted_listing_id = r.listing_id
      from relisted r
     where a.id = r.id
       and (a.relisted_count is distinct from r.n::int
            or a.relisted_after_contact_at is distinct from r.listed
            or a.relisted_listing_id is distinct from r.listing_id)
  `);
  const [{ n }] = (
    await db.execute<{ n: number }>(sql`select count(*)::int as n from agents where relisted_count > 0`)
  ).rows;
  return n;
}
