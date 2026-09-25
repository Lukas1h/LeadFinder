/**
 * Uses our Gemini API key (the same draftMessage/photoScore path in
 * src/lib/gemini.ts) to write the copy for the "Luxury Video & Photo" SMS
 * preset — the video-and-luxury sibling of the "Backup Option" SMS preset.
 *
 * Prints the model's draft(s) to stdout; run with --apply to rewrite the
 * preset's variant A in the DB (and --commit-script to also rewrite this
 * repo's source-of-truth script body).
 *
 * Run with: node scripts/gemini-luxury-sms-copy.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";

const { callGemini } = await import("../src/lib/gemini.ts");

const APPLY = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const MODEL = "gemini-3.5-flash";
const NAME = "Luxury Video & Photo";

const BACKUP_PRESET_BODY =
  "Hey {{firstName}}, I'm Lukas, a real estate photographer here in {{city}}. I saw your listing on {{street}}. " +
  "You probably have a photographer you like already, but I'd love to be your backup if they're ever booked " +
  "or you need a quick turnaround. I do photo, drone, and video.";

const PROMPT = `You are writing a short SMS message that Lukas Hahn, a real estate videographer and photographer in Roseburg/Eugene/Medford, OR, will send to luxury real estate agents.

This new preset is the video-and-luxury sibling of his existing "Backup Option" SMS preset, which reads:

---
${BACKUP_PRESET_BODY}
---

Requirements:
- A "luxury" angle: positioned for high-end, premium, and architectural listings.
- More video-forward than the backup preset: a cinematic video tour should lead the offer (that's the service a luxurious listing is most likely missing), then drone and photography.
- Keep the same non-pushy "not trying to replace their team, happy to be the backup" attitude — luxury agents have a go-to media person and won't respond to someone trying to steal the account.
- 2-4 sentences, short and natural, like a real text typed on a phone. No sales-speak, no flattery, no "elevate", no em dashes, no exclamation points.
- Use the placeholders literally: {{firstName}} for their first name, {{street}} for the listing street, {{city}} for the listing city.
- Write ONE draft that fits the same rough length (250-340 characters) as the backup preset above.

Reply with ONLY the message text, no quotes, no commentary.`;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}

const text = await callGemini({
  model: MODEL,
  apiKey,
  parts: [{ text: PROMPT }],
  generationConfig: { temperature: 0.9 },
  logLabel: "geminiLuxurySms",
});

if (!text) {
  console.error("Gemini failed to produce a draft");
  process.exit(1);
}

console.log("======== GEMINI DRAFT ========");
console.log(text);
console.log("===============================");
console.log(`(length: ${text.length} chars)`);

if (!APPLY) {
  console.log("dry run — pass --apply to write this into the preset in the DB");
  process.exit(0);
}

const [existing] = await sql`
  SELECT id FROM message_presets
  WHERE channel = 'sms' AND type = 'initial_outreach' AND name = ${NAME}`;
if (!existing) {
  console.error(`no preset named "${NAME}" found in DB`);
  process.exit(1);
}

const existingVariants = await sql`
  DELETE FROM message_preset_variants
  WHERE preset_id = ${existing.id} AND label = 'A'
  RETURNING id`;
if (existingVariants.length) console.log(`removed ${existingVariants.length} existing variant A`);

const [variant] = await sql`
  INSERT INTO message_preset_variants (preset_id, label, body)
  VALUES (${existing.id}, 'A', ${text.trim()})
  RETURNING id`;
console.log(`wrote variant A: ${variant.id}`);