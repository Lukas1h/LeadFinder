// The photo editor (src/app/photo-editor): a listing's photos, or uploaded
// ones, re-edited by Gemini's image model with one of Lukas's presets. The
// presets and the wrapping instruction come from his EstateHDR test app
// (2026-10-20), with one addition: in the first test the model filled a
// house's dark windows with a furnished living room and a kitchen that
// weren't there, so every edit is now told not to invent anything.

import { callGeminiImage, fetchImagePart } from "@/lib/gemini";

export { PHOTO_PRESETS, presetById } from "@/lib/photoPresets";

const MODEL = "gemini-3.1-flash-image";

const FAITHFULNESS =
  "NON-NEGOTIABLE: This is an edit of a real property's listing photo, so it must still show the same property.\n" +
  "- Do NOT add, remove, move, or restyle any object, furniture, fixture, outlet, vent, or finish.\n" +
  "- Do NOT invent anything that isn't visible in the original: no new rooms, furniture, or lights seen through windows or doorways, no new trees, buildings, or views outside.\n" +
  "- Do NOT add text, logos, labels, or watermarks.\n" +
  "- Keep the same framing and composition; only correct exposure, color, glare, and perspective.\n" +
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
 * One photo edited with a preset (or a prompt of his own), returned as a 2K
 * JPEG. JPEG rather than the model's default PNG: a 2K PNG is about 8 MB,
 * over what a Vercel function may send back, where the JPEG is about 1.2 MB.
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
      imageConfig: { imageSize: "2K", imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 90 } },
    },
    logLabel: "editPhoto",
  });
  if (!result) throw new Error("The model didn't return an image. Try again.");
  return result;
}
