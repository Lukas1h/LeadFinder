// Scrapes the Premiere Property Group agent directory for photography-lead
// outreach data, using a real (non-headless) browser since the site sits
// behind a Cloudflare challenge that plain HTTP requests can't pass.
//
// Usage:
//   npx tsx scripts/scrape-ppg-agents.ts --limit 5 --out sample.csv
//   npx tsx scripts/scrape-ppg-agents.ts --out ppg-agents-full.csv
//
// Walks /agents-sitemap/ -> every office EXCEPT "Premiere Property Group
// Commercial" -> each agent's profile page, and writes one row per agent.
// Requests run sequentially with a randomized delay between them (one
// browser tab, human-ish pacing) rather than hammering the site.
//
// Listing counts are read off the profile page, which shows at most the 3
// most recent Active / Pending / Sold listings per category, so counts are
// reported as "3+" once they hit that cap. "photography_priority" is a
// simple heuristic: HIGH if the agent currently has an active or pending
// listing (needs photos now), MEDIUM if they only show past sold listings
// (they sell homes, just nothing live right now), LOW if none of the three
// sections appear at all (license on file but no visible listing activity).

import puppeteer, { type Browser, type Page } from "puppeteer";
import { writeFileSync, readFileSync, existsSync } from "fs";

const BASE = "https://www.premierepropertygroup.com";
const EXCLUDED_OFFICE = "Premiere Property Group Commercial";
const MIN_DELAY_MS = 700;
const MAX_DELAY_MS = 1500;
const CDP_ENDPOINT = "http://localhost:9222";

interface AgentRef {
  name: string;
  url: string;
}

interface AgentRecord {
  name: string;
  office: string;
  email: string;
  phone: string;
  activeCount: string;
  pendingCount: string;
  soldCount: string;
  mostRecentSoldDate: string;
  photographyPriority: string;
  profileUrl: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function politeDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

// Cloudflare runs a fresh interactive check on some navigations (fast
// back-to-back page loads look non-human even in a real browser). When that
// happens the page title is "Just a moment..." — wait it out and retry
// rather than treating it as a hard failure.
async function gotoThroughChallenge(page: Page, url: string, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    // "domcontentloaded" rather than "networkidle2"/"load": the data we
    // need is in the server-rendered HTML (mailto/tel links, listing
    // sections), not something that streams in later — no need to wait for
    // this site's trackers/widgets/chat-plugin traffic (which can keep the
    // network busy indefinitely) or for blocked image/font/CSS requests.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    if (!/just a moment/i.test(title)) return;
    console.log(`    (Cloudflare check on attempt ${i + 1}, waiting...)`);
    await sleep(4000 + Math.random() * 3000);
  }
  throw new Error(`Stuck behind Cloudflare challenge after ${attempts} attempts: ${url}`);
}

async function getOfficeLinks(page: Page): Promise<{ name: string; url: string }[]> {
  await gotoThroughChallenge(page, `${BASE}/agents-sitemap/`);
  return page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("main a[href*='/agents-sitemap/agents-in-']")];
    return links.map((a) => ({
      name: a.textContent?.trim().replace(/^Agents in\s+/i, "") ?? "",
      url: a.href,
    }));
  });
}

async function getAgentLinksForOffice(page: Page, officeUrl: string): Promise<AgentRef[]> {
  await gotoThroughChallenge(page, officeUrl);
  return page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href*='/agent/']")];
    return links
      .map((a) => ({ name: a.textContent?.trim() ?? "", url: a.href }))
      .filter((r) => r.name && !/^client care\s*team$/i.test(r.name) && !/^kvcore test$/i.test(r.name));
  });
}

function countLabel(n: number): string {
  return n >= 3 ? "3+" : String(n);
}

function classifyPriority(hasActive: boolean, hasPending: boolean, hasSold: boolean): string {
  if (hasActive || hasPending) return "HIGH - currently listing";
  if (hasSold) return "MEDIUM - sells, nothing live right now";
  return "LOW - no listing activity shown, likely not practicing";
}

async function scrapeAgentProfile(page: Page, ref: AgentRef, office: string): Promise<AgentRecord> {
  await gotoThroughChallenge(page, ref.url);

  const data = await page.evaluate(() => {
    const email = (document.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')?.href ?? "").replace(/^mailto:/i, "");
    const phone = (document.querySelector<HTMLAnchorElement>('a[href^="tel:"]')?.href ?? "").replace(/^tel:/i, "");
    const mainText = document.querySelector("main")?.innerText ?? "";

    // Inlined (no nested function declarations): tsx/esbuild injects a
    // `__name` helper call around named functions for name-preservation,
    // and that helper doesn't exist once puppeteer ships this closure's
    // source into the page's own execution context.
    //
    // Count via the section's slice of rendered text rather than DOM
    // structure (the profile page's price markup doesn't consistently use
    // heading tags), splitting on whichever of the other section labels
    // comes next.
    const sectionLabels = ["Active Listings", "Pending Listings", "Sold Listings"];
    const sectionCounts: Record<string, number> = {};
    for (const label of sectionLabels) {
      const startIdx = mainText.indexOf(label);
      if (startIdx === -1) {
        sectionCounts[label] = 0;
        continue;
      }
      let endIdx = mainText.length;
      for (const other of sectionLabels) {
        if (other === label) continue;
        const otherIdx = mainText.indexOf(other, startIdx + label.length);
        if (otherIdx !== -1 && otherIdx < endIdx) endIdx = otherIdx;
      }
      const segment = mainText.slice(startIdx, endIdx);
      sectionCounts[label] = (segment.match(/\$[\d,]{4,}/g) ?? []).length;
    }

    const soldDates = [...document.querySelectorAll("main *")]
      .filter((el) => el.children.length === 0 && /^SOLD:/i.test(el.textContent?.trim() ?? ""))
      .map((el) => (el.textContent?.trim() ?? "").replace(/^SOLD:\s*/i, ""));

    return {
      email,
      phone,
      hasActive: /Active Listings/.test(mainText),
      hasPending: /Pending Listings/.test(mainText),
      hasSold: /Sold Listings/.test(mainText),
      activeCount: sectionCounts["Active Listings"],
      pendingCount: sectionCounts["Pending Listings"],
      soldCount: sectionCounts["Sold Listings"],
      soldDates,
    };
  });

  let mostRecent: Date | null = null;
  for (const d of data.soldDates) {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime()) && (!mostRecent || parsed > mostRecent)) mostRecent = parsed;
  }

  return {
    name: ref.name,
    office,
    email: data.email,
    phone: data.phone,
    activeCount: countLabel(data.activeCount),
    pendingCount: countLabel(data.pendingCount),
    soldCount: countLabel(data.soldCount),
    mostRecentSoldDate: mostRecent ? mostRecent.toISOString().slice(0, 10) : "",
    photographyPriority: classifyPriority(data.hasActive, data.hasPending, data.hasSold),
    profileUrl: ref.url,
  };
}

