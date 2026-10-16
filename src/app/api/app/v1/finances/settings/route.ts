import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getFinanceSettings } from "@/lib/finance/ledger";
import { writeFinanceSettings } from "@/lib/finance/writes";
import { badRequest, optionalNumber, readJson, withErrors } from "../../helpers";

/** `{ mpg, otherWagesMonthly }`: the car's MPG and what the other jobs pay a month. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(await getFinanceSettings());
}

/** Either or both of `{ mpg, otherWagesMonthly }`. */
export const PATCH = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const body = await readJson(req);
  const current = await getFinanceSettings();
  const result = await writeFinanceSettings({
    mpg: optionalNumber(body.mpg, "mpg") ?? current.mpg,
    otherWagesMonthly: optionalNumber(body.otherWagesMonthly, "otherWagesMonthly") ?? current.otherWagesMonthly,
  });
  if (result.error) return badRequest(result.error);
  return NextResponse.json({ ok: true, settings: await getFinanceSettings() });
});
