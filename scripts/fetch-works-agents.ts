// Pulls the Works Real Estate (Portland) agent roster. Their Squarespace
// /agent-page renders every agent server-side as a summary block: name link,
// then title / "Phone: ..." / "Email: <mailto>" in the excerpt. One plain
// HTTP request, no bot protection. Their robots.txt is Squarespace's stock
// file (AI bots grouped with * under generic /config,/search,/api rules) and
// doesn't exclude this page.
//
// Usage:
//   npx tsx scripts/fetch-works-agents.ts --out works-agents.csv

import { writeFileSync } from "fs";

const URL_ = "https://portlandworksrealestate.co/agent-page";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface AgentRecord {
  name: string;
  email: string;
  phone: string;
  title: string;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const outPath = outArg !== -1 ? args[outArg + 1] : "works-agents.csv";

  const res = await fetch(URL_, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${URL_} -> ${res.status}`);
  const html = await res.text();

  const blocks = html.split('class="summary-title-link"').slice(1);
  const seen = new Set<string>();
  const records: AgentRecord[] = [];
  for (const b of blocks) {
    const name = decode((b.match(/>\s*([^<]+?)\s*<\/a>/) ?? [])[1] ?? "");
    const email = ((b.match(/mailto:([^"?]+)"/) ?? [])[1] ?? "").trim().toLowerCase();
    if (!name || !/^[^@\s'+]+@[^@\s'+]+\.[a-z]{2,}$/i.test(email) || seen.has(email)) continue;
    seen.add(email);
    const excerpt = (b.match(/summary-excerpt[^>]*>([\s\S]*?)<div class="summary-m/) ?? [])[1] ?? "";
    const paras = [...excerpt.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")));
    const phone = (paras.find((p) => /^Phone:/i.test(p)) ?? "").replace(/^Phone:\s*/i, "");
    const title = paras.find((p) => !/^(Phone|Email):/i.test(p)) ?? "";
    records.push({ name, email, phone, title });
  }
  records.sort((a, b) => a.name.localeCompare(b.name));

  const headers: (keyof AgentRecord)[] = ["name", "email", "phone", "title"];
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  writeFileSync(outPath, [headers.join(","), ...records.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n"));
  console.log(`${blocks.length} agent blocks, wrote ${records.length} unique agents with emails to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
