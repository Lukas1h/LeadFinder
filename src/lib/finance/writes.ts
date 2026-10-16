/**
 * Saving and reading the ledger's own rows: trips, expenses, receipts and the
 * finance settings. Shared by the web's server actions (src/app/finances/
 * actions.ts, which add the page revalidation) and the iPhone API
 * (src/app/api/app/v1/finances), so both validate the same way.
 */

import { db } from "@/db";
import { expenses, receipts, tripBookings, trips } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { appSettings } from "@/db/schema";
import { callGemini } from "@/lib/gemini";
import { EXPENSE_CATEGORIES, TRIP_CATEGORIES } from "./categories";
import { estimateRoute, type RouteEstimate } from "./route";
import { getHomeLocation } from "@/lib/settings";
import { loadLedger } from "./ledger";
import { pacificDate } from "./math";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------------------------------------------------------------------------
// Trips

export interface TripInput {
  date: string;
  purpose: string;
  category: string;
  stops: string | null;
  miles: number;
  driveMinutes: number | null;
  milesEstimated: boolean;
  notes: string | null;
  bookingIds: string[];
}

export async function writeTrip(id: string | null, input: TripInput): Promise<{ error?: string; id?: string }> {
  if (!isDate(input.date)) return { error: "Pick a date" };
  if (!input.purpose.trim()) return { error: "Say what the trip was for" };
  if (!Number.isFinite(input.miles) || input.miles < 0) return { error: "Enter the miles" };
  if (!TRIP_CATEGORIES.some((c) => c.value === input.category)) return { error: "Pick what kind of trip it was" };

  const values = {
    date: input.date,
    purpose: input.purpose.trim(),
    category: input.category,
    stops: input.stops?.trim() || null,
    miles: input.miles,
    driveMinutes: input.driveMinutes != null && Number.isFinite(input.driveMinutes) ? Math.round(input.driveMinutes) : null,
    milesEstimated: input.milesEstimated,
    notes: input.notes?.trim() || null,
  };

  let tripId = id;
  if (tripId) {
    const [row] = await db.update(trips).set(values).where(eq(trips.id, tripId)).returning({ id: trips.id });
    if (!row) return { error: "No trip with that id" };
  } else {
    const [row] = await db.insert(trips).values(values).returning({ id: trips.id });
    tripId = row.id;
  }

  await db.delete(tripBookings).where(eq(tripBookings.tripId, tripId));
  const bookingIds = [...new Set(input.bookingIds)];
  if (bookingIds.length > 0) await db.insert(tripBookings).values(bookingIds.map((bookingId) => ({ tripId: tripId!, bookingId })));

  return { id: tripId };
}

export async function removeTrip(id: string) {
  await db.delete(trips).where(eq(trips.id, id));
}

/** Adds a booking to a trip that's already logged (the second job of a two-job day). */
export async function linkBookingToTrip(tripId: string, bookingId: string) {
  await db.insert(tripBookings).values({ tripId, bookingId }).onConflictDoNothing();
}

/** Round-trip miles and drive time from home through the stops, from a routing service. */
export async function routeForStops(stops: string[]): Promise<RouteEstimate | { error: string }> {
  const clean = stops.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return { error: "Add at least one stop" };
  const home = await getHomeLocation();
  return estimateRoute(`${home.city}, ${home.state}`, clean);
}

// ---------------------------------------------------------------------------
// Expenses

export interface ExpenseInput {
  date: string;
  amount: number;
  vendor: string | null;
  description: string;
  category: string;
  deductiblePercent: number;
  gallons: number | null;
  pricePerGallon: number | null;
  paidPersonally: boolean;
  spreadMonths: number;
  bookingId: string | null;
  tripId: string | null;
  notes: string | null;
}

/** Inserts (id null) or updates an expense. */
export async function writeExpense(id: string | null, input: ExpenseInput): Promise<{ error?: string; id?: string }> {
  if (!isDate(input.date)) return { error: "Pick a date" };
  if (!Number.isFinite(input.amount) || input.amount < 0) return { error: "Enter the amount" };
  if (!input.description.trim()) return { error: "Say what it was" };
  if (!EXPENSE_CATEGORIES.some((c) => c.value === input.category)) return { error: "Pick a category" };

  const values = {
    date: input.date,
    amountCents: Math.round(input.amount * 100),
    vendor: input.vendor?.trim() || null,
    description: input.description.trim(),
    category: input.category,
    deductiblePercent: Math.min(100, Math.max(0, Math.round(input.deductiblePercent))),
    gallons: input.category === "gas" ? input.gallons : null,
    pricePerGallon: input.category === "gas" ? input.pricePerGallon : null,
    paidPersonally: input.paidPersonally,
    spreadMonths: Math.max(1, Math.round(input.spreadMonths || 1)),
    bookingId: input.bookingId || null,
    tripId: input.tripId || null,
    notes: input.notes?.trim() || null,
  };

  if (id) {
    const [row] = await db.update(expenses).set(values).where(eq(expenses.id, id)).returning({ id: expenses.id });
    return row ? { id } : { error: "No expense with that id" };
  }
  const [row] = await db.insert(expenses).values(values).returning({ id: expenses.id });
  return { id: row.id };
}

