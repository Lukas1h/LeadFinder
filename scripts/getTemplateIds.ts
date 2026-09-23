// Utility script to get preset and variant IDs for Cold Outreach template
// Usage: node --env-file=.env.local ./node_modules/.bin/tsx scripts/getTemplateIds.ts

import { db } from "../src/db";
import { messagePresets, messagePresetVariants } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [preset] = await db
    .select()
    .from(messagePresets)
    .where(eq(messagePresets.name, "Cold Outreach"));

  if (!preset) {
    console.error("Cold Outreach preset not found");
    process.exit(1);
  }

  const variants = await db
    .select()
    .from(messagePresetVariants)
    .where(eq(messagePresetVariants.presetId, preset.id));

  if (variants.length === 0) {
    console.error("No variants found for Cold Outreach");
    process.exit(1);
  }

  console.log("Preset ID:", preset.id);
  console.log("Variants:");
  variants.forEach((v, i) => {
    console.log(`  [${i}] ${v.id} - ${v.label || "(default)"}`);
  });

  // Export as shell variable format for easy sourcing
  console.log("\n# Use in scripts:");
  console.log(`COLD_OUTREACH_PRESET_ID="${preset.id}"`);
  console.log(`COLD_OUTREACH_VARIANT_ID="${variants[0].id}"`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
