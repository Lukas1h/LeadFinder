// Usage: node --env-file=.env.local ./node_modules/.bin/tsx scripts/checkExportOverlap.ts exports/oregon-agents.csv [...]
import fs from "fs";
import { db } from "../src/db";
import { agents } from "../src/db/schema";
import { normalizeEmail, normalizePhone } from "../src/lib/normalize";

function parseCsv(text: string): Record<string, string>[] {
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
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function main() {
  const all = await db.select({ name: agents.name, email: agents.email, phone: agents.phone, contacted: agents.lastContactedAt }).from(agents);
  const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean).filter((w, i, a) => i === 0 || i === a.length - 1).join(" ");
  const contactedNames = new Set(all.filter((a) => a.contacted && a.name).map((a) => nameKey(a.name!)));
  const contactedEmails = new Set(all.filter((a) => a.contacted && a.email).map((a) => normalizeEmail(a.email!)));
  const knownEmails = new Set(all.filter((a) => a.email).map((a) => normalizeEmail(a.email!)));
  const contactedPhones = new Set(all.filter((a) => a.contacted && a.phone).map((a) => normalizePhone(a.phone!)));

  for (const file of process.argv.slice(2)) {
    const rows = parseCsv(fs.readFileSync(file, "utf8"));
    const seen = new Set<string>();
    const buckets = { contactedEmail: [] as any[], contactedPhone: [] as any[], contactedName: [] as any[], known: [] as any[], dupInFile: [] as any[], fresh: [] as any[] };
    for (const r of rows) {
      const email = r.email ? normalizeEmail(r.email) : "";
      const phone = r.phone ? normalizePhone(r.phone) : "";
      if (!email) continue;
      if (seen.has(email)) { buckets.dupInFile.push(r); continue; }
      seen.add(email);
      if (contactedEmails.has(email)) buckets.contactedEmail.push(r);
      else if (phone && contactedPhones.has(phone)) buckets.contactedPhone.push(r);
      else if (contactedNames.has(nameKey(r.name))) buckets.contactedName.push(r)
      else if (knownEmails.has(email)) buckets.known.push(r);
      else buckets.fresh.push(r);
    }
    const tiers: Record<string, number> = {};
    for (const r of buckets.fresh) tiers[r.tier || "-"] = (tiers[r.tier || "-"] ?? 0) + 1;
    console.log(`\n${file}: ${rows.length} rows`);
    console.log(`  already emailed (same email):        ${buckets.contactedEmail.length}`);
    console.log(`  new email, but phone already emailed: ${buckets.contactedPhone.length}`);
    console.log(`  new email, same name already emailed: ${buckets.contactedName.length}`);
    if (process.env.SHOW) for (const r of buckets.contactedName) console.log(`    SAME-NAME ${r.name} <${r.email}>`);
    console.log(`  in DB, never contacted:               ${buckets.known.length}`);
    console.log(`  duplicate email within file:          ${buckets.dupInFile.length}`);
    console.log(`  brand new:                            ${buckets.fresh.length}  tiers ${JSON.stringify(tiers)}`);
    if (process.env.SHOW) for (const r of [...buckets.fresh, ...buckets.known]) console.log(`    NEW ${r.name} <${r.email}> ${r.tier ?? ""} ${r.segment ?? ""}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
