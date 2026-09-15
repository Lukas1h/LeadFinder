// Pulls all Oregon-based Coldwell Banker agents. No bot protection, no
// browser needed: robots.txt names a state-organized agent sitemap
// (sitemap-agents-or-001.xml gives Oregon directly, no filtering needed),
// and each profile page is server-rendered with a direct mailto: link,
// tel: link, and a schema.org RealEstateAgent JSON-LD block.
//
// Usage:
//   npx tsx scripts/fetch-cb-agents.ts --out cb-or-agents.csv [--limit N]

import { writeFileSync } from "fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const OR_SITEMAP = "https://www.coldwellbanker.com/xml-sitemap/states/sitemap-agents-or-001.xml";
const DELAY_MS = 150;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  profileUrl: string;
}

function extractRecord(html: string, url: string): AgentRecord | null {
  const emailMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/);
  if (!emailMatch) return null;
  const telMatch = html.match(/tel:(\+?[0-9()+.\- ]+)"/);
  const nameMatch = html.match(/"@type":"RealEstateAgent","name":"([^"]+)"/);
  return {
    name: nameMatch ? nameMatch[1] : "",
    email: emailMatch[1].trim().toLowerCase(),
    phone: telMatch ? telMatch[1].trim() : "",
    profileUrl: url,
  };
}

function toCsv(rows: AgentRecord[]): string {
  const headers: (keyof AgentRecord)[] = ["name", "email", "phone", "profileUrl"];
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const limitArg = args.indexOf("--limit");
  const outPath = outArg !== -1 ? args[outArg + 1] : "cb-or-agents.csv";
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : undefined;

  console.log("Fetching Oregon agent sitemap...");
  const xml = await fetchText(OR_SITEMAP);
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  console.log(`${urls.length} Oregon agent URLs found.`);

  const targets = urls.slice(0, limit);
  const records: AgentRecord[] = [];
  for (const [i, url] of targets.entries()) {
    try {
      const html = await fetchText(url);
      const record = extractRecord(html, url);
      if (record) {
        records.push(record);
        if ((i + 1) % 25 === 0 || i === targets.length - 1) console.log(`  [${i + 1}/${targets.length}] ${record.name} — ${record.email}`);
      } else {
        console.log(`  [${i + 1}/${targets.length}] no email found, skipping (${url})`);
      }
    } catch (err) {
      console.error(`  [${i + 1}/${targets.length}] FAILED (${url}):`, err);
    }
    if ((i + 1) % 20 === 0) writeFileSync(outPath, toCsv(records));
    await sleep(DELAY_MS);
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