function toCsv(rows: AgentRecord[]): string {
  const headers = [
    "name",
    "office",
    "email",
    "phone",
    "activeCount",
    "pendingCount",
    "soldCount",
    "mostRecentSoldDate",
    "photographyPriority",
    "profileUrl",
  ] as const;
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

const CSV_HEADERS = [
  "name",
  "office",
  "email",
  "phone",
  "activeCount",
  "pendingCount",
  "soldCount",
  "mostRecentSoldDate",
  "photographyPriority",
  "profileUrl",
] as const;

// Parses a CSV written by toCsv above (every field double-quoted, "" escapes
// a literal quote) — used to resume a run without re-scraping already-done
// agents.
function parseCsv(text: string): AgentRecord[] {
  const rows: AgentRecord[] = [];
  const lineRe = /"((?:[^"]|"")*)"(?:,|$)/g;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines.slice(1)) {
    const values: string[] = [];
    let match;
    lineRe.lastIndex = 0;
    while ((match = lineRe.exec(line))) {
      values.push(match[1].replace(/""/g, '"'));
    }
    if (values.length !== CSV_HEADERS.length) continue;
    const record = {} as AgentRecord;
    CSV_HEADERS.forEach((h, i) => {
      (record as unknown as Record<string, string>)[h] = values[i];
    });
    rows.push(record);
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const outArg = args.indexOf("--out");
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : undefined;
  const outPath = outArg !== -1 ? args[outArg + 1] : "ppg-agents.csv";

  const browser: Browser = await puppeteer.connect({ browserURL: CDP_ENDPOINT });
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  // The data we need is all in the HTML/text — block the heavy stuff
  // (images, fonts, stylesheets, media) that "load" would otherwise wait
  // on. Scripts stay on: Cloudflare's own check needs to run.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    console.log("Fetching office list...");
    const offices = (await getOfficeLinks(page)).filter((o) => o.name !== EXCLUDED_OFFICE);
    console.log(`Found ${offices.length} residential/general offices (excluded "${EXCLUDED_OFFICE}").`);

    const seen = new Map<string, { ref: AgentRef; office: string }>();
    for (const office of offices) {
      if (limit && seen.size >= limit) break;
      await politeDelay();
      const agents = await getAgentLinksForOffice(page, office.url);
      for (const agent of agents) {
        if (!seen.has(agent.url)) seen.set(agent.url, { ref: agent, office: office.name });
      }
      console.log(`  ${office.name}: ${agents.length} agents (unique total so far: ${seen.size})`);
    }

    const existingRecords = existsSync(outPath) ? parseCsv(readFileSync(outPath, "utf-8")) : [];
    const alreadyDone = new Set(existingRecords.map((r) => r.profileUrl));
    if (existingRecords.length > 0) {
      console.log(`Resuming: ${existingRecords.length} agent(s) already scraped in ${outPath}, skipping those.`);
    }

    const targets = [...seen.values()].filter(({ ref }) => !alreadyDone.has(ref.url)).slice(0, limit);
    console.log(`Scraping ${targets.length} new agent profile(s) (${existingRecords.length} already done).`);

    const records: AgentRecord[] = [...existingRecords];
    const cdpSession = await page.createCDPSession();
    for (const [i, { ref, office }] of targets.entries()) {
      try {
        await politeDelay();
        const record = await scrapeAgentProfile(page, ref, office);
        records.push(record);
        console.log(`  [${i + 1}/${targets.length}] ${record.name} — ${record.email || "no email"} — ${record.photographyPriority}`);
      } catch (err) {
        console.error(`  [${i + 1}/${targets.length}] FAILED ${ref.name} (${ref.url}):`, err);
      }

      // Write incrementally (so a stop/crash doesn't lose progress and other
      // tooling can read partial results) and periodically clear the
      // profile's disk cache — left unbounded, ~1200 page loads' worth of
      // cached assets can add up to several hundred MB+ on a long run.
      if ((i + 1) % 10 === 0 || i === targets.length - 1) {
        writeFileSync(outPath, toCsv(records));
      }
      if ((i + 1) % 100 === 0) {
        await cdpSession.send("Network.clearBrowserCache");
        console.log(`    (cleared browser cache after ${i + 1} agents)`);
      }
    }

    writeFileSync(outPath, toCsv(records));
    console.log(`Wrote ${records.length} rows to ${outPath}`);
  } finally {
    // Disconnect only — this is a shared, persistent Chrome window
    // (connected via CDP), not one this script owns, so leave it open.
    browser.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
