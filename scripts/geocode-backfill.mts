/**
 * Backfill listings/bookings map coordinates through the free US Census
 * batch geocoder, falling back to OpenStreetMap Nominatim one address at a
 * time for anything Census can't match.
 *
 *   npx tsx --env-file=.env.local scripts/geocode-backfill.mts [--limit N] [--only listings|bookings] [--no-osm] [--write] [--from-csv file]
 *
 * Default is a dry run: it geocodes, writes exports/geocode/backfill-<ts>.csv
 * and prints a summary, but touches no rows. Rows are written to the CSV as
 * they are geocoded, so a crash or Ctrl-C keeps the work already done. Only
 * --write actually sets lat/lng/geocoded_at/geocode_source; re-running
 * --write --from-csv <file> applies a previous dry run's CSV without calling
 * either geocoder again.
 *
 * A row Census/Nominatim couldn't place still gets geocoded_at = now with
 * lat/lng null, so it isn't retried forever (the schema treats that as
 * "looked up, no match"). Listings with a Zillow-style parenthetical note in
 * the street ("(photos coming soon)") have the note stripped first.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";

type TableName = "listings" | "bookings";
type Status = "census_exact" | "census_nonexact" | "osm" | "none";

interface SourceRow {
  id: string;
  table: TableName;
  address: string;
  city: string;
  state: string;
  zipcode: string;
}

interface ResultRow extends SourceRow {
  status: Status;
  lat: number | null;
  lng: number | null;
  matchedAddress: string;
}

const CENSUS_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "LeadFinder/1.0 (Hahn Media geocode backfill)";
const CENSUS_CHUNK = 2_000;
const CENSUS_TIMEOUT_MS = 5 * 60 * 1_000;
const OSM_DELAY_MS = 1_100;
const DEFAULT_STATE = "OR";
const UPDATE_CHUNK = 500;
const EXPORT_DIR = "exports/geocode";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  limit: number | null;
  only: TableName | null;
  noOsm: boolean;
  write: boolean;
  fromCsv: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: null,
    only: null,
    noOsm: false,
    write: false,
    fromCsv: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--limit": {
        const value = argv[++i];
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--limit needs a positive integer, got ${value ?? "(nothing)"}`);
        }
        args.limit = n;
        break;
      }
      case "--only": {
        const value = argv[++i];
        if (value !== "listings" && value !== "bookings") {
          throw new Error(`--only needs listings or bookings, got ${value ?? "(nothing)"}`);
        }
        args.only = value;
        break;
      }
      case "--no-osm":
        args.noOsm = true;
        break;
      case "--write":
        args.write = true;
        break;
      case "--from-csv": {
        const value = argv[++i];
        if (!value) throw new Error("--from-csv needs a file path");
        args.fromCsv = value;
        break;
      }
      case "--help":
      case "-h":
        console.log(
          "npx tsx --env-file=.env.local scripts/geocode-backfill.mts " +
            "[--limit N] [--only listings|bookings] [--no-osm] [--write] [--from-csv file]"
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Encode one CSV field, quoting it only when it contains something risky. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Parse CSV (quoted fields may contain commas, newlines and "" escapes). */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Swallow CR; the following LF ends the record.
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Zillow sometimes appends a note to the street, e.g. "(photos coming soon)". */
function cleanStreet(address: string): string {
  return address.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function osmQuery(row: SourceRow): string {
  const street = cleanStreet(row.address);
  const city = row.city.trim();
  const state = row.state.trim() || DEFAULT_STATE;
  const zip = row.zipcode.trim();
  return `${street}, ${city}, ${state}${zip ? ` ${zip}` : ""}`;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function loadListings(limit: number | null): Promise<SourceRow[]> {
  const rows = await db
    .select({
      id: listings.id,
      address: listings.address,
      city: listings.city,
      state: listings.state,
      zipcode: listings.zipcode,
    })
    .from(listings)
    .where(
      and(
        isNull(listings.geocodedAt),
        sql`${listings.address} is not null and trim(${listings.address}) <> ''`
      )
    )
    .limit(limit ?? 1_000_000);

  return rows.map((r) => ({
    id: r.id,
    table: "listings" as const,
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zipcode: r.zipcode ?? "",
  }));
}

async function loadBookings(limit: number | null): Promise<SourceRow[]> {
  const rows = await db
    .select({
      id: bookings.id,
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
    })
    .from(bookings)
    .where(
      and(
        isNull(bookings.listingId),
        isNull(bookings.geocodedAt),
        sql`${bookings.address} is not null and trim(${bookings.address}) <> ''`
      )
    )
    .limit(limit ?? 1_000_000);

  // Bookings have no ZIP column, and a booking with a listingId points at that
  // listing's location, so only standalone bookings are loaded above.
  return rows.map((r) => ({
    id: r.id,
    table: "bookings" as const,
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zipcode: "",
  }));
}

async function loadRows(args: Args): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  if (args.only !== "bookings") rows.push(...(await loadListings(args.limit)));
  if (args.only !== "listings") rows.push(...(await loadBookings(args.limit)));
  return args.limit == null ? rows : rows.slice(0, args.limit);
}

// ---------------------------------------------------------------------------
// Census batch
// ---------------------------------------------------------------------------

function censusId(row: SourceRow): string {
  return `${row.table === "listings" ? "L" : "B"}:${row.id}`;
}

function censusCsv(chunk: SourceRow[]): string {
  return chunk
    .map((row) =>
      [
        censusId(row),
        cleanStreet(row.address),
        row.city.trim(),
        row.state.trim() || DEFAULT_STATE,
        row.zipcode.trim(),
      ]
        .map(csvField)
        .join(",")
    )
    .join("\n");
}

interface CensusHit {
  status: Status;
  lat: number | null;
  lng: number | null;
  matchedAddress: string;
}

async function requestCensus(chunk: SourceRow[]): Promise<Map<string, CensusHit>> {
  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([censusCsv(chunk)], { type: "text/csv" }),
    "addresses.csv"
  );
  form.append("benchmark", "Public_AR_Current");

  const res = await fetch(CENSUS_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Census HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  const records = parseCsv(text);
  const hits = new Map<string, CensusHit>();

  for (const fields of records) {
    if (fields.length < 3) continue;
    const id = fields[0].trim();
    const match = fields[2].trim();
    if (!id || match !== "Match") continue;

    // Response columns: id, input address, Match|No_Match|Tie,
    // Exact|Non_Exact, matched address, "lon,lat", tigerLineId, side.
    const matchType = (fields[3] ?? "").trim();
    const matchedAddress = (fields[4] ?? "").trim();
    const coords = (fields[5] ?? "").split(",");
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || coords.length !== 2) continue;

    hits.set(id, {
      status: matchType === "Exact" ? "census_exact" : "census_nonexact",
      lat,
      lng,
      matchedAddress,
    });
  }
  return hits;
}

