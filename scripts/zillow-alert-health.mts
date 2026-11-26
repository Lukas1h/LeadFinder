/**
 * Zillow email-alert health (read-only): one row per saved search over the
 * last N days, from the `alert_emails` table. Zillow's daily digest shows at
 * most 10 updates and hides the rest behind "View all updates" (see the
 * comment on alertEmails in src/db/schema.ts), so a search whose digests keep
 * coming back truncated is losing new listings and needs splitting.
 *
 *   npx tsx scripts/zillow-alert-health.mts [--days N]   (default 7)
 *
 * Prints an aligned table sorted by truncated desc, then new desc, plus a
 * "Needs splitting" list: searches whose name contains "Just listed" and that
 * were truncated on 2+ digests in the window.
 */

import { config } from "dotenv";

// Env first: the db module reads DATABASE_URL, so everything that touches it
// is imported dynamically below (the same pattern as the other scripts).
config({ path: ".env.local", quiet: true });

const daysArg = process.argv.indexOf("--days");
const parsedDays = daysArg > 0 ? Number(process.argv[daysArg + 1]) : NaN;
const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : 7;

const { db } = await import("@/db");
const { alertEmails } = await import("@/db/schema");
const { gte } = await import("drizzle-orm");

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const rows = await db
  .select({
    searchName: alertEmails.searchName,
    kind: alertEmails.kind,
    newListings: alertEmails.newListings,
    truncated: alertEmails.truncated,
    inserted: alertEmails.inserted,
  })
  .from(alertEmails)
  .where(gte(alertEmails.receivedAt, cutoff));

if (rows.length === 0) {
  console.log(`No alert emails in the last ${days} day${days === 1 ? "" : "s"} — the webhook hasn't logged anything yet.`);
  process.exit(0);
}

interface SearchHealth {
  name: string;
  digests: number;
  instant: number;
  newListings: number;
  truncated: number;
  inserted: number;
}

const bySearch = new Map<string, SearchHealth>();
for (const row of rows) {
  const name = row.searchName ?? "(unnamed)";
  let health = bySearch.get(name);
  if (!health) {
    health = { name, digests: 0, instant: 0, newListings: 0, truncated: 0, inserted: 0 };
    bySearch.set(name, health);
  }
  const isDigest = row.kind === "instantsearchdigest";
  if (isDigest) health.digests++;
  if (row.kind === "instantsavedsearch") health.instant++;
  health.newListings += row.newListings ?? 0;
  if (isDigest && row.truncated) health.truncated++;
  health.inserted += row.inserted ?? 0;
}

const health = [...bySearch.values()].sort((a, b) => b.truncated - a.truncated || b.newListings - a.newListings);

const avg = (h: SearchHealth) => (h.digests > 0 ? h.newListings / h.digests : 0);
const clip = (value: string, width: number) => (value.length > width ? `${value.slice(0, width - 1)}…` : value);

const headers = ["Search", "Digests", "Instant", "New", "Avg/digest", "Truncated", "Inserted"];
const widths = [44, 7, 7, 6, 10, 9, 8];
const line = (cells: string[]) =>
  cells
    .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
    .join("  ");

console.log(`Zillow alert health, last ${days} day${days === 1 ? "" : "s"} (${rows.length} emails)\n`);
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const h of health) {
  console.log(
    line([
      clip(h.name, widths[0]),
      String(h.digests),
      String(h.instant),
      String(h.newListings),
      avg(h).toFixed(1),
      String(h.truncated),
      String(h.inserted),
    ])
  );
}

const needsSplitting = health.filter((h) => /just listed/i.test(h.name) && h.truncated >= 2);
console.log("\nNeeds splitting:");
if (needsSplitting.length === 0) {
  console.log("  (none)");
} else {
  for (const h of needsSplitting) {
    console.log(`  - ${h.name}: truncated on ${h.truncated} of ${h.digests} digests`);
  }
}

process.exit(0);
