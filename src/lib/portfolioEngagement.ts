import { db } from "@/db";
import { agents, portfolioLinks, portfolioSessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Portfolio bounces (Lukas, 2026-11-18): agents who opened their portfolio
 * page but barely looked. They're a different group from those who never
 * opened it (Link not opened) and those who really looked (Opened, no reply),
 * so they get their own Follow Up tab ("Opened, bounced") and badge.
 *
 * Judged over all of an agent's links and visits together: a bounce is under
 * BOUNCE_MAX_SECONDS of visible time in total, or a shallow scroll (deepest
 * under BOUNCE_MAX_SCROLL %) without SHALLOW_MAX_SECONDS of time — someone who
 * sat a minute on the video at the top did look. From the first 77 sessions
 * (2026-11-18): median 46 s, median deepest scroll 98 %, ~1 in 10 under 20 s.
 */
export const BOUNCE_MAX_SECONDS = 20;
export const BOUNCE_MAX_SCROLL = 30;
export const SHALLOW_MAX_SECONDS = 60;

export type PortfolioEngagement = "bounced" | "viewed";

export function isPortfolioBounce(totalActiveSeconds: number, maxScrollPct: number): boolean {
  if (totalActiveSeconds < BOUNCE_MAX_SECONDS) return true;
  return maxScrollPct < BOUNCE_MAX_SCROLL && totalActiveSeconds < SHALLOW_MAX_SECONDS;
}

/** Totals for one link (the portfolio list's per-link badge). */
export function linkEngagement(sessions: { activeSeconds: number; maxScrollPct: number }[]): PortfolioEngagement | null {
  if (sessions.length === 0) return null;
  const total = sessions.reduce((s, x) => s + x.activeSeconds, 0);
  const deepest = Math.max(...sessions.map((x) => x.maxScrollPct));
  return isPortfolioBounce(total, deepest) ? "bounced" : "viewed";
}

/**
 * Recomputes agents.portfolio_engagement for one agent from every visit to
 * any of their links. Called by the tracker route after each report, so the
 * first ping marks a bounce and later ones upgrade it to "viewed".
 */
export async function refreshAgentPortfolioEngagement(agentId: string): Promise<PortfolioEngagement | null> {
  const [row] = await db
    .select({
      sessions: sql<number>`count(${portfolioSessions.id})::int`,
      total: sql<number>`coalesce(sum(${portfolioSessions.activeSeconds}), 0)::int`,
      deepest: sql<number>`coalesce(max(${portfolioSessions.maxScrollPct}), 0)::int`,
    })
    .from(portfolioSessions)
    .innerJoin(portfolioLinks, eq(portfolioSessions.linkId, portfolioLinks.id))
    .where(eq(portfolioLinks.agentId, agentId));
  const value: PortfolioEngagement | null =
    !row || row.sessions === 0 ? null : isPortfolioBounce(row.total, row.deepest) ? "bounced" : "viewed";
  await db.update(agents).set({ portfolioEngagement: value }).where(eq(agents.id, agentId));
  return value;
}

/** Every agent with a link, recomputed (the backfill and a nightly safety net). */
export async function refreshAllPortfolioEngagement(): Promise<{ bounced: number; viewed: number }> {
  await db.execute(sql`
    with t as (
      select l.agent_id,
             count(s.id) as n,
             coalesce(sum(s.active_seconds), 0) as total,
             coalesce(max(s.max_scroll_pct), 0) as deepest
        from portfolio_links l
        left join portfolio_sessions s on s.link_id = l.id
       where l.agent_id is not null
       group by l.agent_id
    )
    update agents a
       set portfolio_engagement = case
             when t.n = 0 then null
             when t.total < ${BOUNCE_MAX_SECONDS} then 'bounced'
             when t.deepest < ${BOUNCE_MAX_SCROLL} and t.total < ${SHALLOW_MAX_SECONDS} then 'bounced'
             else 'viewed' end
      from t
     where a.id = t.agent_id`);
  const [row] = (
    await db.execute<{ bounced: number; viewed: number }>(sql`
      select count(*) filter (where portfolio_engagement = 'bounced')::int as bounced,
             count(*) filter (where portfolio_engagement = 'viewed')::int as viewed
        from agents`)
  ).rows;
  return row;
}
