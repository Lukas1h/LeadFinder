// Tests for the homes.com profile parser, built from a real captured page
// (Geoff O'Neill, Medford OR, 2026-10-21) rather than invented markup.
//
// The cases that matter are the ones that were wrong before: the page carries
// all three transaction-history windows at once (1 Year, 2 Year, 5 Year), and
// summing every "Total Deals" on the page gave 52 — the total of three
// OVERLAPPING windows, which means nothing. The agent's year is 3.
//
// Run: npx tsx scripts/homes-profile.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHomesProfile } from "../src/lib/homesProfile";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, "fixtures", "homes-agent-profile.html"), "utf8");
const URL_ = "https://www.homes.com/real-estate-agents/geoff-oneill/53q574n/";

let pass = 0;
let fail = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("  ok   " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL " + name + "\n         " + (e as Error).message);
  }
}

console.log("\nparseHomesProfile");

t("reads the agent's name from the JSON-LD Person node, not the page title", () => {
  // Only the JSON-LD's name changes — the <title> keeps homes.com's mangled
  // spelling, so a title-based parse would return the wrong thing.
  const html = FIXTURE.replace('"name": "Geoff O\'neill"', '"name": "Geoff O\'Neill"');
  const p = parseHomesProfile(html, URL_);
  assert.ok(p);
  assert.equal(p.name, "Geoff O'Neill");
  assert.match(html, /<title>Geoff O'neill/);
});

t("reads the phone from the agent's own JSON", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  assert.equal(p.phone, "5413198935");
});

t("reads the brokerage and the license", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  assert.equal(p.brokerage, "John L. Scott Medford");
  assert.equal(p.licenseId, "200208122");
});

t("counts the 1 Year tab only — 1 seller + 2 buyer, not all three windows", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  assert.equal(p.dealsThisYear, 3);
});

t("keeps the five-year count the page headlines", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  assert.equal(p.dealsFiveYear, 39);
});

t("averages the five-year price the way the page does ($372.2K)", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  // ($8,420,319 + $6,095,985) / 39
  assert.equal(p.avgSalePrice, 372213);
});

t("also has the one-year average, for a like-for-like year with the volume", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  // ($195,000 + $659,000) / 3
  assert.equal(p.avgSalePriceOneYear, 284667);
});

t("counts the active listings", () => {
  const p = parseHomesProfile(FIXTURE, URL_);
  assert.ok(p);
  assert.equal(p.activeListings, 3);
});

t("falls back to the FAQ average when the panels are missing", () => {
  const html = FIXTURE.replace(/id="1-year-panel"/, 'id="gone-panel"').replace(/id="5-year-panel"/, 'id="also-gone"');
  const p = parseHomesProfile(html, URL_);
  assert.ok(p);
  assert.equal(p.dealsThisYear, null);
  assert.equal(p.avgSalePrice, 372200); // the FAQ's $372.2K
});

t("a page that is not a profile is rejected", () => {
  assert.equal(parseHomesProfile("<html><body>homes for sale</body></html>", URL_), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
