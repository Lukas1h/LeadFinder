// Shared CSV helpers for the v2 outreach pipeline.
//
// The queue writer in buildCensusQueue.mjs originally had a template-literal
// bug that dropped the closing quote on any field containing a comma, which
// silently corrupted every brokerage like "MORE Realty, Inc.". These helpers
// are the single place CSV is produced, so that class of bug has one home.
import fs from "fs";
import path from "path";

export const IN_DIR = "scrape/v2";
export const OUT_DIR = "scrape/v2";

/** Parse a single CSV line, honoring quoted fields and escaped quotes. */
export function parseCsvLine(line) {
  const out = [];
  let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** Parse a whole CSV file into an array of row objects keyed by header. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** Quote a field iff it contains a comma, quote, or newline. Doubles quotes. */
export function escField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write an array of row objects to CSV using `cols` as the field order. */
export function writeCsv(file, cols, rows) {
  const body = rows.map((r) => cols.map((c) => escField(r[c])).join(",")).join("\n");
  fs.writeFileSync(file, cols.join(",") + "\n" + body + "\n");
}

/** Read target-queue.csv into objects (preserving the fixed column order). */
export function readQueue() {
  const text = fs.readFileSync(path.join(IN_DIR, "target-queue.csv"), "utf8");
  return parseCsv(text);
}
