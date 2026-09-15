// Pulls all Oregon-based RE/MAX agents. Enumeration is easy (no browser
// needed): robots.txt names a public agent sitemap
// (remax.com/agents-index.xml) whose URLs end in "-<city>-<state>/<id>",
// so Oregon agents are identifiable directly from the sitemap text. But
// the individual profile pages sit behind AWS WAF (x-amzn-waf-action:
// challenge, empty body) on a fresh/uncached hit — a real browser gets a
// blank page on the first load and a full page on retry, same shape as
// PPG's Cloudflare challenge, so this reuses that pattern: a real
// (non-headless) browser connected via CDP, retrying blank loads. Each
// resolved page has a schema.org RealEstateAgent JSON-LD block with
// name/email/telephone/address.
//
// Usage:
//   npx tsx scripts/fetch-remax-agents.ts --out remax-or-agents.csv [--limit N]

import puppeteer, { type Browser, type Page } from "puppeteer";
import { writeFileSync, readFileSync, existsSync } from "fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SITEMAP_INDEX = "https://www.remax.com/agents-index.xml";
const OR_URL_RE = /https:\/\/www\.remax\.com\/real-estate-agents\/[a-z0-9-]+-or\/[0-9]+/g;
const CDP_ENDPOINT = "http://localhost:9222";
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function politeDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

interface AgentRecord {
  name: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  profileUrl: string;
}

const CSV_HEADERS: (keyof AgentRecord)[] = ["name", "email", "phone", "city", "address", "profileUrl"];

function parseCsv(text: string): AgentRecord[] {
  const rows: AgentRecord[] = [];
  const lineRe = /"((?:[^"]|"")*)"(?:,|$)/g;
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const values: string[] = [];
    let m;
    lineRe.lastIndex = 0;
    while ((m = lineRe.exec(line))) values.push(m[1].replace(/""/g, '"'));
    if (values.length !== CSV_HEADERS.length) continue;
    const rec = {} as AgentRecord;
    CSV_HEADERS.forEach((h, i) => ((rec as Record<string, string>)[h] = values[i]));
    rows.push(rec);
  }
  return rows;
}

function toCsv(rows: AgentRecord[]): string {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [CSV_HEADERS.join(","), ...rows.map((r) => CSV_HEADERS.map((h) => escape(r[h])).join(","))].join("\n");
}

async function getOregonUrls(): Promise<string[]> {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const subSitemaps = [...indexXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const orUrls = new Set<string>();
  for (const sm of subSitemaps) {
    const xml = await fetchText(sm);
    for (const m of xml.matchAll(OR_URL_RE)) orUrls.add(m[0]);
  }
  return [...orUrls];
}

async function scrapeProfile(page: Page, url: string, attempts = 3): Promise<AgentRecord | null> {
  for (let i = 0; i < attempts; i++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const data = await page.evaluate(() => {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(s.textContent ?? "");
          const obj = Array.isArray(parsed) ? parsed[0] : parsed;
          if (obj && obj["@type"] === "RealEstateAgent") return obj;
        } catch {
          // try next block
        }
      }
      return null;
    });
    if (data) {
      const address = (data.address ?? {}) as Record<string, string>;
      return {
        name: (data.name as string) ?? "",
        email: ((data.email as string) ?? "").trim().toLowerCase(),
        phone: (data.telephone as string) ?? "",
        city: address.addressLocality ?? "",
        address: [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
          .filter(Boolean)
          .join(", "),
        profileUrl: url,
      };
    }
    // Blank (WAF-challenged) page — wait it out and retry.
    await sleep(2500 + Math.random() * 1500);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const limitArg = args.indexOf("--limit");
  const outPath = outArg !== -1 ? args[outArg + 1] : "remax-or-agents.csv";
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : undefined;

  console.log("Fetching sitemap...");
  const orUrls = await getOregonUrls();
  console.log(`${orUrls.length} Oregon agent URLs found.`);

  const existing = existsSync(outPath) ? parseCsv(readFileSync(outPath, "utf-8")) : [];
  const alreadyDone = new Set(existing.map((r) => r.profileUrl));
  const targets = orUrls.filter((u) => !alreadyDone.has(u)).slice(0, limit);
  console.log(`Scraping ${targets.length} new profile(s) (${existing.length} already done).`);

  const browser: Browser = await puppeteer.connect({ browserURL: CDP_ENDPOINT });
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  const records: AgentRecord[] = [...existing];
  try {
    for (const [i, url] of targets.entries()) {
      try {
        await politeDelay();
        const record = await scrapeProfile(page, url);
        if (record && record.email) {
          records.push(record);
          console.log(`  [${i + 1}/${targets.length}] ${record.name} — ${record.email}`);
        } else {
          console.log(`  [${i + 1}/${targets.length}] no data after retries, skipping (${url})`);
        }
      } catch (err) {
        console.error(`  [${i + 1}/${targets.length}] FAILED (${url}):`, err);
      }
      if ((i + 1) % 10 === 0 || i === targets.length - 1) writeFileSync(outPath, toCsv(records));
    }
  } finally {
    browser.disconnect();
  }

  const seen = new Set<string>();
  const deduped = records.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));
  deduped.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(outPath, toCsv(deduped));
  console.log(`Wrote ${deduped.length} unique Oregon agents to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
