/**
 * What the Follow up page's Cold tabs would show right now.
 *
 *   npx tsx scripts/cold-feed-check.mts
 *
 * Read-only (SELECT only). Prints, for every cold feed key in turn, how many
 * cards it has and its first three: agent id, the group (trigger) the card
 * sits under, the label, and the two texts.
 *
 * This runs the page's own code (feeds/coldFollowUps.ts), so it checks the
 * whole path: pool → triggers → segments → templates → FeedItems.
 */

import { config } from "dotenv";

// Env first: the db module reads DATABASE_URL, so everything that touches it
// is imported dynamically below (the same pattern as the other scripts).
config({ path: ".env.local", quiet: true });

const { COLD_FEED_KEYS } = await import("../src/lib/coldFollowUp/pool");
const { ENABLED_COLD_TRIGGERS, getColdFollowUpGroups } = await import(
  "../src/app/follow-up/feeds/coldFollowUps"
);

const feeds = await getColdFollowUpGroups();

console.log(`Enabled cold triggers: ${ENABLED_COLD_TRIGGERS.join(", ") || "(none)"}`);
console.log(`Cold feed keys: ${COLD_FEED_KEYS.join(", ")}`);
for (const key of COLD_FEED_KEYS) {
  const groups = feeds[key];
  const items = groups.flatMap((group) => group.items.map((item) => ({ group: group.title, item })));
  const shape = groups.length === 0 ? "empty" : groups.map((g) => `"${g.title}": ${g.items.length}`).join(", ");
  console.log(`\n${key} — ${items.length} item(s) (${shape})`);
  for (const { group, item } of items.slice(0, 3)) {
    console.log(`\n  agent ${item.agent.id}`);
    console.log(`  group     ${group}`);
    console.log(`  label     ${item.label}`);
    console.log(`  text 1    ${item.suggestion}`);
    console.log(`  text 2    ${item.secondText ?? "(none)"}`);
  }
}

process.exit(0);
