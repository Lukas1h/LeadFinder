import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses, receipts } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { removeExpense, writeExpense } from "@/lib/finance/writes";
import { badRequest, isUuid, notFound, readJson, withErrors } from "../../../helpers";
import { expenseJson, parseExpenseInput } from "../../shared";

async function load(id: string) {
  const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!row) return null;
  const [receipt] = await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.expenseId, id));
  return expenseJson(row, receipt != null);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const expense = await load(id);
  return expense ? NextResponse.json({ expense }) : notFound();
}

/** Change any of the expense's fields; the ones not sent stay as they are. */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [current] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!current) return notFound();
  const result = await writeExpense(id, parseExpenseInput(await readJson(req), current));
  if (result.error) return badRequest(result.error);
  return NextResponse.json({ ok: true, expense: await load(id) });
});

/** Deletes the expense and its receipt. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  await removeExpense(id);
  return NextResponse.json({ ok: true });
}
