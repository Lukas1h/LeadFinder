// Turns exports/*.csv into send-ready candidate lists: drops anyone already
// emailed (by email, phone, or first+last name), collapses the same person
// listed under several emails, holds out rows whose "name" is a brokerage,
// and title-cases SHOUTING names so {{firstName}} renders as "Aaliyah".
//
// Usage: node --env-file=.env.local ./node_modules/.bin/tsx scripts/cleanExport.ts
import fs from "fs";
import { db } from "../src/db";
import { agents } from "../src/db/schema";
import { normalizeEmail, normalizeName, normalizePhone } from "../src/lib/normalize";

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const BUSINESS_NAME = /\b(realty|real estate|real broker|brokers|group|team|properties|property management|homes|collective|our brokers|coldwell banker|statement|llc|inc|construction|essentials|thinking|radio|pmi)\b/i;

// Scraped page headings that are really one agent's name.
const NAME_FIXES: Record<string, string> = { "Why Clients Choose Cindy": "Cindy" };

// First + last word, lowercase letters only — "KENNETH R. TERHAAR II" and
// "Kenneth Terhaar" both key to "kenneth terhaar" (suffix dropped first).
function personKey(name: string): string {
  const words = name.toLowerCase().replace(/"[^"]*"/g, " ").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 2 && /^(i{1,3}|iv|jr|sr)$/.test(words[words.length - 1])) words.pop();
  return words.length > 1 ? `${words[0]} ${words[words.length - 1]}` : words.join(" ");
}

function displayName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return normalizeName(NAME_FIXES[cleaned] ?? cleaned).replace(/\b(Ii|Iii|Iv)$/, (s) => s.toUpperCase());
}

interface Candidate { name: string; email: string; phone: string | null; tier: string; score: number; brokerage: string; city: string }

async function main() {
  const all = await db.select({ name: agents.name, email: agents.email, phone: agents.phone, contacted: agents.lastContactedAt }).from(agents);
  const contacted = all.filter((a) => a.contacted);
  const byEmail = new Set(contacted.filter((a) => a.email).map((a) => normalizeEmail(a.email!)));
  const byName = new Set(contacted.filter((a) => a.name).map((a) => personKey(a.name!)));
  const byPhone = new Map(contacted.filter((a) => a.phone).map((a) => [normalizePhone(a.phone!), a.name ?? ""]));

  const report: string[] = [];
  const claimed = new Set<string>(); // person keys already placed in an earlier list

  function clean(file: string, label: string): { send: Candidate[]; held: Row[] } {
    const rows = parseCsv(fs.readFileSync(file, "utf8"));
    const counts = { alreadyEmailed: 0, sameNameEmailed: 0, samePhoneSameName: 0, businessName: 0, badEmail: 0, dupPerson: 0, claimedByEarlierList: 0 };
    const held: Row[] = [];
    const best = new Map<string, Candidate>();

    for (const r of rows) {
      const email = normalizeEmail(r.email || "");
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { counts.badEmail++; continue; }
      if (!NAME_FIXES[r.name] && BUSINESS_NAME.test(r.name)) { counts.businessName++; held.push(r); continue; }
      const key = personKey(r.name);
      const phone = r.phone ? normalizePhone(r.phone) : "";
      if (byEmail.has(email)) { counts.alreadyEmailed++; continue; }
      if (byName.has(key)) { counts.sameNameEmailed++; continue; }
      // A phone hit only counts as the same person when the names agree too —
      // brokerages often list one office line for every agent.
      if (phone && byPhone.has(phone) && personKey(byPhone.get(phone)!) === key) { counts.samePhoneSameName++; continue; }
      if (claimed.has(key)) { counts.claimedByEarlierList++; continue; }

      const cand: Candidate = {
        name: displayName(r.name),
        email,
        phone: r.phone || null,
        tier: r.tier || "",
        score: Number(r.lead_score) || 0,
        brokerage: r.brokerage,
        city: r.city,
      };
      const prev = best.get(key);
      if (prev) {
        counts.dupPerson++;
        if (cand.score > prev.score) best.set(key, cand);
      } else best.set(key, cand);
    }

    for (const k of best.keys()) claimed.add(k);
    const send = [...best.values()].sort((a, b) => b.score - a.score);
    const tiers: Record<string, number> = {};
    for (const c of send) tiers[c.tier || "-"] = (tiers[c.tier || "-"] ?? 0) + 1;
    report.push(`${label}: ${rows.length} rows -> ${send.length} to send ${JSON.stringify(tiers)}; removed ${JSON.stringify(counts)}`);
    return { send, held };
  }

  // Luxury first so a person on both lists gets the luxury email, not both.
  const luxury = clean("exports/luxury-video-realtors.csv", "luxury");
  const oregon = clean("exports/oregon-agents.csv", "oregon");

  fs.mkdirSync("exports/clean", { recursive: true });
  fs.writeFileSync("exports/clean/luxury-send.json", JSON.stringify(luxury.send, null, 2));
  fs.writeFileSync("exports/clean/oregon-send.json", JSON.stringify(oregon.send, null, 2));
  fs.writeFileSync("exports/clean/held-business-name.json", JSON.stringify([...luxury.held, ...oregon.held], null, 2));
  console.log(report.join("\n"));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
