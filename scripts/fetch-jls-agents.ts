// Pulls all Oregon-based John L. Scott agents from their public JSON API
// (public-api.johnlscott.com) — no bot protection, no browser needed. The
// /brokers/tiles endpoint ignores its lat/lng params and just returns the
// full company-wide roster (2,988 agents); /offices does the same for
// offices. Filters to agents whose primary office is in Oregon, using only
// contact fields the agent has marked publicDisplay:true — same spirit as
// not touching a field a site itself doesn't show publicly.
//
// Usage:
//   npx tsx scripts/fetch-jls-agents.ts --out jls-or-agents.csv

import { writeFileSync } from "fs";

const API = "https://public-api.johnlscott.com";
const TARGET_STATE = "OR";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface Office {
  id: number;
  name: string;
  location?: { stateCode?: string; city?: string };
}

interface EmailEntry {
  email: string;
  publicDisplay: boolean;
}
interface PhoneEntry {
  number: string;
  publicDisplay: boolean;
}

interface BrokerProfile {
  id: number;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isDeleted: boolean;
  officeMembers: { isPrimaryOffice: boolean; office: { id: number; name: string } }[];
  emailAddresses: EmailEntry[];
  jlsEmailAddress: EmailEntry | null;
  primaryPhone: PhoneEntry | null;
  phones: PhoneEntry[];
  alias: string;
}

interface AgentRecord {
  name: string;
  email: string;
  phone: string;
  office: string;
  profileUrl: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

function bestPublicEmail(p: BrokerProfile): string {
  if (p.jlsEmailAddress?.publicDisplay && p.jlsEmailAddress.email) return p.jlsEmailAddress.email;
  const pub = p.emailAddresses.find((e) => e.publicDisplay && e.email);
  return pub?.email ?? "";
}

function bestPublicPhone(p: BrokerProfile): string {
  if (p.primaryPhone?.publicDisplay && p.primaryPhone.number) return p.primaryPhone.number;
  const pub = p.phones.find((ph) => ph.publicDisplay && ph.number);
  return pub?.number ?? "";
}

function toCsv(rows: AgentRecord[]): string {
  const headers: (keyof AgentRecord)[] = ["name", "email", "phone", "office", "profileUrl"];
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const outPath = outArg !== -1 ? args[outArg + 1] : "jls-or-agents.csv";

  console.log("Fetching offices...");
  const offices = await fetchJson<{ office: Office }[]>("/offices");
  const orOfficeIds = new Set(
    offices.filter((o) => o.office.location?.stateCode === TARGET_STATE).map((o) => o.office.id)
  );
  console.log(`${offices.length} offices total, ${orOfficeIds.size} in Oregon.`);

  console.log("Fetching brokers...");
  const brokers = await fetchJson<{ profile: BrokerProfile }[]>("/brokers/tiles");
  console.log(`${brokers.length} brokers company-wide.`);

  const seen = new Set<string>();
  const records: AgentRecord[] = [];
  for (const { profile: p } of brokers) {
    if (!p.isActive || p.isDeleted) continue;
    const primary = p.officeMembers.find((m) => m.isPrimaryOffice) ?? p.officeMembers[0];
    if (!primary || !orOfficeIds.has(primary.office.id)) continue;

    const email = bestPublicEmail(p);
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());

    const name = `${p.firstName} ${p.lastName}`.replace(/\s+/g, " ").trim();
    if (!name) continue;

    records.push({
      name,
      email: email.trim().toLowerCase(),
      phone: bestPublicPhone(p),
      office: primary.office.name,
      profileUrl: `https://www.johnlscott.com/agents/${p.alias}`,
    });
  }

  records.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(outPath, toCsv(records));
  console.log(`Wrote ${records.length} unique Oregon agents (with a public email) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
