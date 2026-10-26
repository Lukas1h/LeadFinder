// The photo editor (src/app/photo-editor): a listing's photos, or uploaded
// ones, re-edited by Gemini's image model with one of Lukas's presets.
// Everything that reaches the model matches his EstateHDR test app
// (2026-10-20): the preset prompts (photoPresets.ts) and the wrapping
// instruction below are verbatim, the input is shrunk to the same 896px
// JPEG, and the request carries no extra generation knobs. Earlier ports
// that deviated paid for it: paraphrased prompts came back dull, 2K
// rendering plus full-resolution inputs let the model invent views (the
// hallucinations the corrections-only rewrite tried to fix with words),
// and the Vertex-only imageConfig field 400s on AI Studio keys, which
// sent every edit to the wrong endpoint to die (2026-10-21).

import sharp from "sharp";
import { callGeminiImage, type GeminiImagePart } from "@/lib/gemini";

export { PHOTO_PRESETS, presetById } from "@/lib/photoPresets";

const MODEL = "gemini-3.1-flash-image";

// The test app feeds the model at most 896px at 80% JPEG — the size its
// prompts were tuned against, and several times faster per edit than
// full-resolution photos.
const INPUT_MAX_PX = 896;
const INPUT_JPEG_QUALITY = 80;

/**
 * The wrapping instruction. Started verbatim from the test app; its
 * interior-only rules (+5 stops, blown-out windows go white) moved into the
 * presets on 2026-10-26, because applied to every photo they made exteriors
 * barely change and turned clear windows white.
 */
function instructionFor(prompt: string): string {
  return `Master Architectural & Real Estate Photo Retoucher:
Task:
${prompt}

NON-NEGOTIABLE RETOUCHING STANDARDS:
1. WARM, BRIGHT, PUNCHY: The finished photo is clearly brighter, warmer, and more vibrant than the original: warm golden-white color balance (never cool, blue, or grey), rich color, crisp contrast, open shadows. Never return a photo that looks only slightly changed.
2. WINDOWS STAY AS THEY ARE: Never fill, paint, or replace any window, glass door, or pane with white or any flat color. Whatever a window shows in the original (the view outside, trees, sky, a neighbor's house, blinds, a reflection) stays visible and recognizable; balance its exposure so the view reads clearly. Only a pane that is already pure blown-out white in the original stays white, and nothing is invented inside it.
3. NO LIGHTS TURNED ON: Never turn on or add lights. No glowing windows, lamps, fixtures, or bulbs that are off in the original.
4. DO NOT OPEN BLINDS OR SHADES: Strictly NEVER open, raise, remove, or alter window blinds, slats, shades, shutters, or curtains. If blinds are closed or tilted shut, they MUST stay closed exactly as they are in the original image.
5. AUTOMATIC ARCHITECTURAL STRAIGHTENING: Correct lens distortion and perspective convergence like a professional tilt-shift lens. Make all vertical walls, doorframes, window frames, and cabinet edges 100% plumb/vertical, and level horizontal lines.
6. NOTHING ADDED OR REMOVED: Do NOT add, remove, move, or redesign anything (furniture, decor, the house, plants, trees, landscaping) except objects marked in red for removal. Improve the light and color only.
Return the straightened, bright, warm, vibrant real estate photograph.`;
}

/**
 * The biggest copy of a listing photo its host will hand out. The app stores
 * Zillow's 446px "-p_e" and Compass's 1024px sizes, which are fine for a card
 * and too small to edit: Zillow has the same photo at 1536px, Compass the
 * original upload.
 */
export function largestPhotoUrl(url: string): string {
  if (url.includes("photos.zillowstatic.com")) {
    return url.replace(/-(?:p_[a-z]|cc_ft_\d+|uncropped_scaled_within_\d+_\d+)\.(jpg|jpeg|webp|png)$/i, "-uncropped_scaled_within_1536_1152.jpg");
  }
  if (url.includes("compass.com/m/")) return url.replace(/\/\d+x\d+\.(jpg|jpeg|webp|png)$/i, "/origin.jpg");
  return url;
}

export type PhotoSource = { url: string } | { data: string; mimeType: string };

async function fetchPhotoBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Any source photo → the ≤896px, 80%-quality JPEG the test app always sends. */
async function optimizeForGemini(bytes: Buffer): Promise<GeminiImagePart> {
  const jpeg = await sharp(bytes)
    // Bake in EXIF orientation, like the test app's browser-canvas resize.
    .rotate()
    .resize(INPUT_MAX_PX, INPUT_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: INPUT_JPEG_QUALITY })
    .toBuffer();
  return { inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } };
}

/**
 * One photo edited with a preset (or a prompt of his own). Like the test
 * app, the model is left at its default output (about 1K PNG, ~2 MB as
 * base64 — inside Vercel's response limit): asking for a bigger size or a
 * different format changes how it renders.
 */
export async function editPhoto(
  source: PhotoSource,
  prompt: string,
  /** The same photo with what to remove marked in red; sent second, after the photo itself. */
  marked?: { data: string; mimeType: string }
): Promise<{ mimeType: string; data: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const bytes =
    "url" in source
      ? (await fetchPhotoBytes(largestPhotoUrl(source.url))) ?? (await fetchPhotoBytes(source.url))
      : Buffer.from(source.data, "base64");
  if (!bytes) throw new Error("Couldn't download that photo");

  const image = await optimizeForGemini(bytes);
  const markedImage = marked ? await optimizeForGemini(Buffer.from(marked.data, "base64")) : null;

  const request = {
    model: MODEL,
    apiKey,
    parts: [image, ...(markedImage ? [markedImage] : []), { text: instructionFor(prompt) }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
    logLabel: "editPhoto",
  };
  // The image filter occasionally blocks a good edit (a 200 whose candidate
  // has finishReason IMAGE_RECITATION and no image — watched it happen on the
  // first test after the prompt restore). A second roll of the same request
  // usually clears it, so retry once before giving up.
  let result = await callGeminiImage(request);
  if (!result) result = await callGeminiImage(request);
  if (!result) throw new Error("The model didn't return an image. Try again.");
  return result;
}
