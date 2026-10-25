import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioImages, portfolioLinks } from "@/db/schema";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";

const W = 1200;
const H = 630;
// Same diagonal as the page's split: 58% across the top, 42% across the bottom.
const TOP_X = Math.round(W * 0.58);
const BOTTOM_X = Math.round(W * 0.42);
const IMAGE_ID_RE = /^\/api\/portfolio-image\/([0-9a-f-]{36})$/i;

/** An image src as stored in a link's content: an upload (read straight from the table) or a URL. */
async function loadImage(src: string): Promise<Buffer> {
  const upload = IMAGE_ID_RE.exec(src);
  if (upload) {
    const [row] = await db.select({ data: portfolioImages.data }).from(portfolioImages).where(eq(portfolioImages.id, upload[1]));
    if (!row) throw new Error("image not found");
    return row.data;
  }
  const res = await fetch(src.startsWith("/") ? `${PORTFOLIO_ORIGIN}${src}` : src);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * An agent page's link-preview image when it has a before/after: the same
 * diagonal split as the top of the page, at the 1200×630 previews are drawn
 * at. With no separate before, the after is shown dulled on the left, as on
 * the page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  const after = link?.content.beforeAfter ? link.content.afterSrc?.trim() : null;
  if (!after) return new Response("Not found", { status: 404 });
  const before = link!.content.beforeSrc?.trim() || null;

  try {
    const [afterBytes, beforeBytes] = await Promise.all([loadImage(after), before ? loadImage(before) : null]);
    const fit = (b: Buffer) => sharp(b).rotate().resize(W, H, { fit: "cover" });
    const afterImg = await fit(afterBytes).toBuffer();
    let left = fit(beforeBytes ?? afterBytes);
    if (!beforeBytes) left = left.modulate({ brightness: 0.72, saturation: 0.55 }).linear(0.88, 128 * 0.12);
    const mask = Buffer.from(`<svg width="${W}" height="${H}"><polygon points="0,0 ${TOP_X},0 ${BOTTOM_X},${H} 0,${H}" fill="#fff"/></svg>`);
    const leftMasked = await left.composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    const line = Buffer.from(
      `<svg width="${W}" height="${H}"><line x1="${TOP_X}" y1="0" x2="${BOTTOM_X}" y2="${H}" stroke="#ffffff" stroke-width="5"/></svg>`
    );
    const out = await sharp(afterImg)
      .composite([{ input: leftMasked }, { input: line }])
      .jpeg({ quality: 84 })
      .toBuffer();
    return new Response(new Uint8Array(out), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    console.error("agent page og image failed", err);
    return new Response("Couldn't build the image", { status: 502 });
  }
}
