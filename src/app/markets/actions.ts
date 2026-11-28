"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { markets, shooters } from "@/db/schema";
import type { ShooterRates } from "@/db/schema";
import { geocodeAddress } from "@/lib/geocode";
import { DEFAULT_DRIVE, stateName, type MarketKind, type MarketStatus } from "@/lib/markets";
import { normalizePhone, EMAIL_RE } from "@/lib/normalize";
import { cleanPortfolioPrices } from "@/lib/portfolioPrices";

/**
 * Writes for the Markets page: the `markets` rows (lib/markets.ts) and the
 * shooters placed in them. Nothing here deletes a market or a shooter — a
 * dead market keeps its listings and history, and a shooter keeps their pay
 * record for the 1099, so both are paused or deactivated instead.
 *
 * Auth: the whole admin app sits behind Proxy's password gate
 * (src/proxy.ts, lib/adminSession.ts), which refuses every non-GET request
 * without a signed session — the same as every other action file in src/app.
 */

/** Any market write changes the tabs, quotas and the Markets page itself. */
function revalidateMarkets() {
  revalidatePath("/markets");
  revalidatePath("/");
}

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form";
}

/** Drops keys the caller didn't send, so an update only touches what it names. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** "" and whitespace mean "nothing here", stored as null. */
function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

const latSchema = z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90");
const lngSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

const keySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]+$/, "Key: lowercase letters, digits and underscores only");

const stateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a two-letter state code (OR, WA, …)");

const statusSchema = z.enum(["testing", "active", "paused", "killed"]);

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone (e.g. America/Los_Angeles)");

const priceField = z.number().nonnegative("Prices can't be negative").optional();
const pricesSchema = z.object({
  photo: priceField,
  drone: priceField,
  floorPlans: priceField,
  staging: priceField,
  twilight: priceField,
  video: priceField,
  bundle: priceField,
  socialEdit: priceField,
  fullPackage: priceField,
});

const marketInputSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1, "Give the market a label").optional(),
  /** Only honoured on create: local and regional are built in, and a row's kind never changes. */
  kind: z.enum(["local", "regional", "shooter"]).optional(),
  status: statusSchema.optional(),
  sortOrder: z.number().int().optional(),
  state: stateSchema.optional(),
  states: z.array(stateSchema).optional(),
  timeZone: timeZoneSchema.optional(),
  base: z
    .object({
      name: z.string().trim().min(1, "The base town needs a name"),
      lat: latSchema.optional(),
      lng: lngSchema.optional(),
    })
    .nullish(),
  pointArea: z
    .object({
      radiusMiles: z.number().positive("The point area needs a radius in miles"),
      minLat: latSchema.optional(),
      maxLat: latSchema.optional(),
      minLng: lngSchema.optional(),
      maxLng: lngSchema.optional(),
    })
    .nullish(),
  /** Town → [lat, lng]; keys are lowercased here, so the form can send any case. */
  cities: z.record(z.string().min(1), z.tuple([latSchema, lngSchema])).optional(),
  areaCodes: z
    .array(z.string().trim().regex(/^\d{3}$/, "Area codes are three digits"))
    .optional(),
  drive: z
    .object({
      startMinutes: z.number().nonnegative(),
      minutesPerMile: z.number().nonnegative(),
    })
    .optional(),
  areaPhrase: z.string().trim().nullish(),
  portfolioArea: z.string().trim().nullish(),
  pageLocation: z.string().trim().nullish(),
  vcardCity: z.string().trim().nullish(),
  vcardNote: z.string().trim().nullish(),
  jobsPerWeek: z.number().nonnegative("Jobs a week can't be negative").optional(),
  prices: pricesSchema.optional(),
  listingsStreetOnly: z.boolean().optional(),
  testimonialNameOnly: z.boolean().optional(),
  notes: z.string().trim().nullish(),
});

export type MarketInput = z.input<typeof marketInputSchema>;

/**
 * A town name is all the geocoder (lib/geocode.ts) gets for a market's base or
 * a town added by name. There is no town-only helper there: geocodeAddress's
 * Nominatim fallback resolves "Portland, OR" fine, and a miss returns null so
 * the caller can ask for lat/lng instead of guessing.
 */
