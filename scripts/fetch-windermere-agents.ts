// Pulls all Oregon-based Windermere agents from the public JSON API their
// own "Find an Agent" search widget uses (services/agent_lookup_proxy) —
// no bot protection, no browser needed, just paginated HTTP + JSON.
//
// Usage:
//   npx tsx scripts/fetch-windermere-agents.ts --out windermere-or-agents.csv

import { writeFileSync } from "fs";

const BASE = "https://www.windermere.com/services/agent_lookup_proxy/1234567";
const COMMON_PARAMS =
  "order_by=firstname,lastname&site_owner_uuid=325ffe30-18ce-4f9c-973a-5fad2d88ca3f&site_type=Brokerage%20Website&from_app=aws%3Ahttps%3A%2F%2Fwww.windermere.com";
const PAGE_SIZE = 500;
const TARGET_STATE = "OR";

interface RawAgent {
  display_name: string;
  firstname: string;
  lastname: string;
  email: string;
  mainphone: string | null;
  cellphone: string | null;
  alt_phone: string | null;
  url_slug: string;
  office: {
    name: string;
    phone: string;
    email: string;
    location: { city: string; state: string; zip: string };
  };
}

interface AgentRecord {
  name: string;
  email: string;
  phone: string;
  office: string;
  officeCity: string;
  officeZip: string;
  profileUrl: string;
}

async function fetchAllAgents(): Promise<RawAgent[]> {
  const all: RawAgent[] = [];
  let startidx = 0;
  while (true) {
    const url = `${BASE}?pgsize=${PAGE_SIZE}&startidx=${startidx}&${COMMON_PARAMS}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const json = await res.json();
    const results: RawAgent[] = json.data.result_list;
    const total: number = json.data.number_available;
    all.push(...results);
    startidx += PAGE_SIZE;
    console.log(`  fetched ${all.length}/${total}`);
    if (startidx >= total || results.length === 0) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return all;
}

function bestPhone(a: RawAgent): string {
  return a.cellphone || a.mainphone || a.alt_phone || a.office?.phone || "";
}

function toCsv(rows: AgentRecord[]): string {
  const headers: (keyof AgentRecord)[] = ["name", "email", "phone", "office", "officeCity", "officeZip", "profileUrl"];
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const outPath = outArg !== -1 ? args[outArg + 1] : "windermere-or-agents.csv";

  console.log("Fetching all Windermere agents...");
  const all = await fetchAllAgents();
  console.log(`Fetched ${all.length} agents company-wide.`);

  const seen = new Set<string>();
  const records: AgentRecord[] = [];
  for (const a of all) {
    if (a.office?.location?.state !== TARGET_STATE) continue;
    if (!a.email || seen.has(a.email.toLowerCase())) continue;
    seen.add(a.email.toLowerCase());
    const name = a.display_name?.trim() || `${a.firstname} ${a.lastname}`.trim();
    if (!name) continue;
    records.push({
      name,
      email: a.email.trim().toLowerCase(),
      phone: bestPhone(a),
      office: a.office?.name ?? "",
      officeCity: a.office?.location?.city ?? "",
      officeZip: a.office?.location?.zip ?? "",
      profileUrl: `https://www.windermere.com/directory/agents/${a.url_slug}`,
    });
  }

  records.sort((x, y) => x.name.localeCompare(y.name));
  writeFileSync(outPath, toCsv(records));
  console.log(`Wrote ${records.length} unique Oregon agents to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
