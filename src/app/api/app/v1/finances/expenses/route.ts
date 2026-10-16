import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, receipts } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { writeExpense } from "@/lib/finance/writes";
import { badRequest, readJson, withErrors } from "../../helpers";
import { expenseJson, parseExpenseInput } from "../shared";

/** Every expense, newest first. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const rows = await db
    .select({ expense: expenses, hasReceipt: sql<boolean>`${receipts.id} is not null` })
    .from(expenses)
    .leftJoin(receipts, eq(receipts.expenseId, expenses.id))
    .orderBy(desc(expenses.date), desc(expenses.createdAt));
  return NextResponse.json({ expenses: rows.map((r) => expenseJson(r.expense, Boolean(r.hasReceipt))) });
}

/**
 * Add an expense: `{ date, amount, description, category, ... }` (see
 * docs/ios-backend-spec.md). The receipt goes up after, with PUT
 * /finances/expenses/:id/receipt.
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const result = await writeExpense(null, parseExpenseInput(await readJson(req)));
  if (result.error) return badRequest(result.error);
  const [row] = await db.select().from(expenses).where(eq(expenses.id, result.id!));
  return NextResponse.json({ ok: true, expense: expenseJson(row, false) });
});
