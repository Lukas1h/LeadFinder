import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Sets agents.homeCity to the city they list in most (newest wins a tie) for
 * everyone he knows. One statement; run daily by the homes-refresh cron.
 */
export async function refreshAgentHomeCities(): Promise<number> {
  const result = await db.execute(sql`
    update agents a set home_city = top.city
    from (
      select distinct on (agent_id) agent_id, city
      from (
        select agent_id, initcap(lower(trim(city))) as city, count(*) as n, max(coalesce(listed_at, found_at)) as latest
        from listings
        where agent_id is not null and city is not null and trim(city) <> ''
        group by 1, 2
      ) c
      order by agent_id, n desc, latest desc
    ) top
    where a.id = top.agent_id
      and a.relationship_status in ('regular', 'worked_once', 'interested', 'warm')
      and a.home_city is distinct from top.city
  `);
  return result.rowCount ?? 0;
}
