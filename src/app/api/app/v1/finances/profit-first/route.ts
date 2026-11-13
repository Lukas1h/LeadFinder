import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getProfitFirstPercents } from "@/lib/finance/ledger";
import { loadProfitFirstReport } from "@/lib/finance/profitFirstReport";
import { writeProfitFirstPercents } from "@/lib/finance/writes";
import { badRequest, optionalNumber, readJson, withErrors } from "../../helpers";

/** The Profit First report: the split, and each window's numbers (lib/finance/profitFirst.ts). */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(await loadProfitFirstReport());
}

/**
 * The split, in percents: `{ profit, ownerPay, tax, opex }`, which have to add
 * up to 100. Anything left out keeps its current value.
 */
export const PATCH = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const body = await readJson(req);
  const current = await getProfitFirstPercents();
  const result = await writeProfitFirstPercents({
    profit: optionalNumber(body.profit, "profit") ?? current.profit,
    ownerPay: optionalNumber(body.ownerPay, "ownerPay") ?? current.ownerPay,
    tax: optionalNumber(body.tax, "tax") ?? current.tax,
    opex: optionalNumber(body.opex, "opex") ?? current.opex,
  });
  if (result.error) return badRequest(result.error);
  revalidatePath("/finances");
  revalidatePath("/finances/profit-first");
  return NextResponse.json({ ok: true });
});
