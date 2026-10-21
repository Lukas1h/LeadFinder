import { apply, solve, warp, type Geometry, type Point, type Solved } from "@/lib/photoGeometry";

/** A red mark drawn on a photo, in source pixels so it follows any later straighten or crop. */
export type Stroke = Point[];

/** The photo's pixels, loaded once: the frame (S) every guide and mark is stored in. */
export interface SourceImage {
  width: number;
  height: number;
  pixels: ImageData;
  /** The same, as something an <img>/<image> can show. */
  url: string;
}

/** Big enough for the 1600px renders below; a 4000px Compass original would just be slow. */
const SOURCE_MAX_PX = 2048;
/** What's sent to the model. The server shrinks it to 896px anyway; this leaves room. */
export const OUTPUT_MAX_PX = 1600;

const cache = new Map<string, Promise<SourceImage>>();

/**
 * A listing photo comes through /api/photo-editor/image (Zillow and Compass
 * send no CORS headers, so the canvas couldn't read it directly), at the
 * biggest size the host has. An upload is already a data URL.
 */
export function loadSource(key: string, src: { url: string } | { data: string; mimeType: string }): Promise<SourceImage> {
  let hit = cache.get(key);
  if (!hit) {
    const url = "url" in src ? `/api/photo-editor/image?url=${encodeURIComponent(src.url)}` : `data:${src.mimeType};base64,${src.data}`;
    hit = new Promise<SourceImage>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, SOURCE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          width: canvas.width,
          height: canvas.height,
          pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
          url: scale === 1 ? url : canvas.toDataURL("image/jpeg", 0.92),
        });
      };
      img.onerror = () => {
        cache.delete(key);
        reject(new Error("Couldn't load that photo"));
      };
      img.src = url;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** The corrected crop as a canvas, at most `maxPx` on its long side. */
export function renderCanvas(source: SourceImage, solved: Solved, maxPx: number): HTMLCanvasElement {
  const { crop } = solved;
  const scale = Math.min(maxPx / Math.max(crop.w, crop.h), 1.5);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(canvas.width, canvas.height);
  warp(source.pixels, solved.M, crop, scale, out);
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Source pixels → output pixels of a render at `scale`. */
export const toOutput = (solved: Solved, scale: number) => (p: Point): Point => {
  const f = apply(solved.M, p);
  return { x: (f.x - solved.crop.x) * scale, y: (f.y - solved.crop.y) * scale };
};

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], map: (p: Point) => Point, width: number) {
  ctx.strokeStyle = "#ff0000";
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const first = map(stroke[0]);
    ctx.moveTo(first.x, first.y);
    for (const p of stroke.slice(1)) {
      const q = map(p);
      ctx.lineTo(q.x, q.y);
    }
    if (stroke.length === 1) ctx.lineTo(first.x + 0.1, first.y);
    ctx.stroke();
  }
}

/** How thick a red mark is: about 0.8% of the photo's long side, like a marker on a print. */
export const markWidth = (longSide: number) => Math.max(3, longSide * 0.008);

export interface Prepared {
  /** The corrected photo, what the model edits. */
  clean: string;
  /** The same with the red marks on it, the model's map of what to remove. Null without marks. */
  marked: string | null;
  width: number;
  height: number;
}

/** What gets sent: the corrected photo, and a marked copy when there are marks. Null if the guides can't be met. */
export function prepare(source: SourceImage, geometry: Geometry, strokes: Stroke[]): Prepared | null {
  const solved = solve(geometry, source.width, source.height);
  if (!solved) return null;
  const canvas = renderCanvas(source, solved, OUTPUT_MAX_PX);
  const clean = canvas.toDataURL("image/jpeg", 0.9);
  let marked: string | null = null;
  if (strokes.length > 0) {
    const scale = canvas.width / solved.crop.w;
    drawStrokes(canvas.getContext("2d")!, strokes, toOutput(solved, scale), markWidth(Math.max(canvas.width, canvas.height)));
    marked = canvas.toDataURL("image/jpeg", 0.9);
  }
  return { clean, marked, width: canvas.width, height: canvas.height };
}
