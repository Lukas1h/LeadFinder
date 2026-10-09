#!/usr/bin/env node
/**
 * Every Oregon "Coming Soon" listing on Compass, with the listing agent.
 *
 *   node scripts/compass-coming-soon.mjs           # readable list + summary
 *   node scripts/compass-coming-soon.mjs --json    # JSON array on stdout
 *
 * How it works (details in docs/compass-coming-soon.md):
 *   1. Search: POST https://www.compass.com/homes-for-sale/search/oregon/coming-soon/
 *      (then .../coming-soon/p-2/, p-3/ …, 41 per page). The path is the filter;
 *      the body only needs a searchResultId. This endpoint sits behind an AWS WAF
 *      JS challenge, so it needs an `aws-waf-token` cookie (plus a `fingerprint`
 *      cookie, which can be any UUID), which a real browser
 *      gets by loading any Compass search page. We get one with headless Chrome
 *      (puppeteer, already a devDependency) and cache it — the cookie lasts ~4 days.
 *      Set COMPASS_WAF_TOKEN to skip the browser.
 *   2. Detail: GET https://www.compass.com/listing/<id>/view — plain fetch, no
 *      cookie. window.__INITIAL_DATA__ has the agent (fullContacts), brokerage,
 *      every photo, status and dates.
 *
 * Read-only: no login, no forms. One request per second, backs off on 429.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const BASE = "https://www.compass.com";
const SEARCH_PATH = "/homes-for-sale/search/oregon/coming-soon/";
const PAGE_SIZE = 41; // Compass's fixed page size
const MIN_GAP_MS = 1000;
const TOKEN_CACHE = path.join(os.tmpdir(), "compass-waf-token.json");
const FINGERPRINT = crypto.randomUUID();

const asJson = process.argv.includes("--json");
const log = (...a) => console.error(...a);

// --- throttled fetch ------------------------------------------------------

let lastRequest = 0;
async function politeFetch(url, init = {}, attempt = 0) {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();

  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...init.headers },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
    log(`  ${res.status} on ${url} — backing off ${Math.round(backoff / 1000)}s`);
    await sleep(backoff);
    return politeFetch(url, init, attempt + 1);
  }
  return res;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- AWS WAF token --------------------------------------------------------

async function getWafToken({ fresh = false } = {}) {
  if (!fresh && process.env.COMPASS_WAF_TOKEN) return process.env.COMPASS_WAF_TOKEN;
  if (!fresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8"));
      if (cached.expires * 1000 > Date.now() + 60_000) return cached.value;
    } catch {}
  }

  log("Getting an AWS WAF token from headless Chrome…");
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(`${BASE}/homes-for-sale/oregon/coming-soon/`, { waitUntil: "networkidle2", timeout: 90_000 });
    for (let i = 0; i < 20; i++) {
      const cookie = (await page.cookies()).find((c) => c.name === "aws-waf-token");
      if (cookie) {
        fs.writeFileSync(TOKEN_CACHE, JSON.stringify({ value: cookie.value, expires: cookie.expires }));
        return cookie.value;
      }
      await sleep(1000);
    }
    throw new Error("Chrome loaded Compass but never got an aws-waf-token cookie");
  } finally {
    await browser.close();
  }
}

// --- search ---------------------------------------------------------------

async function searchPage(pageNum, token) {
  const url = `${BASE}${SEARCH_PATH}${pageNum > 1 ? `p-${pageNum}/` : ""}`;
  const res = await politeFetch(url, {
    method: "POST",
    // Compass's app also rejects searches without a `fingerprint` cookie
    // (403 "Empty fingerprint"); any UUID does.
    headers: { "content-type": "application/json", cookie: `aws-waf-token=${token}; fingerprint=${FINGERPRINT}` },
    body: JSON.stringify({ searchResultId: crypto.randomUUID() }),
  });
  // 202 + x-amzn-waf-action: challenge means the token is missing or expired.
  if (res.headers.get("x-amzn-waf-action")) return { challenged: true };
  if (!res.ok) throw new Error(`search ${url} → HTTP ${res.status}`);
  const data = await res.json();
  return { total: data.lolResults?.totalItems ?? 0, items: (data.lolResults?.data ?? []).map((d) => d.listing) };
}

async function searchAll() {
  let token = await getWafToken();
  const all = [];
  let total = Infinity;
  for (let p = 1; all.length < total; p++) {
    let result = await searchPage(p, token);
    if (result.challenged) {
      token = await getWafToken({ fresh: true });
      result = await searchPage(p, token);
      if (result.challenged) throw new Error("Compass WAF still challenging after a fresh token");
    }
    if (p === 1) total = result.total;
    log(`Search page ${p}: ${result.items.length} listings (total ${total})`);
    if (!result.items.length) break;
    all.push(...result.items);
    if (result.items.length < PAGE_SIZE) break;
  }
  const seen = new Set();
  return all.filter((l) => !seen.has(l.listingIdSHA) && seen.add(l.listingIdSHA));
}

// --- detail ---------------------------------------------------------------

function initialData(html) {
  const m = html.match(/window\.__INITIAL_DATA__ = (\{[\s\S]*?\});\s*\n/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Fallback when __INITIAL_DATA__ is missing: the JSON-LD offer's offeredBy Person. */
