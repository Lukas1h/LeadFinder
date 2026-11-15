/**
 * What the Follow up page's Cold tabs would show right now.
 *
 *   npx tsx scripts/cold-feed-check.mts
 *
 * Read-only (SELECT only). Prints each enabled cold feed's item count and its
 * first five cards: agent id, the label under the name, and the two texts.
 * Names appear only as the first name inside the text; no phones or emails.
 *
 * This runs the page's own code (feeds/coldFollowUps.ts), so it checks the
 * whole path: pool → triggers → segments → templates → FeedItems.
 */

import { config } from "dotenv";

// Env first: the db module reads DATABASE_URL, so everything that touches it
// is imported dynamically below (the same pattern as the other scripts).
config({ path: ".env.local", quiet: true });

const { ENABLED_COLD_FEEDS, getColdFollowUpGroups } = await import("../src/app/follow-up/feeds/coldFollowUps");

const groups = await getColdFollowUpGroups();

console.log(`Enabled cold feeds: ${ENABLED_COLD_FEEDS.join(", ") || "(none)"}`);
for (const key of ENABLED_COLD_FEEDS) {
  const group = groups[key];
  console.log(`\n${key} — "${group.title}": ${group.items.length} item(s)`);
  for (const item of group.items.slice(0, 5)) {
    console.log(`\n  agent ${item.agent.id}`);
    console.log(`  label     ${item.label}`);
    console.log(`  text 1    ${item.suggestion}`);
    console.log(`  text 2    ${item.secondText ?? "(none)"}`);
  }
}

process.exit(0);