async function geocodeTown(name: string, state: string): Promise<{ lat: number; lng: number } | null> {
  const point = await geocodeAddress({ street: name, state });
  return point ? { lat: point.lat, lng: point.lng } : null;
}

/** Every town key lowercase, as lib/markets.ts matches them. */
function lowercaseCities(cities: Record<string, [number, number]>): Record<string, [number, number]> {
  return Object.fromEntries(Object.entries(cities).map(([town, at]) => [town.trim().toLowerCase(), at]));
}

/**
 * Creates a shooter market, or updates an existing row by its key (the key is
 * immutable). Local and regional are built in and can't be created; their rows
 * can still be edited, but their kind never changes.
 */
export async function saveMarket(input: MarketInput): Promise<{ error?: string }> {
  const parsed = marketInputSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const m = parsed.data;

  const [existing] = await db.select().from(markets).where(eq(markets.key, m.key));
  if (!existing && (m.kind ?? "shooter") !== "shooter") {
    return { error: "Local and regional markets are built in — only shooter markets can be added." };
  }

  const kind: MarketKind = existing ? (existing.kind as MarketKind) : "shooter";
  const state = m.state ?? existing?.state ?? "OR";

  // A base with a name but no coordinates is geocoded once, here, and stored.
  const incomingBase = m.base === undefined ? (existing?.base ?? null) : m.base;
  let base: { name: string; lat: number; lng: number } | null = null;
  if (incomingBase) {
    if (incomingBase.lat != null && incomingBase.lng != null) {
      base = { name: incomingBase.name, lat: incomingBase.lat, lng: incomingBase.lng };
    } else {
      const point = await geocodeTown(incomingBase.name, state);
      if (!point) {
        return {
          error: `Couldn't find ${incomingBase.name}, ${stateName(state)}. Enter the base town's latitude and longitude.`,
        };
      }
      base = { name: incomingBase.name, ...point };
    }
  }
  const pointArea = m.pointArea === undefined ? (existing?.pointArea ?? null) : m.pointArea;

  if (kind === "shooter" && !base) return { error: "A shooter market needs a base town." };
  if (kind === "shooter" && (!pointArea || !(pointArea.radiusMiles > 0))) {
    return { error: "A shooter market needs a point-area radius (radiusMiles)." };
  }

  if (!existing) {
    if (!m.label) return { error: "Give the market a label" };
    const name = base!.name;
    await db.insert(markets).values({
      key: m.key,
      label: m.label,
      kind: "shooter",
      status: m.status ?? "testing",
      sortOrder: m.sortOrder ?? 100,
      state,
      states: m.states ?? [],
      timeZone: m.timeZone ?? "America/Los_Angeles",
      base,
      cities: lowercaseCities(m.cities ?? {}),
      pointArea,
      areaCodes: m.areaCodes ?? [],
      drive: m.drive ?? DEFAULT_DRIVE,
      // A blank wording is filled from the base town, so a new market reads
      // right before Lukas has typed any of it.
      areaPhrase: text(m.areaPhrase) ?? `in the ${name} area`,
      portfolioArea: text(m.portfolioArea) ?? `the ${name} area`,
      pageLocation: text(m.pageLocation) ?? `${name}, ${stateName(state)}`,
      vcardCity: text(m.vcardCity) ?? name,
      vcardNote: text(m.vcardNote),
      jobsPerWeek: m.jobsPerWeek ?? 0,
      prices: cleanPortfolioPrices(m.prices),
      listingsStreetOnly: m.listingsStreetOnly ?? false,
      testimonialNameOnly: m.testimonialNameOnly ?? false,
      launchedAt: new Date(),
      notes: text(m.notes),
    });
    revalidateMarkets();
    return {};
  }

  await db
    .update(markets)
    .set(
      compact({
        label: m.label,
        status: m.status,
        sortOrder: m.sortOrder,
        state: m.state,
        states: m.states,
        timeZone: m.timeZone,
        base: m.base === undefined ? undefined : base,
        cities: m.cities === undefined ? undefined : lowercaseCities(m.cities),
        pointArea: m.pointArea === undefined ? undefined : m.pointArea,
        areaCodes: m.areaCodes,
        drive: m.drive,
        areaPhrase: m.areaPhrase === undefined ? undefined : text(m.areaPhrase),
        portfolioArea: m.portfolioArea === undefined ? undefined : text(m.portfolioArea),
        pageLocation: m.pageLocation === undefined ? undefined : text(m.pageLocation),
        vcardCity: m.vcardCity === undefined ? undefined : text(m.vcardCity),
        vcardNote: m.vcardNote === undefined ? undefined : text(m.vcardNote),
        jobsPerWeek: m.jobsPerWeek,
        prices: m.prices === undefined ? undefined : cleanPortfolioPrices(m.prices),
        listingsStreetOnly: m.listingsStreetOnly,
        testimonialNameOnly: m.testimonialNameOnly,
        notes: m.notes === undefined ? undefined : text(m.notes),
        updatedAt: new Date(),
      })
    )
    .where(eq(markets.key, m.key));
  revalidateMarkets();
  return {};
}

