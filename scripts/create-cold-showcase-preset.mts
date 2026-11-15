// One-off (2026-11-15): the "Cold pitch: showcase" text template, sent after a
// cold follow-up's excuse when the nearby shoot is marked Showcase. Its quick
// action is "Portfolio link", whose builder prefills the featured shoot from
// the send (message_sends.featured_booking_id). Also rewords the near-shoot
// excuse to Lukas's phrasing if it's still the original placeholder.
//
// Dry run by default: `npx tsx scripts/create-cold-showcase-preset.mts`
// Save:               `npx tsx scripts/create-cold-showcase-preset.mts --write`
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { neon } = await import("@neondatabase/serverless");
const q = neon(process.env.DATABASE_URL!);
const write = process.argv.includes("--write");

const NAME = "Cold pitch: showcase";
const BODY = "I was wondering if I could share a few pics from it and what I charged?";
const NEAR_OLD = "Hi {{firstName}}, it's Lukas again. I just shot a listing near your {{street}} property.";
const NEAR_NEW = "Hi {{firstName}}, it's Lukas again, the real estate photographer. I just finished a shoot down the road from your {{street}} listing.";

const [portfolio] = (await q`select id from message_presets where name = 'Portfolio link' and channel = 'sms' and archived_at is null`) as { id: string }[];
if (!portfolio) throw new Error('"Portfolio link" template not found');
const [existing] = (await q`select id from message_presets where name = ${NAME} and archived_at is null`) as { id: string }[];
console.log(existing ? `${NAME} exists` : `create ${NAME} with quick action Portfolio link (${portfolio.id})`);

const near = (await q`select v.id from message_preset_variants v join message_presets p on p.id = v.preset_id
  where p.name = 'Cold follow-up: shot one near you' and v.body = ${NEAR_OLD}`) as { id: string }[];
console.log(near.length ? "reword near-shoot excuse (still the placeholder)" : "near-shoot excuse already edited, leaving it");

if (write) {
  if (!existing) {
    const [p] = (await q`insert into message_presets (name, type, channel, quick_action_preset_ids)
      values (${NAME}, 'follow_up', 'sms', ${JSON.stringify([portfolio.id])}::jsonb) returning id`) as { id: string }[];
    await q`insert into message_preset_variants (preset_id, label, body) values (${p.id}, 'A', ${BODY})`;
    console.log("created", NAME);
  }
  for (const v of near) await q`update message_preset_variants set body = ${NEAR_NEW} where id = ${v.id}`;
}
process.exit(0);
