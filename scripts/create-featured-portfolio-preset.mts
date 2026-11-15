// One-off (2026-11-15): "Portfolio link: featured shoot", the texts that send a
// portfolio page built around one of his shoots (replyActions.ts picks it when
// the link has content.featuredBookingId). Copies "Portfolio link"'s type and
// first text; only the second text changes. Skips if it exists.
//
// Dry run by default; `--write` to save.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { neon } = await import("@neondatabase/serverless");
const q = neon(process.env.DATABASE_URL!);
const NAME = "Portfolio link: featured shoot";
const SECOND = "{{portfolioLink}}\nHere are the pics from it, plus what I charged and some more of my work. Let me know what you think!";

const [base] = (await q`select p.type, v.body from message_presets p join message_preset_variants v on v.preset_id = p.id
  where p.name = 'Portfolio link' and p.channel = 'sms' and p.archived_at is null and v.enabled order by v.label limit 1`) as { type: string; body: string }[];
if (!base) throw new Error('"Portfolio link" not found');
const [existing] = (await q`select id from message_presets where name = ${NAME} and archived_at is null`) as { id: string }[];
console.log(existing ? `${NAME} exists` : `create ${NAME}: type ${base.type}, first ${JSON.stringify(base.body)}, second ${JSON.stringify(SECOND)}`);
if (process.argv.includes("--write") && !existing) {
  const [p] = (await q`insert into message_presets (name, type, channel, second_message) values (${NAME}, ${base.type}::preset_type, 'sms', ${SECOND}) returning id`) as { id: string }[];
  await q`insert into message_preset_variants (preset_id, label, body) values (${p.id}, 'A', ${base.body})`;
  console.log("created");
}
process.exit(0);
