// The photo editor (src/app/photo-editor): a listing's photos, or uploaded
// ones, re-edited by Gemini's image model with one of Lukas's presets. The
// presets and the wrapping instruction come from his EstateHDR test app
// (2026-10-20), with one addition: in the first test the model filled a
// house's dark windows with a furnished living room and a kitchen that
// weren't there, so every edit is now told not to invent anything (see also
// src/lib/photoPresets.ts).

import { callGeminiImage, fetchImagePart } from "@/lib/gemini";

export { PHOTO_PRESETS, presetById } from "@/lib/photoPresets";

const MODEL = "gemini-3.1-flash-image";

const FAITHFULNESS =
  "NON-NEGOTIABLE: This is a real property's listing photo. The result must be the SAME photo, corrected, not a new picture of a similar room.\n" +
  "- Every object in the result must be in the original, in the same place, with the same shape. Do NOT add, remove, move, or restyle furniture, decor, plants, fixtures, outlets, vents, or finishes.\n" +
  "- Do NOT invent anything not visible in the original: no views, trees, sky, rooms, or lights through windows or doorways; no new reflections.\n" +
  "- A window that is pure white (blown out) in the original stays pure white. Blinds, shades, and curtains stay exactly as they are. Glass cabinet doors, mirrors, and screens keep showing what they show in the original.\n" +
  "- Small objects (counter items, decor, magnets, labels) keep their exact shape, color, and position; don't redraw or tidy them.\n" +
  "- Do NOT change the color of walls, ceilings, cabinets, floors, counters, or furniture. Brighter, yes; a different paint color, no.\n" +
  "- Do NOT add text, logos, labels, or watermarks. Keep the same framing and composition.\n" +
  "Return the edited photograph.";

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

/**
 * One photo edited with a preset (or a prompt of his own), returned as a 1K
 * JPEG. 1K (1195 px) rather than 2K: a third cheaper (about $0.07 a photo
 * against $0.10) and twice as fast, and the listing photos going in are
 * small JPEGs anyway (2026-10-20). JPEG rather than the model's default PNG,
 * which is several times bigger for nothing.
 */
export async function editPhoto(source: PhotoSource, prompt: string): Promise<{ mimeType: string; data: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const image =
    "url" in source
      ? (await fetchImagePart(largestPhotoUrl(source.url))) ?? (await fetchImagePart(source.url))
      : { inlineData: { mimeType: source.mimeType, data: source.data } };
  if (!image) throw new Error("Couldn't download that photo");

  const result = await callGeminiImage({
    model: MODEL,
    apiKey,
    parts: [image, { text: `Master architectural and real estate photo retoucher.\n\nTask:\n${prompt}\n\n${FAITHFULNESS}` }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      // Low, so it edits rather than reimagines.
      temperature: 0.2,
      imageConfig: { imageSize: "1K", imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 90 } },
    },
    logLabel: "editPhoto",
  });
  if (!result) throw new Error("The model didn't return an image. Try again.");
  return result;
}
