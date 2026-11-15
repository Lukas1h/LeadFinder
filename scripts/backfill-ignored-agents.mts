// One-off (2026-11-15): before the "ignored" status existed, Lukas marked
// agents who ignored him as declined with a note like "Ignored." / "Ignored me
// after months." Move those to relationship_status = 'ignored'.
// "Ignoring for now." stays declined (that one is him, not them).
//
// Dry run by default: `npx tsx scripts/backfill-ignored-agents.mts`
// Save:               `npx tsx scripts/backfill-ignored-agents.mts --write`
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { neon } = await import("@neondatabase/serverless");
const q = neon(process.env.DATABASE_URL!);

const rows = (await q`
  select id, notes, declined_at
    from agents
   where relationship_status = 'declined'
     and notes ~* '^\\s*ignor(ed|es)\\y'
   order by declined_at`) as { id: string; notes: string; declined_at: Date }[];

for (const r of rows) console.log(r.id, JSON.stringify(r.notes.replace(/\s+/g, " ").trim()));
console.log(`${rows.length} agents to move to ignored`);

if (process.argv.includes("--write") && rows.length > 0) {
  const ids = rows.map((r) => r.id);
  const [updated] = await q.transaction([
    q`update agents
         set relationship_status = 'ignored',
             ignored_at = declined_at,
             declined_at = null
       where id = any(${ids}) and relationship_status = 'declined'
      returning id`,
  ]);
  console.log(`updated ${(updated as unknown[]).length}`);
}
process.exit(0);
