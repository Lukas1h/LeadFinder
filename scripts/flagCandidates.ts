import fs from "fs";
import { db } from "../src/db";
import { agents } from "../src/db/schema";

interface Candidate {
  name: string;
  email: string;
  phone: string | null;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

function isSimilar(name1: string, name2: string, threshold = 0.2): boolean {
  const norm1 = normalizeForMatch(name1);
  const norm2 = normalizeForMatch(name2);
  const distance = levenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const similarity = 1 - distance / maxLen;
  return similarity >= 1 - threshold;
}

async function main() {
  let candidatesModule = process.argv[2] || "./coldOutreachCandidates";
  if (!candidatesModule.startsWith(".") && !candidatesModule.startsWith("/")) {
    candidatesModule = "./" + candidatesModule;
  }
  const { candidates } = await import(candidatesModule);

  const allAgents = await db.select().from(agents);
  const agentEmails = new Set(allAgents.map((a) => a.email?.toLowerCase()).filter(Boolean));
  const agentPhones = new Set(
    allAgents
      .filter((a) => a.phone)
      .map((a) => a.phone!.toLowerCase().replace(/\D/g, ""))
      .filter(Boolean)
  );
  // filter(Boolean) doesn't narrow (string | null)[] to string[] — isSimilar
  // takes a string, so the build fails on it. A type predicate does narrow.
  const agentNames = allAgents.map((a) => a.name).filter((n): n is string => !!n);

  const flagged: { email: string; reason: string }[] = [];

  for (const candidate of candidates) {
    const candEmail = candidate.email.toLowerCase();
    const candPhone = candidate.phone?.toLowerCase().replace(/\D/g, "");
    const candName = candidate.name;

    // Exact email match
    if (agentEmails.has(candEmail)) {
      flagged.push({ email: candEmail, reason: "exact email match" });
      continue;
    }

    // Exact phone match (if phone provided)
    if (candPhone && agentPhones.has(candPhone)) {
      flagged.push({ email: candEmail, reason: "exact phone match" });
      continue;
    }

    // Fuzzy name match
    let fuzzyNameMatch = false;
    for (const agentName of agentNames) {
      if (isSimilar(candName, agentName, 0.15)) {
        fuzzyNameMatch = true;
        break;
      }
    }

    if (fuzzyNameMatch) {
      flagged.push({ email: candEmail, reason: "fuzzy name match" });
      continue;
    }
  }

  const flaggedEmails = flagged.map((f) => f.email);
  const report = { flaggedEmails, flaggedDetails: flagged };

  const reportPath = `/tmp/flagged-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Found ${flagged.length} flagged candidates out of ${candidates.length}`);
  console.log(`Flagged report written to ${reportPath}`);

  if (flagged.length > 0) {
    console.log("\nFlagged candidates:");
    flagged.slice(0, 20).forEach((f) => console.log(`  ${f.email} — ${f.reason}`));
    if (flagged.length > 20) console.log(`  ... and ${flagged.length - 20} more`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
