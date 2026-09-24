/**
 * One-off: adds the SMS counterpart to the "Cold Outreach" email preset —
 * the backup-photographer pitch, with no targeting criteria.
 *
 * There is already a "Great Photos / Backup Photographer" preset, but it's a
 * different message: its criteria are min_score=7 / min_photo_count=15 and
 * both its variants open by complimenting the photos ("the photos look
 * great!"). That only makes sense on a listing picked *because* its
 * photography is already good.
 *
 * This one makes no claim about the listing's photos, so it's eligible
 * everywhere — the same unconditional "I'm not trying to replace your
 * photographer, just be your backup" angle the cold email uses, which is the
 * one pitch that has no SMS equivalent.
 *
 * Copy is a blend of three drafts Lukas sent by hand (to Kurt, Kelly and
 * Amy): the self-intro and "photo, drone, and video" close from all three,
 * "putting myself on your radar as a local backup" from the Kelly one, and
 * the booked-up / quick-turnaround trigger plus the soft "feel free to text
 * me" CTA from the Kelly and Amy ones. The per-property compliments in those
 * drafts ("that lookout tower is awesome") are deliberately dropped — a
 * template only has {{firstName}} and {{street}} to work with, and inventing
 * a detail is worse than omitting one.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/add-backup-sms-preset.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const NAME = "Backup Option";
const BODY =
  "Hey {{firstName}}, I'm Lukas. I'm a real estate photographer here in Eugene and saw your listing on {{street}}. " +
  "You probably already have a photographer you like, so I'm just putting myself on your radar as a local backup. " +
  "If they're ever booked up or you need a quick turnaround, feel free to text me. I do photo, drone, and video.";

const [existing] = await sql`
  SELECT id FROM message_presets
  WHERE channel = 'sms' AND type = 'initial_outreach' AND name = ${NAME}`;

if (existing) {
  console.log(`"${NAME}" already exists (${existing.id}) — nothing to do.`);
  process.exit(0);
}

console.log(`will create SMS preset "${NAME}" (initial_outreach, no targeting criteria)`);
console.log(`variant A, ${BODY.length} chars:\n`);
console.log(BODY);
console.log(`\nrendered for an example agent/listing:\n`);
console.log(BODY.replaceAll("{{firstName}}", "Kelly").replaceAll("{{street}}", "Barrett"));

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

const [preset] = await sql`
  INSERT INTO message_presets (name, type, channel)
  VALUES (${NAME}, 'initial_outreach', 'sms')
  RETURNING id`;
const [variant] = await sql`
  INSERT INTO message_preset_variants (preset_id, label, body)
  VALUES (${preset.id}, 'A', ${BODY})
  RETURNING id`;

console.log(`\ncreated preset ${preset.id}, variant ${variant.id}`);
