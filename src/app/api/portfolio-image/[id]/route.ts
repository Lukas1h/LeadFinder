import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioImages } from "@/db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A before/after photo uploaded in the agent page builder — public (it's on
 * the agent page), keyed by its unguessable id. Never changes once uploaded.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [image] = await db
    .select({ mimeType: portfolioImages.mimeType, data: portfolioImages.data })
    .from(portfolioImages)
    .where(eq(portfolioImages.id, id));
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(image.data), {
    headers: { "Content-Type": image.mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