function ldAgent(html) {
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const m = json.match(/"offeredBy":(\{[^{}]*?"@type":"Person"[^{}]*?\})/);
    if (m) {
      try {
        const p = JSON.parse(m[1]);
        return { name: p.name ?? null, phone: p.telephone ?? null, email: p.email ?? null };
      } catch {}
    }
  }
  return null;
}

const isoDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

async function detail(summary) {
  const url = `${BASE}/listing/${summary.listingIdSHA}/view`;
  const res = await politeFetch(url);
  const html = res.ok ? await res.text() : "";
  const L = initialData(html)?.props?.listingRelation?.listing;

  const contact = L?.fullContacts?.find((c) => c.contactType === "Listing Agent") ?? L?.fullContacts?.[0];
  const ld = contact ? null : ldAgent(html);
  const photos = (L?.media ?? summary.media ?? []).filter((m) => m.category === 0 || m.category == null);
  const [street, cityPart] = (summary.subtitles?.[0] ?? "").split(", ");

  return {
    id: summary.listingIdSHA,
    address: L?.location?.prettyAddress ?? street ?? null,
    city: L?.location?.city ?? cityPart ?? null,
    zip: L?.location?.zipCode ?? null,
    price: L?.price?.lastKnown ?? (Number(summary.title?.replace(/[^\d]/g, "")) || null),
    status: L?.localizedStatus ?? summary.badges?.cornerBadges?.map((b) => b.displayText).join(", ") ?? null,
    seeItFirst: (summary.badges?.cornerBadges ?? []).some((b) => b.displayText === "See It First"),
    mlsSource: L?.databaseSource?.sourceDisplayName ?? null,
    agentName: contact?.contactName ?? ld?.name ?? null,
    agentPhone: contact?.mobile ?? contact?.phone ?? ld?.phone ?? null,
    agentEmail: contact?.email ?? ld?.email ?? null,
    brokerage: contact?.company ?? L?.dealInfo?.courtesyOf?.replace(/^Listing Courtesy of /, "") ?? null,
    photoCount: photos.length,
    photos: photos.slice(0, 3).map((m) => m.originalUrl),
    url: `${BASE}${L?.canonicalPageLink ?? L?.pageLink ?? summary.pageLink}`,
    // Coming Soon listings usually have no list date yet (Days on Market "-");
    // fall back to the date Compass last updated the record.
    listedDate: isoDate(L?.date?.listed),
    updatedDate: isoDate(L?.date?.updated),
    detailOk: Boolean(L),
  };
}

// --- main -----------------------------------------------------------------

const summaries = await searchAll();
log(`${summaries.length} Coming Soon listings in Oregon; fetching detail pages…`);

const listings = [];
for (const [i, s] of summaries.entries()) {
  try {
    listings.push(await detail(s));
  } catch (e) {
    log(`  detail failed for ${s.listingIdSHA}: ${e.message}`);
    listings.push({ id: s.listingIdSHA, url: `${BASE}${s.pageLink}`, detailOk: false });
  }
  if ((i + 1) % 10 === 0) log(`  ${i + 1}/${summaries.length}`);
}

if (asJson) {
  console.log(JSON.stringify(listings, null, 2));
} else {
  const money = (n) => (n ? `$${n.toLocaleString("en-US")}` : "price n/a");
  for (const l of listings) {
    console.log(`${l.address ?? "?"}, ${l.city ?? "?"} — ${money(l.price)}${l.seeItFirst ? "  [See It First]" : ""}`);
    console.log(`  Status:    ${l.status ?? "?"}${l.mlsSource ? ` (${l.mlsSource})` : ""}`);
    console.log(`  Agent:     ${l.agentName ?? "—"} | ${l.agentPhone ?? "—"} | ${l.agentEmail ?? "—"}`);
    console.log(`  Brokerage: ${l.brokerage ?? "—"}`);
    console.log(`  Photos:    ${l.photoCount ?? 0}${l.photos?.length ? `  ${l.photos.join("  ")}` : ""}`);
    console.log(`  Listed:    ${l.listedDate ?? `not yet (updated ${l.updatedDate ?? "?"})`}`);
    console.log(`  ${l.url}\n`);
  }
}

const n = listings.length;
const withAgent = listings.filter((l) => l.agentName).length;
const withEmail = listings.filter((l) => l.agentEmail).length;
const withPhotos = listings.filter((l) => l.photoCount > 0).length;
const fewPhotos = listings.filter((l) => l.photoCount > 0 && l.photoCount <= 3).length;
const sif = listings.filter((l) => l.seeItFirst).length;
log(
  `\n${n} listings · ${withAgent} with agent name · ${withEmail} with agent email · ` +
    `${withPhotos} with photos (${fewPhotos} have 1–3) · ${sif} "See It First" (Compass pre-MLS)`
);
