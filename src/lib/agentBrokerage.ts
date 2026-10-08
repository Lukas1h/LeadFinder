import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * The most recent brokerage name we have per agent.
 *
 * A listing carries its own broker_name snapshot and nothing on the agents row
 * does — but the iPhone app wants one brokerage per agent, for caller ID and
 * for the cold-contact tag ("Realtor" vs "Coldwell Banker"), which the web
 * gets by looking at an agent's listings. DISTINCT ON keeps it to one query
 * over a table with tens of thousands of rows; the agent table itself is
 * ~6,000.
 *
 * Server-only (it queries the DB).
 */
export async function brokerageByAgent(): Promise<Map<string, string>> {
  // DISTINCT ON needs its expressions to match the leftmost ORDER BY, which
  // the query builder can't express, so this one is raw.
  const result = await db.execute(sql`
    select distinct on (agent_id) agent_id, broker_name
    from listings
    where agent_id is not null and broker_name is not null
    order by agent_id, found_at desc
  `);

  const byAgent = new Map<string, string>();
  for (const row of result.rows as { agent_id: string; broker_name: string }[]) {
    byAgent.set(row.agent_id, row.broker_name);
  }
  return byAgent;
}
