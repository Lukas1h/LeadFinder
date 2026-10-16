import { loadLedger } from "@/lib/finance/ledger";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { asc } from "drizzle-orm";
import { tripCategoryLabel, expenseCategory } from "@/lib/finance/categories";
import { mileageRate } from "@/lib/finance/tax";

/**
 * The year's mileage log, expenses or income as CSV, for the CPA. Admin-only
 * like everything under /api (see src/proxy.ts).
 */

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const year = url.searchParams.get("year") ?? String(new Date().getFullYear());
  const inYear = (date: string | null) => date?.startsWith(`${year}-`) ?? false;

  let body: string;
  if (kind === "mileage") {
    const ledger = await loadLedger();
    const labels = new Map(ledger.bookings.map((b) => [b.id, b.label]));
    body = csv([
      ["Date", "Business purpose", "Kind", "Stops", "Miles", "Rate", "Deduction", "Jobs"],
      ...ledger.trips
        .filter((t) => inYear(t.date))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => [
          t.date,
          t.purpose,
          tripCategoryLabel(t.category),
          t.stops?.replace(/\n/g, "; "),
          t.miles.toFixed(1),
          mileageRate(t.date).toFixed(3),
          (t.miles * mileageRate(t.date)).toFixed(2),
          t.bookingIds.map((id) => labels.get(id)).join("; "),
        ]),
    ]);
  } else if (kind === "expenses") {
    const rows = await db.select().from(expenses).orderBy(asc(expenses.date));
    body = csv([
      ["Date", "Amount", "Vendor", "Description", "Category", "Deductible %", "Deductible amount", "Receipt #", "Paid personally", "Notes"],
      ...rows
        .filter((e) => inYear(e.date))
        .map((e) => [
          e.date,
          (e.amountCents / 100).toFixed(2),
          e.vendor,
          e.description,
          expenseCategory(e.category).label,
          e.deductiblePercent,
          ((e.amountCents * e.deductiblePercent) / 10000).toFixed(2),
          e.receiptNumber,
          e.paidPersonally ? "TRUE" : "FALSE",
          e.notes,
        ]),
    ]);
  } else if (kind === "income") {
    const ledger = await loadLedger();
    body = csv([
      ["Date", "Amount", "Job"],
      ...ledger.bookings
        .filter((b) => inYear(b.earnedDate))
        .sort((a, b) => a.earnedDate!.localeCompare(b.earnedDate!))
        .map((b) => [b.earnedDate, b.revenue.toFixed(2), b.label]),
    ]);
  } else {
    return new Response("kind must be mileage, expenses or income", { status: 400 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hahn-media-${kind}-${year}.csv"`,
    },
  });
}