/**
 * Moves a market through its lifecycle. Killing stamps killedAt (and reviving
 * clears it); a market that never launched gets launchedAt the first time it
 * goes live, so "days live" starts when outreach did, not when the row was made.
 */
export async function setMarketStatus(key: string, status: MarketStatus): Promise<{ error?: string }> {
  const parsed = z.object({ key: z.string().trim().min(1), status: statusSchema }).safeParse({ key, status });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const [row] = await db.select().from(markets).where(eq(markets.key, parsed.data.key));
  if (!row) return { error: "No market with that key" };

  const now = new Date();
  const live = status === "testing" || status === "active";
  await db
    .update(markets)
    .set({
      status,
      killedAt: status === "killed" ? now : null,
      launchedAt: row.launchedAt ?? (live ? now : null),
      updatedAt: now,
    })
    .where(eq(markets.key, row.key));
  revalidateMarkets();
  return {};
}

/**
 * Adds one town to a shooter market by name. The town list is what places a
 * listing before its geocode is consulted, so a miss here must not save a
 * bogus town with a made-up centre: the geocode either answers or the town
 * isn't added.
 */
export async function addMarketTown(key: string, town: string): Promise<{ error?: string }> {
  const name = town.trim();
  if (!name) return { error: "Enter a town name" };

  const [row] = await db
    .select({ key: markets.key, state: markets.state, cities: markets.cities })
    .from(markets)
    .where(eq(markets.key, key));
  if (!row) return { error: "No market with that key" };

  const point = await geocodeTown(name, row.state);
  if (!point) return { error: `Couldn't find ${name}, ${stateName(row.state)}. Check the spelling.` };

  await db
    .update(markets)
    .set({
      cities: { ...(row.cities ?? {}), [name.toLowerCase()]: [point.lat, point.lng] },
      updatedAt: new Date(),
    })
    .where(eq(markets.key, row.key));
  revalidateMarkets();
  return {};
}

const rateField = z.number().nonnegative("Rates can't be negative").optional();
const ratesSchema = z.object({
  photo: rateField,
  photoDrone: rateField,
  video: rateField,
  drone: rateField,
});

const shooterInputSchema = z.object({
  /** Present = update that shooter; absent = add a new one. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "The shooter needs a name").optional(),
  label: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  email: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || EMAIL_RE.test(v), "That doesn't look like an email address"),
  notes: z.string().trim().nullish(),
  /** markets.key, or null for a shooter not placed in one yet. */
  marketKey: z.string().trim().nullish(),
  role: z.enum(["main", "backup"]).optional(),
  lat: latSchema.nullish(),
  lng: lngSchema.nullish(),
  /** Where they're based, geocoded when lat/lng aren't given. */
  homeAddress: z.string().trim().nullish(),
  freeMinutes: z.number().int().nonnegative().optional(),
  drivePerHour: z.number().int().nonnegative().nullish(),
  /** Flat travel fee by town; keys are lowercased on save. */
  travelFees: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Farthest one-way drive in minutes; null = no limit. */
  maxMinutes: z.number().int().positive().nullish(),
  style: z.enum(["hdr", "flambient"]).optional(),
  rates: ratesSchema.optional(),
  active: z.boolean().optional(),
  w9OnFile: z.boolean().optional(),
});

