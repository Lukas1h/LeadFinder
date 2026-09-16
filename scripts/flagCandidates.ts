// Cross-checks a candidate list against every existing agent in the
// database for near-duplicate PEOPLE, not just exact email matches — the
// API's own skip logic already handles an exact email match, but it can't
// catch the same real person showing up under a *different* email (e.g. a
// personal gmail on one brokerage list, a work @brokerage.com on another —
// see Jesse Dansereau / Daniell Kennedy from the Windermere run, caught only
// because they happened to reuse an old email).
//
// Flags a candidate when either:
//   - their phone number exactly matches an existing agent with a different email
//   - their name is a close fuzzy match to an existing agent with a different email
//
// Usage: CANDIDATES_MODULE=./coldwellBankerCandidates npx tsx scripts/flagCandidates.ts
import { db } from "../src/db";
import { agents } from "../src/db/schema";
import fs from "fs";

interface Candidate {
  name: string;
  email: string;
  phone: string | null;
}

const NAME_SIMILARITY_THRESHOLD = 0.87;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Returns normalized variants of a name: the plain normalized form, and —
// when the name has a quoted nickname ('Jose "Joe" Arechiga') — a second
// variant with the nickname substituted in for the given name.
function normalizeVariants(raw: string): string[] {
  const variants = [raw];
  const nicknameMatch = raw.match(/^(.+?)\s*"([^"]+)"\s*(.*)$/);
  if (nicknameMatch) {
    const [, before, nickname, after] = nicknameMatch;
    variants.push(`${before} ${after}`.trim()); // nickname stripped out entirely
    variants.push(`${nickname} ${after}`.trim()); // nickname used as first name
  }
  return variants.map((v) =>
    v
      .toLowerCase()
      .replace(/["'.,]/g, "")
      .split(/\s+/)
      .filter((tok) => tok && !SUFFIXES.has(tok))
      .join(" ")
      .trim()
  );
}

function nameSimilarity(a: string, b: string): number {
  const variantsA = normalizeVariants(a);
  const variantsB = normalizeVariants(b);
  let best = 0;
  for (const va of variantsA) {
    for (const vb of variantsB) {
      best = Math.max(best, similarity(va, vb));
    }
  }
  return best;
}

interface Flag {
  candidate: Candidate;
  reason: "phone" | "name";
  matchedAgent: { name: string | null; email: string; phone: string | null };
  score?: number;
}

async function main() {
  const candidatesModule = process.env.CANDIDATES_MODULE;
  if (!candidatesModule) {
    console.error("CANDIDATES_MODULE must be set");
    process.exit(1);
  }
  const { candidates }: { candidates: Candidate[] } = await import(candidatesModule);

  const existingRows = await db.select({ name: agents.name, email: agents.email, phone: agents.phone }).from(agents);
  const existing = existingRows.filter((e): e is { name: string | null; email: string; phone: string | null } => !!e.email);
  const byPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone, e]));

  const flags: Flag[] = [];

  for (const c of candidates) {
    const email = c.email.trim().toLowerCase();

    if (c.phone) {
      const phoneMatch = byPhone.get(c.phone);
      if (phoneMatch && phoneMatch.email !== email) {
        flags.push({ candidate: c, reason: "phone", matchedAgent: phoneMatch });
        continue;
      }
    }

    let bestScore = 0;
    let bestMatch: (typeof existing)[number] | null = null;
    for (const e of existing) {
      if (e.email === email) continue; // exact email match — the API's own skip logic handles this
      if (!e.name) continue;
      const score = nameSimilarity(c.name, e.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = e;
      }
    }
    if (bestMatch && bestScore >= NAME_SIMILARITY_THRESHOLD) {
      flags.push({ candidate: c, reason: "name", matchedAgent: bestMatch, score: bestScore });
    }
  }

  console.log(`${candidatesModule}: ${candidates.length} candidates, ${existing.length} existing agents in DB`);
  console.log(`${flags.length} flagged for manual verification:\n`);
  for (const f of flags) {
    if (f.reason === "phone") {
      console.log(
        `PHONE MATCH  "${f.candidate.name}" <${f.candidate.email}> phone ${f.candidate.phone}  ==  existing "${f.matchedAgent.name}" <${f.matchedAgent.email}>`
      );
    } else {
      console.log(
        `NAME MATCH (${(f.score! * 100).toFixed(0)}%)  "${f.candidate.name}" <${f.candidate.email}>  ~=  existing "${f.matchedAgent.name}" <${f.matchedAgent.email}>`
      );
    }
  }

  const flaggedEmails = flags.map((f) => f.candidate.email.trim().toLowerCase());
  const outDir = process.env.FLAGGED_OUT_DIR || ".";
  const outPath = `${outDir}/flagged-${candidatesModule.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ flaggedEmails, flags }, null, 2));
  console.log(`\nClean to send: ${candidates.length - flags.length} of ${candidates.length}`);
  console.log(`Flagged emails + details written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL", err);
    process.exit(1);
  });
