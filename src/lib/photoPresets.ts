// The photo editor's presets, from Lukas's EstateHDR test app (2026-10-20),
// rewritten the same day after they invented views: his asked for "+5 stops"
// and a "bright blue sky and vibrant green foliage" in every window, and the
// model opened closed blinds onto trees and put one in a glass cabinet. These
// ask only for corrections to what's already in the photo.
// Kept apart from src/lib/photoEdit.ts so the page can list them without
// pulling the Gemini call into the browser.

export interface PhotoPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    id: "bright-interior",
    label: "Bright interior",
    description: "Bright, airy whites, lifted shadows, straight verticals, less glare, balanced windows",
    prompt:
      "Professional real estate interior photo edit, done the way a retoucher would in Lightroom. Corrections only:\n" +
      "1. EXPOSURE: Brighten the room a lot: bright, clean, airy walls and ceilings, lifted shadows and dark corners, while keeping detail in the whites.\n" +
      "2. COLOR: Neutral, slightly warm whites. Remove yellow, blue, or green color casts.\n" +
      "3. PERSPECTIVE: Make vertical lines (walls, door frames, cabinets, window edges) plumb and the horizon level.\n" +
      "4. GLARE: Reduce harsh reflections and glare streaks on floors and counters.\n" +
      "5. WINDOWS: Balance them so they aren't dark, showing only what is already visible through them in the original. " +
      "Blinds, shades, and curtains stay exactly as they are, open or closed. A window that is blown out to pure white in the original STAYS pure white: never put sky, trees, or any view in it.",
  },
  {
    id: "sunset-exterior",
    label: "Sunset exterior",
    description: "Orange-pink sunset sky, bright façade, straight verticals, greener lawn",
    prompt:
      "Professional real estate exterior edit:\n" +
      "1. SKY: Replace the sky with a glowing orange-pink sunset along the horizon blending into soft wispy blue evening clouds. The sky is the only thing that may be replaced.\n" +
      "2. EXPOSURE: Brighten the house exterior so the façade, trim, porch, and driveway are crisp and evenly lit, with no deep shadows.\n" +
      "3. PERSPECTIVE: Straighten vertical walls, columns, and rooflines so the house stands upright and level.\n" +
      "4. LANDSCAPING: Make the existing lawn, plants, and trees a healthier green. Do not add plants or trees. Windows may glow warm, but must not show new rooms, furniture, or lights.",
  },
  {
    id: "max-anti-glare",
    label: "Max anti-glare",
    description: "Strong glare and reflection removal on floors and counters, bright, straight",
    prompt:
      "Professional architectural photo correction, done the way a retoucher would in Lightroom:\n" +
      "1. GLARE: Strongly reduce specular glare and reflections on floors, countertops, and glass tables, restoring the surface texture underneath.\n" +
      "2. EXPOSURE: Brighten the room substantially with clean whites, keeping detail in the whites.\n" +
      "3. PERSPECTIVE: Make vertical lines plumb and horizontal lines level.\n" +
      "4. WINDOWS: Keep them bright, showing only what is visible through them in the original. Blinds and curtains stay as they are. A window blown out to pure white stays pure white: no invented views.",
  },
];

export function presetById(id: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.id === id);
}
