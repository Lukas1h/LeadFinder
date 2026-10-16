import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { readReceiptFile } from "@/lib/finance/writes";
import { badRequest } from "../../../helpers";

/**
 * Read a receipt photo or PDF (the raw file as the body) and return what it
 * says: `{ date, amount, vendor, description, category, gallons,
 * pricePerGallon }`, any of them null. Saves nothing; the app fills its form.
 */
export async function POST(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const data = Buffer.from(await req.arrayBuffer());
  const result = await readReceiptFile(req.headers.get("content-type")?.split(";")[0] || "image/jpeg", data);
  if ("error" in result) return badRequest(result.error);
  return NextResponse.json(result);
}
