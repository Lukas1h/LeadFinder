// One-off (2026-11-15): the SMS templates the cold follow-up Follow Up tabs
// read by name (src/lib/coldFollowUp/messages.ts). Starting copy only, for
// Lukas to rewrite on the Messaging page. Type follow_up, so they never count
// as initial outreach (texting quota, cold reply rate). Skips any that exist.
//
// Dry run by default: `npx tsx scripts/create-cold-followup-presets.mts`
// Save:               `npx tsx scripts/create-cold-followup-presets.mts --write`
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { neon } = await import("@neondatabase/serverless");
const q = neon(process.env.DATABASE_URL!);

const PRESETS: { name: string; body: string }[] = [
  { name: "Cold follow-up: new listing", body: "Hi {{firstName}}, it's Lukas again, the real estate photographer. Saw your new listing on {{street}}, congrats!" },
  { name: "Cold follow-up: shot one near you", body: "Hi {{firstName}}, it's Lukas again. I just shot a listing near your {{street}} property." },
  { name: "Cold follow-up: in the area", body: "Hi {{firstName}}, it's Lukas again. I was in the {{city}} area and shot a listing the other day." },
  { name: "Cold pitch: samples", body: "Would it be okay if I sent over a few samples of my work?" },
  { name: "Cold pitch: video (high end)", body: "Quick question, does your photographer do video too? I do walkthrough videos and could send you one I just made." },
  { name: "Cold pitch: turnaround", body: "Quick question, how fast does your photographer get photos back to you? I deliver by the next morning and could send you a few from my last shoot." },
  { name: "Cold pitch: soft", body: "No pressure at all, just wanted to put myself back on your radar. Could I send you a few pics from a recent shoot?" },
];

const existing = new Set(
  ((await q`select name from message_presets where name = any(${PRESETS.map((p) => p.name)}) and archived_at is null`) as { name: string }[]).map((r) => r.name)
);
const todo = PRESETS.filter((p) => !existing.has(p.name));
for (const p of PRESETS) console.log(existing.has(p.name) ? "exists " : "create ", p.name);

if (process.argv.includes("--write")) {
  for (const p of todo) {
    const [preset] = (await q`insert into message_presets (name, type, channel) values (${p.name}, 'follow_up', 'sms') returning id`) as { id: string }[];
    await q`insert into message_preset_variants (preset_id, label, body) values (${preset.id}, 'A', ${p.body})`;
    console.log("created", p.name);
  }
}
process.exit(0);
