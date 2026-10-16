import { Suspense } from "react";
import { connection } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, receipts } from "@/db/schema";
import { FinanceSkeleton } from "../loading";
import { ExpenseList, type ExpenseRow } from "./ExpenseList";

export default function FinanceExpensesPage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Expenses />
    </Suspense>
  );
}

async function Expenses() {
  await connection();
  const rows = await db
    .select({
      expense: expenses,
      hasReceipt: sql<boolean>`${receipts.id} is not null`,
    })
    .from(expenses)
    .leftJoin(receipts, eq(receipts.expenseId, expenses.id))
    .orderBy(desc(expenses.date), desc(expenses.createdAt));

  const list: ExpenseRow[] = rows.map(({ expense: e, hasReceipt }) => ({
    id: e.id,
    date: e.date,
    amount: e.amountCents / 100,
    vendor: e.vendor,
    description: e.description,
    category: e.category,
    deductiblePercent: e.deductiblePercent,
    gallons: e.gallons,
    pricePerGallon: e.pricePerGallon,
    paidPersonally: e.paidPersonally,
    spreadMonths: e.spreadMonths,
    bookingId: e.bookingId,
    tripId: e.tripId,
    receiptNumber: e.receiptNumber,
    notes: e.notes,
    hasReceipt: Boolean(hasReceipt),
  }));

  return <ExpenseList expenses={list} />;
}
