import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses, receipts } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { attachReceipt } from "@/lib/finance/writes";
import { badRequest, isUuid, notFound } from "../../../../helpers";

/** The receipt file itself, with its own Content-Type. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.select().from(receipts).where(eq(receipts.expenseId, id));
  if (!row) return notFound();
  return new Response(new Uint8Array(row.data), {
    headers: { "Content-Type": row.mimeType, "Content-Disposition": `inline; filename="${row.fileName.replace(/"/g, "")}"` },
  });
}

/**
 * Attach or replace the receipt: the raw file as the body (image/jpeg or
 * application/pdf), `?name=` optional. Shrink photos first (about 1800px on
 * the long side): Vercel refuses bodies over 4.5 MB.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [expense] = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, id));
  if (!expense) return notFound();

  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0) return badRequest("The body must be the receipt file");
  const mimeType = req.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const ext = mimeType === "application/pdf" ? "pdf" : "jpg";
  const name = new URL(req.url).searchParams.get("name") || `receipt.${ext}`;
  await attachReceipt(id, { name, mimeType, data });

  const [row] = await db.select({ receiptNumber: expenses.receiptNumber }).from(expenses).where(eq(expenses.id, id));
  return NextResponse.json({ ok: true, receiptNumber: row?.receiptNumber ?? null });
}
