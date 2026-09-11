/** Lowercase, strip punctuation, collapse whitespace — for name comparison only, never stored. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Similarity in [0, 1] between two realtor names — used to suggest merging
 * a cold-emailed realtor into an existing agent record instead of creating
 * a duplicate. Small (personal-scale) dataset, so an in-memory scorer
 * against every agent name is fine — no DB fuzzy-search extension needed.
 */
export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = normA.split(" ");
  const tokensB = normB.split(" ");
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  if (shorter.length > 0 && shorter.every((t) => longer.includes(t))) return 0.9;

  const distance = levenshtein(normA, normB);
  return 1 - distance / Math.max(normA.length, normB.length);
}

/** A candidate at or above this is surfaced as a possible match — tune after real use. */
export const FUZZY_MATCH_THRESHOLD = 0.82;
