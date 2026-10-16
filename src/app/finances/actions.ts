"use server";

import { revalidatePath } from "next/cache";
import {
  attachReceipt,
  linkBookingToTrip,
  linkOptions,
  readReceiptFile,
  removeExpense,
  removeTrip,
  routeForStops,
  writeExpense,
  writeFinanceSettings,
  writeTrip,
  type ExpenseInput,
  type LinkOptions,
  type ReadReceipt,
  type TripInput,
} from "@/lib/finance/writes";
import type { RouteEstimate } from "@/lib/finance/route";

// The Finances pages' server actions: src/lib/finance/writes.ts does the
// work, these refresh the pages that show it.

export type { ExpenseInput, LinkOptions, ReadReceipt, TripInput };

function revalidateFinances() {
  revalidatePath("/finances", "layout");
  revalidatePath("/booked");
}

export async function saveTrip(id: string | null, input: TripInput) {
  const result = await writeTrip(id, input);
  revalidateFinances();
  return result;
}

export async function deleteTrip(id: string) {
  await removeTrip(id);
  revalidateFinances();
}

/** Adds a booking to a trip that's already logged (the second job of a two-job day). */
export async function addBookingToTrip(tripId: string, bookingId: string) {
  await linkBookingToTrip(tripId, bookingId);
  revalidateFinances();
}

export async function estimateTripRoute(stops: string[]): Promise<RouteEstimate | { error: string }> {
  return routeForStops(stops);
}

/**
 * Saves an expense and, when one comes with it, its receipt. The form posts
 * FormData: "input" as JSON, "receipt" as the file, "id" when editing.
 */
export async function saveExpense(form: FormData): Promise<{ error?: string; id?: string }> {
  const id = (form.get("id") as string | null) || null;
  const input = JSON.parse(String(form.get("input"))) as ExpenseInput;
  const file = form.get("receipt");

  const result = await writeExpense(id, input);
  if (result.id && file instanceof File && file.size > 0) {
    await attachReceipt(result.id, { name: file.name, mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) });
  }
  revalidateFinances();
  return result;
}

export async function deleteExpense(id: string) {
  await removeExpense(id);
  revalidateFinances();
}

export async function readReceipt(form: FormData): Promise<ReadReceipt | { error: string }> {
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { error: "No receipt attached" };
  return readReceiptFile(file.type, Buffer.from(await file.arrayBuffer()));
}

export async function saveFinanceSettings(input: { mpg: number; otherWagesMonthly: number }) {
  const result = await writeFinanceSettings(input);
  revalidateFinances();
  return result;
}

export async function getLinkOptions(): Promise<LinkOptions> {
  return linkOptions();
}
