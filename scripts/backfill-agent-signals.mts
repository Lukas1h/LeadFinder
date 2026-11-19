// One-off (2026-11-18): fill the new agent signal columns from existing data.
//   saved_contact_at      <- each agent's first save_contact portfolio event
//   portfolio_engagement  <- refreshAllPortfolioEngagement()
//   relisted_*            <- refreshRelistedAfterContact()
// Safe to re-run: only derived columns, saved_contact_at only filled where null.
// Run: npx tsx scripts/backfill-agent-signals.mts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { db } = await import("../src/db");
const { sql } = await import("drizzle-orm");
const { refreshAllPortfolioEngagement } = await import("../src/lib/portfolioEngagement");
const { refreshRelistedAfterContact } = await import("../src/lib/relistedAfterContact");

const saved = await db.execute<{ id: string }>(sql`
  update agents a set saved_contact_at = s.at
    from (select l.agent_id, min(e.at) as at
            from portfolio_events e join portfolio_links l on l.id = e.link_id
           where e.event = 'save_contact' and l.agent_id is not null
           group by l.agent_id) s
   where a.id = s.agent_id and a.saved_contact_at is null
  returning a.id`);
console.log("saved_contact_at filled:", saved.rows.length);
console.log("portfolio engagement:", await refreshAllPortfolioEngagement());
console.log("relisted after contact:", await refreshRelistedAfterContact());
process.exit(0);