async function geocodeChunk(chunk: SourceRow[]): Promise<Map<string, CensusHit>> {
  try {
    return await requestCensus(chunk);
  } catch (err) {
    console.warn(`  Census failed, retrying once: ${(err as Error).message}`);
    return requestCensus(chunk);
  }
}

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

let lastOsmAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function lookupOsm(row: SourceRow): Promise<CensusHit | null> {
  const street = cleanStreet(row.address);
  // Never fall back to the town alone: a city centroid is worse than no match.
  if (!street) return null;

  const waited = Date.now() - lastOsmAt;
  if (waited < OSM_DELAY_MS) await sleep(OSM_DELAY_MS - waited);
  lastOsmAt = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", osmQuery(row));
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const hit = Array.isArray(data) ? data[0] : undefined;
  if (!hit) return null;

  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    status: "osm",
    lat,
    lng,
    matchedAddress: hit.display_name ?? "",
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const RESULT_HEADER = [
  "id",
  "table",
  "address",
  "city",
  "status",
  "lat",
  "lng",
  "matched_address",
];

function resultLine(row: ResultRow): string {
  return [
    row.id,
    row.table,
    row.address,
    row.city,
    row.status,
    row.lat == null ? "" : String(row.lat),
    row.lng == null ? "" : String(row.lng),
    row.matchedAddress,
  ]
    .map((v) => csvField(String(v)))
    .join(",");
}

function printSummary(rows: ResultRow[]): void {
  const statuses: Status[] = ["census_exact", "census_nonexact", "osm", "none"];
  const tables: TableName[] = ["listings", "bookings"];
  const counts: Record<TableName, Record<Status, number>> = {
    listings: { census_exact: 0, census_nonexact: 0, osm: 0, none: 0 },
    bookings: { census_exact: 0, census_nonexact: 0, osm: 0, none: 0 },
  };
  for (const row of rows) counts[row.table][row.status]++;

  const pad = (v: string, n: number) => v.padEnd(n);
  console.log("\nSummary");
  console.log(
    pad("table", 10) +
      statuses.map((s) => pad(s, 16)).join("") +
      pad("total", 8)
  );
  for (const table of tables) {
    const total = statuses.reduce((sum, s) => sum + counts[table][s], 0);
    console.log(
      pad(table, 10) +
        statuses.map((s) => pad(String(counts[table][s]), 16)).join("") +
        pad(String(total), 8)
    );
  }
  const totals = statuses.map((s) =>
    counts.listings[s] + counts.bookings[s]
  );
  console.log(
    pad("all", 10) +
      totals.map((n) => pad(String(n), 16)).join("") +
      pad(String(totals.reduce((a, b) => a + b, 0)), 8)
  );
}

function newExportPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(EXPORT_DIR, `backfill-${stamp}.csv`);
}

