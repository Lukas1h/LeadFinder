/**
 * Dry run for the cold follow-up pool and its triggers.
 *
 *   npx tsx scripts/cold-followup-dryrun.mts [--names]
 *
 * Read-only. Prints who is in the pool, how many candidates each trigger
 * finds (by market and by whether the "samples" ask is still new to them), and
 * a few sample rows per trigger. Names, phones and emails stay off unless
 * --names is passed.
 */

import { config } from "dotenv";
import type { ColdCandidate } from "@/lib/coldFollowUp/triggers";

// Env first: the db module reads DATABASE_URL, so everything that touches it
// is imported dynamically below (the same pattern as the other scripts).
config({ path: ".env.local", quiet: true });

const { COLD_TRIGGERS, MAX_COLD_FOLLOW_UPS, MIN_GAP_DAYS, loadColdPool } = await import("@/lib/coldFollowUp/pool");
const { getColdFollowUpCandidates } = await import("@/lib/coldFollowUp/triggers");
// Outside Next there's no request to cache the markets in, so build the index
// straight from the table (lib/marketsData.ts).
const { loadMarketDefs } = await import("@/lib/marketsData");
const { MarketIndex } = await import("@/lib/markets");
const mk = new MarketIndex(await loadMarketDefs());

const DAY = 24 * 60 * 60 * 1000;
const SAMPLES_PER_TRIGGER = 10;
const showNames = process.argv.includes("--names");

const now = Date.now();

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value.padEnd(width);
}

function padLeft(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function stamp(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function miles(m: number): string {
  return `${m < 0.1 ? "<0.1" : m.toFixed(1)} mi`;
}

function tally(items: ColdCandidate[], key: (c: ColdCandidate) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

const pool = await loadColdPool(now);
const candidates = await getColdFollowUpCandidates(now);

console.log(`Cold follow-up dry run — ${stamp(now)}\n`);
console.log(
  `Pool: ${pool.length} cold agents texted, never replied, quiet ${MIN_GAP_DAYS}+ days, ` +
    `fewer than ${MAX_COLD_FOLLOW_UPS} cold follow-ups sent`
);
console.log(`Candidates: ${candidates.length}\n`);

// By trigger ------------------------------------------------------------------
console.log(pad("by trigger", 24) + padLeft("count", 6));
console.log("  " + "-".repeat(30));
for (const key of COLD_TRIGGERS) {
  console.log("  " + pad(key, 22) + padLeft(candidates.filter((c) => c.trigger === key).length, 6));
}

// By trigger x market ---------------------------------------------------------
// Every market key, so a candidate in a paused market or "unassigned" is still
// counted in a column.
const MARKET_COLUMNS = mk.keys;
const MARKET_WIDTH = Math.max(10, ...MARKET_COLUMNS.map((m) => m.length + 2));
console.log("\n" + pad("by trigger x market", 24) + MARKET_COLUMNS.map((m) => padLeft(m, MARKET_WIDTH)).join(""));
console.log("  " + "-".repeat(24 + MARKET_COLUMNS.length * MARKET_WIDTH));
const byMarket = tally(candidates, (c) => `${c.trigger}|${c.market}`);
for (const key of COLD_TRIGGERS) {
  const counts = MARKET_COLUMNS.map((m) => byMarket.get(`${key}|${m}`) ?? 0);
  console.log("  " + pad(key, 22) + counts.map((n) => padLeft(n, MARKET_WIDTH)).join(""));
}

// By trigger x samples eligibility -------------------------------------------
console.log("\n" + pad("by trigger x samples ask", 24) + padLeft("eligible", 10) + padLeft("not", 6));
console.log("  " + "-".repeat(40));
for (const key of COLD_TRIGGERS) {
  const rows = candidates.filter((c) => c.trigger === key);
  const yes = rows.filter((c) => c.samplesAskEligible).length;
  console.log("  " + pad(key, 22) + padLeft(yes, 10) + padLeft(rows.length - yes, 6));
}

// Samples ---------------------------------------------------------------------
const COLUMNS: [string, number][] = [
  ["agent", 38],
  ["city", 16],
  ["listing address", 34],
  ["shoot", 34],
  ["since text", 11],
];
for (const key of COLD_TRIGGERS) {
  const rows = candidates.filter((c) => c.trigger === key).slice(0, SAMPLES_PER_TRIGGER);
  console.log(`\n${key} — ${rows.length ? `first ${rows.length}` : "nobody"}`);
  if (rows.length === 0) continue;
  const header = COLUMNS.map(([label], i) => (i >= 4 ? padLeft(label, COLUMNS[i][1]) : pad(label, COLUMNS[i][1])));
  const width = COLUMNS.reduce((sum, [, w]) => sum + w, 0);
  console.log("  " + header.join("") + (showNames ? "  name / phone / email" : ""));
  console.log("  " + "-".repeat(width + (showNames ? 40 : 0)));
  for (const c of rows) {
    const shoot = c.shoot ? `${c.shoot.city ?? "—"} ${miles(c.shoot.miles)} ${c.shoot.date}` : "—";
    const days = Math.floor((now - c.lastTextedAt.getTime()) / DAY);
    const identity = showNames
      ? `  ${c.agent.name ?? "—"} / ${c.agent.phone ?? "—"} / ${c.agent.email ?? "—"}`
      : "";
    console.log(
      "  " +
        [
          pad(c.agent.id, 38),
          pad(c.listing.city ?? "—", 16),
          pad(c.listing.address ?? "—", 34),
          pad(shoot, 34),
          padLeft(`${days}d`, 11),
        ].join("") +
        identity
    );
  }
}

process.exit(0);
