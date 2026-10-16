import type { Expense, Trip } from "@/db/schema";
import type { ExpenseInput, TripInput } from "@/lib/finance/writes";
import { BadBody, isUuid, optionalNumber, optionalString } from "../helpers";

/**
 * Body parsing and JSON shapes for the finance routes. A PATCH sends only the
 * fields it changes; parse*Input layers them over the row as it stands, so
 * create and update validate through the same writeExpense/writeTrip.
 */

function optionalBool(value: unknown, field: string): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new BadBody(`${field} must be true or false`);
  return value;
}

function optionalId(value: unknown, field: string): string | null {
  const id = optionalString(value, field);
  if (id && !isUuid(id)) throw new BadBody(`${field} must be an id`);
  return id;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export function parseExpenseInput(body: Record<string, unknown>, current?: Expense): ExpenseInput {
  const pick = <T>(key: string, parse: (v: unknown, f: string) => T, fallback: T): T =>
    has(body, key) ? parse(body[key], key) : fallback;
  return {
    date: pick("date", optionalString, current?.date ?? null) ?? "",
    amount: pick("amount", optionalNumber, current ? current.amountCents / 100 : null) ?? NaN,
    vendor: pick("vendor", optionalString, current?.vendor ?? null),
    description: pick("description", optionalString, current?.description ?? null) ?? "",
    category: pick("category", optionalString, current?.category ?? null) ?? "",
    deductiblePercent: pick("deductiblePercent", optionalNumber, current?.deductiblePercent ?? null) ?? 100,
    gallons: pick("gallons", optionalNumber, current?.gallons ?? null),
    pricePerGallon: pick("pricePerGallon", optionalNumber, current?.pricePerGallon ?? null),
    paidPersonally: pick("paidPersonally", optionalBool, current?.paidPersonally ?? null) ?? false,
    spreadMonths: pick("spreadMonths", optionalNumber, current?.spreadMonths ?? null) ?? 1,
    bookingId: pick("bookingId", optionalId, current?.bookingId ?? null),
    tripId: pick("tripId", optionalId, current?.tripId ?? null),
    notes: pick("notes", optionalString, current?.notes ?? null),
  };
}

export function parseTripInput(body: Record<string, unknown>, current?: Trip & { bookingIds: string[] }): TripInput {
  const pick = <T>(key: string, parse: (v: unknown, f: string) => T, fallback: T): T =>
    has(body, key) ? parse(body[key], key) : fallback;
  const bookingIds = has(body, "bookingIds")
    ? (() => {
        if (!Array.isArray(body.bookingIds)) throw new BadBody("bookingIds must be an array");
        return body.bookingIds.map((v, i) => optionalId(v, `bookingIds[${i}]`)).filter((v): v is string => v != null);
      })()
    : (current?.bookingIds ?? []);
  return {
    date: pick("date", optionalString, current?.date ?? null) ?? "",
    purpose: pick("purpose", optionalString, current?.purpose ?? null) ?? "",
    category: pick("category", optionalString, current?.category ?? null) ?? "shoot",
    stops: pick("stops", optionalString, current?.stops ?? null),
    miles: pick("miles", optionalNumber, current?.miles ?? null) ?? NaN,
    driveMinutes: pick("driveMinutes", optionalNumber, current?.driveMinutes ?? null),
    // Typing the miles in by hand clears "estimated" unless the app says otherwise.
    milesEstimated: pick("milesEstimated", optionalBool, has(body, "miles") ? false : (current?.milesEstimated ?? false)) ?? false,
    notes: pick("notes", optionalString, current?.notes ?? null),
    bookingIds,
  };
}

export function expenseJson(e: Expense, hasReceipt: boolean) {
  return {
    id: e.id,
    date: e.date,
    amount: e.amountCents / 100,
    vendor: e.vendor,
    description: e.description,
    category: e.category,
    deductiblePercent: e.deductiblePercent,
    deductibleAmount: (e.amountCents * e.deductiblePercent) / 10000,
    gallons: e.gallons,
    pricePerGallon: e.pricePerGallon,
    paidPersonally: e.paidPersonally,
    spreadMonths: e.spreadMonths,
    bookingId: e.bookingId,
    tripId: e.tripId,
    receiptNumber: e.receiptNumber,
    notes: e.notes,
    hasReceipt,
    receiptPath: hasReceipt ? `/api/app/v1/finances/expenses/${e.id}/receipt` : null,
    createdAt: e.createdAt,
  };
}