export type ShooterInput = z.input<typeof shooterInputSchema>;

/** Whole dollars only, unknown keys dropped (schema ShooterRates). */
function cleanRates(rates: Partial<ShooterRates> | null | undefined): ShooterRates {
  const out: ShooterRates = {};
  for (const key of ["photo", "photoDrone", "video", "drone"] as const) {
    const value = rates?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * Adds or updates a shooter (one photographer Lukas subcontracts to). The name
 * is unique across the table because a shooter's pay and 1099 add up per row;
 * clearing the market key unplaces them without losing their history.
 */
export async function saveShooter(input: ShooterInput): Promise<{ error?: string }> {
  const parsed = shooterInputSchema.safeParse(input);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const s = parsed.data;

  const [existing] = s.id ? await db.select().from(shooters).where(eq(shooters.id, s.id)) : [];
  if (s.id && !existing) return { error: "No shooter with that id" };
  if (!existing && !s.name) return { error: "The shooter needs a name" };

  // The name is the key everything else (pay, 1099) hangs off, so catch a
  // clash here rather than letting the unique index throw at the user.
  if (s.name) {
    const clashes = await db
      .select({ id: shooters.id })
      .from(shooters)
      .where(sql`lower(${shooters.name}) = ${s.name.toLowerCase()}`);
    if (clashes.some((row) => row.id !== existing?.id)) {
      return { error: `A shooter named ${s.name} is already on file.` };
    }
  }

  let marketState: string | null = null;
  if (s.marketKey) {
    const [market] = await db
      .select({ state: markets.state })
      .from(markets)
      .where(eq(markets.key, s.marketKey));
    if (!market) return { error: `No market with the key "${s.marketKey}"` };
    marketState = market.state;
  }

  let lat = s.lat === undefined ? (existing?.lat ?? null) : s.lat;
  let lng = s.lng === undefined ? (existing?.lng ?? null) : s.lng;
  if (s.homeAddress && (lat == null || lng == null)) {
    const point = await geocodeAddress({ street: s.homeAddress, state: marketState });
    if (!point) return { error: `Couldn't find "${s.homeAddress}". Enter the latitude and longitude instead.` };
    lat = point.lat;
    lng = point.lng;
  }

  const values = compact({
    name: s.name,
    label: s.label === undefined ? undefined : text(s.label),
    phone: s.phone === undefined ? undefined : s.phone ? normalizePhone(s.phone) : null,
    email: s.email === undefined ? undefined : s.email ? s.email.toLowerCase() : null,
    notes: s.notes === undefined ? undefined : text(s.notes),
    marketKey: s.marketKey === undefined ? undefined : text(s.marketKey),
    role: s.role,
    lat,
    lng,
    freeMinutes: s.freeMinutes,
    drivePerHour: s.drivePerHour,
    travelFees:
      s.travelFees === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(s.travelFees)
              .map(([town, fee]) => [town.trim().toLowerCase(), fee] as const)
              .filter(([town]) => town)
          ),
    maxMinutes: s.maxMinutes,
    style: s.style,
    rates: s.rates === undefined ? undefined : cleanRates(s.rates),
    active: s.active,
    w9OnFile: s.w9OnFile,
  });

  try {
    if (existing) {
      await db.update(shooters).set(values).where(eq(shooters.id, existing.id));
    } else {
      await db.insert(shooters).values({
        ...values,
        name: s.name!,
        freeMinutes: s.freeMinutes ?? 60,
        role: s.role ?? "main",
        rates: cleanRates(s.rates),
        active: s.active ?? true,
        w9OnFile: s.w9OnFile ?? false,
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A shooter named ${s.name ?? ""} is already on file.` };
    throw err;
  }

  revalidateMarkets();
  revalidatePath("/booked");
  revalidatePath("/finances");
  return {};
}