// ---------------------------------------------------------------------------
// DB write
// ---------------------------------------------------------------------------

function sourceFor(status: Status): "census" | "osm" | null {
  if (status === "census_exact" || status === "census_nonexact") return "census";
  if (status === "osm") return "osm";
  return null;
}

async function applyResults(rows: ResultRow[]): Promise<void> {
  for (const tableName of ["listings", "bookings"] as const) {
    const tableRows = rows.filter((r) => r.table === tableName);
    const table = tableName === "listings" ? listings : bookings;

    for (let i = 0; i < tableRows.length; i += UPDATE_CHUNK) {
      const chunk = tableRows.slice(i, i + UPDATE_CHUNK);
      const values = chunk.map(
        (r) =>
          sql`(${r.id}::uuid, ${r.lat}::double precision, ${r.lng}::double precision, ${sourceFor(
            r.status
          )}::text)`
      );
      await db.execute(sql`
        UPDATE ${table} AS t
        SET lat = v.lat,
            lng = v.lng,
            geocode_source = v.source,
            geocoded_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, lat, lng, source)
        WHERE t.id = v.id
      `);
      console.log(
        `Updated ${tableName} ${Math.min(i + chunk.length, tableRows.length)}/${tableRows.length}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// from-csv
// ---------------------------------------------------------------------------

function loadResultsFromCsv(path: string): ResultRow[] {
  const records = parseCsv(readFileSync(path, "utf8"));
  if (records.length === 0) throw new Error(`${path} is empty`);
  const header = records[0].map((h) => h.trim());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`${path} is missing column "${name}"`);
    return i;
  };
  const [idCol, tableCol, addressCol, cityCol, statusCol, latCol, lngCol, matchedCol] = [
    col("id"),
    col("table"),
    col("address"),
    col("city"),
    col("status"),
    col("lat"),
    col("lng"),
    col("matched_address"),
  ];

  return records.slice(1).map((fields) => {
    const table = fields[tableCol]?.trim();
    if (table !== "listings" && table !== "bookings") {
      throw new Error(`Unexpected table "${table}" in ${path}`);
    }
    const status = fields[statusCol]?.trim() as Status;
    if (!["census_exact", "census_nonexact", "osm", "none"].includes(status)) {
      throw new Error(`Unexpected status "${status}" in ${path}`);
    }
    const lat = Number(fields[latCol]);
    const lng = Number(fields[lngCol]);
    if (fields[latCol]?.trim() && !Number.isFinite(lat)) {
      throw new Error(`Bad lat "${fields[latCol]}" for ${fields[idCol]} in ${path}`);
    }
    if (fields[lngCol]?.trim() && !Number.isFinite(lng)) {
      throw new Error(`Bad lng "${fields[lngCol]}" for ${fields[idCol]} in ${path}`);
    }
    return {
      id: fields[idCol].trim(),
      table,
      address: fields[addressCol] ?? "",
      city: fields[cityCol] ?? "",
      state: "",
      zipcode: "",
      status,
      lat: fields[latCol]?.trim() ? lat : null,
      lng: fields[lngCol]?.trim() ? lng : null,
      matchedAddress: fields[matchedCol] ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromCsv) {
    const rows = loadResultsFromCsv(args.fromCsv);
    printSummary(rows);
    if (!args.write) {
      console.log(
        `\nRead ${rows.length} rows from ${args.fromCsv} (dry run — pass --write to apply).`
      );
      return;
    }
    console.log(`\nApplying ${rows.length} rows from ${args.fromCsv}...`);
    await applyResults(rows);
    console.log("Done.");
    return;
  }

  const sourceRows = await loadRows(args);
  console.log(
    `Loaded ${sourceRows.length} ungeocoded rows` +
      (args.limit ? ` (limit ${args.limit})` : "") +
      (args.only ? ` from ${args.only}` : "")
  );
  if (sourceRows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const results: ResultRow[] = [];

  const outPath = newExportPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, RESULT_HEADER.map(csvField).join(",") + "\n");
  console.log(`Writing results to ${outPath}`);

  const chunkCount = Math.ceil(sourceRows.length / CENSUS_CHUNK);
  let osmCount = 0;
  let done = 0;

  // Process one Census batch at a time, writing each row as soon as it's
  // resolved, so a later chunk failing doesn't throw away earlier work.
  for (let start = 0; start < sourceRows.length; start += CENSUS_CHUNK) {
    const chunk = sourceRows.slice(start, start + CENSUS_CHUNK);
    console.log(
      `Census chunk ${start / CENSUS_CHUNK + 1}/${chunkCount} (${chunk.length} rows)...`
    );
    const censusHits = await geocodeChunk(chunk);
    console.log(`  matched ${censusHits.size}/${chunk.length}`);

    for (const row of chunk) {
      let hit: CensusHit | null = censusHits.get(censusId(row)) ?? null;

      if (!hit && !args.noOsm) {
        try {
          hit = await lookupOsm(row);
        } catch (err) {
          console.warn(`  OSM failed for ${row.address}: ${(err as Error).message}`);
          hit = null;
        }
        osmCount++;
      }

      const result: ResultRow = {
        ...row,
        status: hit?.status ?? "none",
        lat: hit?.lat ?? null,
        lng: hit?.lng ?? null,
        matchedAddress: hit?.matchedAddress ?? "",
      };
      results.push(result);
      appendFileSync(outPath, resultLine(result) + "\n");

      done++;
      if (done % 100 === 0) {
        console.log(`  geocoded ${done}/${sourceRows.length}`);
      }
    }
  }
  if (osmCount > 0) console.log(`  Nominatim lookups: ${osmCount}`);

  printSummary(results);
  console.log(`\nCSV: ${outPath}`);

  if (!args.write) {
    console.log("Dry run — no database rows changed. Re-run with --write to apply.");
    return;
  }

  console.log("\nWriting to database...");
  await applyResults(results);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
