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
 * Amy): the three-beat skeleton (intro, listing, offer) and the "photo,
 * drone, and video" close, with the "you probably have someone you like, but
 * I'd love to be your backup" framing — which is also the voice of his own
 * best-sent SMS preset — and the booked-up / quick-turnaround trigger. The
 * per-property compliments in those drafts ("that lookout tower is awesome")
 * are deliberately dropped: a template only has {{firstName}}, {{street}} and
 * {{city}} to work with, and inventing a detail about a house is worse than
 * omitting one.
 *
 * The first version of this ran 332 characters — longer than anything else
 * in the set — and stacked three hedges ("probably already have", "just
 * putting myself", "if they're ever") while saying both "here in Eugene" and
 * "a local backup". This one keeps one hedge, states the location once (as
 * the listing's own city via {{city}}, so it stays correct wherever the
 * listing is), and comes in at 273, between the two hand-written drafts it's
 * based on.
 *
 * Re-runnable: creates the preset if it's missing, otherwise rewrites
 * variant A's body to whatever BODY says here, so this file stays the
 * source of truth for the copy.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/add-backup-sms-preset.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const NAME = "Backup Option";
const BODY =
  "Hey {{firstName}}, I'm Lukas, a real estate photographer here in {{city}}. I saw your listing on {{street}}. " +
  "You probably have a photographer you like already, but I'd love to be your backup if they're ever booked " +
  "or you need a quick turnaround. I do photo, drone, and video.";

const [existing] = await sql`
  SELECT id FROM message_presets
  WHERE channel = 'sms' AND type = 'initial_outreach' AND name = ${NAME}`;

const [current] = existing
  ? await sql`SELECT id, body FROM message_preset_variants WHERE preset_id = ${existing.id} AND label = 'A'`
  : [];

if (current?.body === BODY) {
  console.log(`"${NAME}" variant A already matches — nothing to do.`);
  process.exit(0);
}

console.log(existing ? `will rewrite "${NAME}" variant A` : `will create SMS preset "${NAME}" (no targeting criteria)`);
if (current) console.log(`\nreplacing (${current.body.length} chars):\n${current.body}`);
console.log(`\nwith (${BODY.length} chars):\n${BODY}`);
console.log(`\nrendered:\n${BODY.replaceAll("{{firstName}}", "Kelly").replaceAll("{{street}}", "Barrett").replaceAll("{{city}}", "Springfield")}`);

if (!APPLY) {
  console.log("\ndry run — nothing written. re-run with --apply");
  process.exit(0);
}

if (current) {
  await sql`UPDATE message_preset_variants SET body = ${BODY} WHERE id = ${current.id}`;
  console.log(`\nrewrote variant ${current.id}`);
} else {
  const presetId =
    existing?.id ??
    (await sql`INSERT INTO message_presets (name, type, channel)
               VALUES (${NAME}, 'initial_outreach', 'sms') RETURNING id`)[0].id;
  const [variant] = await sql`
    INSERT INTO message_preset_variants (preset_id, label, body)
    VALUES (${presetId}, 'A', ${BODY})
    RETURNING id`;
  console.log(`\ncreated preset ${presetId}, variant ${variant.id}`);
}
