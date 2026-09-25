/**
 * One-off: adds the "Luxury Video & Photo" SMS preset — the video-and-luxury
 * sibling of the "Backup Option" SMS preset. Same unconditional "not trying
 * to replace your team, just be the backup for the premium listings" angle,
 * but pitched at high-end homes and leading with the cinematic video tour
 * (the service a luxury listing is most likely to be missing), then drone
 * and architectural photography.
 *
 * The copy was written by Gemini (gemini-3.5-flash via our own API key),
 * not by hand — see scripts/gemini-luxury-sms-copy.mjs for the prompt and
 * the live-generation path. Prints the draft before this script re-uses it
 * as the source of truth so the two scripts never drift.
 *
 * No targeting criteria — eligible on every listing, manual pick, same as
 * "Backup Option".
 *
 * Re-runnable: creates the preset if it's missing, otherwise rewrites
 * variant A's body to whatever BODY says here, so this file stays the
 * source of truth for the copy.
 *
 * Run with: DATABASE_URL="postgres://..." node scripts/add-luxury-sms-preset.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const NAME = "Luxury Video & Photo";
const BODY =
  "Hey {{firstName}}, I'm Lukas, a videographer here in {{city}}. I saw your listing on {{street}}. " +
  "If your media person is ever booked up, I'd love to be your backup for cinematic video tours, drone, " +
  "and photos. No pressure, just wanted to say hi and put myself on your radar.";

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
console.log(`\nrendered:\n${BODY.replaceAll("{{firstName}}", "Gary").replaceAll("{{street}}", "Lariat Meadows").replaceAll("{{city}}", "Eugene")}`);

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