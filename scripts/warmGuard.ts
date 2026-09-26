// Warm-agent guard: screen a candidate list against every agent we already
// have a relationship with, before anything is sent.
//
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/warmGuard.ts <file.csv|file.json> [--out out.json] [--show]
//
// Verdicts:
//   clear   — no known agent resembles this person; safe to send
//   review  — possibly the same person (weak name similarity, a lone initial,
//             an ambiguous short form); held for a human
//   block   — same email, same phone, or a confident name match; never send
//
// Only `clear` rows reach the output. Every held row is reported with the
// reason and the known agent it collided with, so the holds get worked through
// rather than trusted blindly — the fuzzy matcher is deliberately over-flagging,
// and that is only safe if a person looks at what it held.
//
// coldOutreachApiRunner.ts re-runs this same screen against the live DB before
// it sends, so a list cannot reach an inbox without passing through here first.

import fs from "fs";
import path from "path";
import { parseCsv } from "./lib/csv.mjs";
import { looksLikeOrg, norm, parseName } from "./lib/warmGuard.mjs";
import {
  loadProtected, prepareAll, screenCandidate, type Candidate, type Hold,
} from "./lib/warmGuardScreen";

/**
 * Make a name read well in `{{firstName}}`.
 *
 * Census exports carry names in shouting caps ("LISA LANG"), which would
 * render as "Hi LISA". Only fix a name that has NO lowercase in it at all —
 * anything already mixed-case ("McDonald", "O'Brien", "DeWitt") is left
 * completely alone, because a naive word-capitalize corrupts real names and
 * there's no way to tell a real mixed-case name from a broken one without a
 * name database. Suffixes stay uppercase.
 *
 * `csvFirstName`, when present, replaces only the FIRST WORD — it is a
 * separate column in these exports and is more reliable than re-deriving the
 * given name out of `name`, but it is a given name, not a whole name.
 */
function displayName(raw: string, csvFirstName?: string): string {
  const cap = (w: string) =>
    /^(i{1,3}|iv|v|vi|jr|sr)$/i.test(w)
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const fix = (s: string) => {
    const t = s.trim();
    if (!t) return t;
    if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return t; // already mixed case — leave it
    return t.split(/\s+/).map(cap).join(" ");
  };

  const full = fix(raw);
  const first = csvFirstName ? fix(csvFirstName.trim()) : "";
  if (!first) return full;
  // Splice the given name in front, but only when it isn't already the head of
  // the name. These exports carry compound given names — name="PEGGY LEE COMBS"
  // with firstName="PEGGY LEE" — and splicing unconditionally produced
  // "Peggy Lee Lee Combs", which is how a real agent got emailed by a name
  // that isn't theirs.
  const lowerFull = full.toLowerCase();
  if (lowerFull === first.toLowerCase()) return full;
  if (lowerFull.startsWith(first.toLowerCase() + " ")) return full;
  const words = full.split(/\s+/);
  return [first, ...words.slice(1)].join(" ");
}

/** Read candidates from a CSV or the JSON shape cleanExport writes. */
function readCandidates(file: string): Candidate[] {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : parsed.candidates;
    if (!Array.isArray(arr)) throw new Error(`${file}: no candidate array found`);
    return arr;
  }
  return parseCsv(text).map((r: any) => ({
    // Keep every original column — segment, tier, brokerage, source_url — so
    // downstream steps can still filter and audit. Dropping them here once cost
    // us the ability to confirm which template a row was meant to get.
    ...r,
    name: displayName(r.name || "", r.firstName),
    email: (r.email || "").trim(),
    phone: (r.phone || "").trim() || null,
    tier: r.tier ?? r.segment ?? "",
    score: Number(r.lead_score ?? r.score) || 0,
  }));
}


async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: warmGuard.ts <file.csv|file.json> [--out out.json] [--show]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const show = args.includes("--show");

  const protectedAgents = await loadProtected();
  const prepared = prepareAll(protectedAgents);
  console.error(`protected agents: ${protectedAgents.length} (non-cold, declined, contacted, booked, or interacted)`);

  const candidates = readCandidates(file);
  const counts = { block: 0, review: 0, orgName: 0, badEmail: 0, clear: 0, dupeInList: 0 };
  const held: Hold[] = [];
  const clear: Candidate[] = [];
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();

  for (const c of candidates) {
    const email = String(c.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { counts.badEmail++; continue; }
    if (seenEmails.has(email)) { counts.dupeInList++; continue; }
    seenEmails.add(email);
    const p = parseName(c.name);
    const nk = `${norm(p.normFirst)} ${norm(p.normLast)}`;
    if (nk.trim() && seenNames.has(nk)) { counts.dupeInList++; continue; }
    seenNames.add(nk);

    // A brokerage, an office, or a scraped page heading is not a person, and
    // {{firstName}} would render "Hi Our Brokers".
    const org = looksLikeOrg(c.name);
    if (org.org) {
      counts.orgName++;
      held.push({ ...c, verdict: "block", score: 100, tier: "org_name", why: `name reads as an organization: ${org.reason}` });
      continue;
    }

    const h = screenCandidate(c, prepared);
    if (h) {
      counts[h.verdict]++;
      held.push(h);
    } else {
      counts.clear++;
      clear.push(c);
    }
  }

  const tiers: Record<string, number> = {};
  for (const c of clear) {
    const t = String(c.tier || "-");
    tiers[t] = (tiers[t] ?? 0) + 1;
  }

  console.log(`\n${file}: ${candidates.length} candidates`);
  console.log(`  BLOCK — known agent, never send:   ${counts.block}`);
  console.log(`  REVIEW — possibly a known agent:   ${counts.review}`);
  console.log(`  BLOCK — name reads as a business:  ${counts.orgName}`);
  console.log(`  dropped — duplicate in this list:  ${counts.dupeInList}`);
  console.log(`  dropped — no valid email:          ${counts.badEmail}`);
  console.log(`  CLEAR — safe to send:              ${counts.clear}   tiers ${JSON.stringify(tiers)}`);
  const heldTotal = counts.block + counts.review + counts.orgName;
  console.log(`\n  ${counts.clear} of ${candidates.length} sendable; ${heldTotal} held for a human.`);
  if (heldTotal && counts.clear === 0) {
    console.log("  Nothing cleared — do not send this list as-is.");
  }

  if (show) {
    for (const h of [...held].sort((a, b) => b.score - a.score)) {
      console.log(`\n  [${h.verdict.toUpperCase()} ${h.score}] ${h.name} <${h.email}>`);
      console.log(`      ${h.why}`);
    }
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(clear, null, 2));
    const heldPath = outPath.replace(/\.json$/, "-held.json");
    fs.writeFileSync(heldPath, JSON.stringify(held, null, 2));
    console.log(`\nwrote ${clear.length} sendable -> ${outPath}`);
    console.log(`wrote ${held.length} held     -> ${heldPath}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
