/**
 * The Home funnel's numbers as the app gets them (computeFunnelSplit), printed
 * as JSON.
 *
 *   npx tsx scripts/funnel-check.mts
 *
 * Read-only. Checks that the cold follow-up row is kept out of the Follow up
 * row and adds back up per market:
 *
 * - followUp.reached / coldFollowUp.reached are separate counts (an agent can
 *   appear in both, once each);
 * - summing byMarket's followUp and coldFollowUp gives followUp / coldFollowUp.
 */

import { config } from "dotenv";

// Env first: the db module reads DATABASE_URL, so everything that touches it
// is imported dynamically below (the same pattern as the other scripts).
config({ path: ".env.local", quiet: true });

const { computeFunnelSplit } = await import("@/lib/funnelSplit");

const split = await computeFunnelSplit();

console.log(JSON.stringify(split, null, 2));

const markets = Object.entries(split.byMarket);
const sum = (key: "followUp" | "coldFollowUp") =>
  markets.reduce((total, [, entry]) => total + entry[key].reached, 0);
for (const key of ["followUp", "coldFollowUp"] as const) {
  if (sum(key) !== split[key].reached) {
    console.error(`${key}: markets add up to ${sum(key)}, row says ${split[key].reached}`);
    process.exit(1);
  }
}

process.exit(0);
