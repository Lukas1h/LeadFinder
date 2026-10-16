import { db } from "@/db";
import { receipts } from "@/db/schema";
import { eq } from "drizzle-orm";

/** An expense's receipt file, by expense id. Admin-only, like everything under /api (see src/proxy.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [row] = await db.select().from(receipts).where(eq(receipts.expenseId, id));
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${row.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
