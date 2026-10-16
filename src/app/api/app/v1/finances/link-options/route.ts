import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { linkOptions } from "@/lib/finance/writes";
import { EXPENSE_CATEGORIES, TRIP_CATEGORIES } from "@/lib/finance/categories";

/**
 * What the expense and trip forms pick from: bookings and trips to link to
 * (newest first), and both category lists with each expense category's usual
 * deduction and hint.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json({
    ...(await linkOptions()),
    expenseCategories: EXPENSE_CATEGORIES,
    tripCategories: TRIP_CATEGORIES,
  });
}