/**
 * Stores (or replaces) an expense's receipt file. The first receipt an
 * expense gets also gives it the next receipt number, continuing the
 * finances repo's 101, 102, ...
 */
export async function attachReceipt(expenseId: string, file: { name: string; mimeType: string; data: Buffer }) {
  const fileName = file.name || "receipt";
  const mimeType = file.mimeType || "application/octet-stream";
  await db
    .insert(receipts)
    .values({ expenseId, fileName, mimeType, data: file.data })
    .onConflictDoUpdate({ target: receipts.expenseId, set: { fileName, mimeType, data: file.data, createdAt: new Date() } });
  const [current] = await db.select({ n: expenses.receiptNumber }).from(expenses).where(eq(expenses.id, expenseId));
  if (current?.n == null) {
    await db
      .update(expenses)
      .set({ receiptNumber: sql`(select coalesce(max(${expenses.receiptNumber}), 100) + 1 from ${expenses})` })
      .where(eq(expenses.id, expenseId));
  }
}

export async function removeExpense(id: string) {
  await db.delete(expenses).where(eq(expenses.id, id));
}

export interface ReadReceipt {
  date: string | null;
  amount: number | null;
  vendor: string | null;
  description: string | null;
  category: string | null;
  gallons: number | null;
  pricePerGallon: number | null;
}

/** Reads a receipt photo or PDF with Gemini, to fill in the expense form. Nothing is saved. */
export async function readReceiptFile(mimeType: string, data: Buffer): Promise<ReadReceipt | { error: string }> {
  if (data.length === 0) return { error: "No receipt attached" };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "Gemini isn't set up" };

  const categories = EXPENSE_CATEGORIES.map((c) => `${c.value} (${c.label}${c.hint ? `: ${c.hint}` : ""})`).join("; ");
  const text = await callGemini({
    model: "gemini-3.5-flash",
    apiKey,
    logLabel: "readReceipt",
    parts: [
      { inlineData: { mimeType: mimeType || "image/jpeg", data: data.toString("base64") } },
      {
        text: `This is a receipt for a one-person real estate photography business in Oregon. Read it.
Return JSON with:
- date: the purchase date as YYYY-MM-DD, or null
- amount: the total charged in dollars (after tax and tip), or null
- vendor: the business name and town, short, like "Fred Meyer Fuel, Grants Pass"
- description: a few words on what was bought, like "Gas" or "Drone motor arm"
- category: one of ${categories}. A restaurant or coffee shop is meal_travel unless the receipt suggests a client was there.
- gallons and pricePerGallon: for fuel only, else null`,
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING", nullable: true },
          amount: { type: "NUMBER", nullable: true },
          vendor: { type: "STRING", nullable: true },
          description: { type: "STRING", nullable: true },
          category: { type: "STRING", nullable: true },
          gallons: { type: "NUMBER", nullable: true },
          pricePerGallon: { type: "NUMBER", nullable: true },
        },
      },
    },
  });
  if (!text) return { error: "Couldn't read the receipt" };
  try {
    const parsed = JSON.parse(text) as ReadReceipt;
    return {
      ...parsed,
      date: parsed.date && isDate(parsed.date) ? parsed.date : null,
      category: EXPENSE_CATEGORIES.some((c) => c.value === parsed.category) ? parsed.category : null,
    };
  } catch {
    return { error: "Couldn't read the receipt" };
  }
}

// ---------------------------------------------------------------------------
// Settings

export async function writeFinanceSettings(input: { mpg: number; otherWagesMonthly: number }) {
  if (!(input.mpg > 0)) return { error: "MPG has to be above 0" };
  const values = { vehicleMpg: input.mpg, otherWagesMonthly: Math.max(0, Math.round(input.otherWagesMonthly || 0)) };
  await db.insert(appSettings).values({ id: "singleton", ...values }).onConflictDoUpdate({ target: appSettings.id, set: values });
  return {};
}

// ---------------------------------------------------------------------------
// What a trip or expense can be linked to, for the forms' pickers.

export interface LinkOptions {
  bookings: { id: string; label: string; date: string | null }[];
  trips: { id: string; date: string; purpose: string; miles: number; bookingIds: string[] }[];
}

export async function linkOptions(): Promise<LinkOptions> {
  const ledger = await loadLedger();
  return {
    bookings: ledger.bookings
      .map((b) => ({ id: b.id, label: b.label, date: b.earnedDate ?? (b.jobDate ? pacificDate(b.jobDate) : null) }))
      .sort((a, b) => (b.date ?? "9999").localeCompare(a.date ?? "9999")),
    trips: ledger.trips
      .map((t) => ({ id: t.id, date: t.date, purpose: t.purpose, miles: t.miles, bookingIds: t.bookingIds }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}
