// The photo editor's presets, started from Lukas's EstateHDR test app
// (2026-10-20) and reworked 2026-10-26 to his notes: warmer and brighter
// everywhere, exteriors improved as a whole (2-3 stops) rather than only a
// new sky, windows keep their view instead of going white, no lights on.
// The third preset (Max anti-glare) was dropped; its de-glare lives in
// Bright interior. The emphatic wording ("Overexposed! ...so white they are
// clipping!", "DO NOT OPEN BLINDS") is deliberate: a corrections-only
// rewrite (made after the first port's edits invented views) came back
// dull, and the inventing turned out to come from 2K rendering and
// full-res inputs, not the wording — at the test app's 896px input and
// default output the emphatic prompts edit faithfully (2026-10-21).
// Kept apart from src/lib/photoEdit.ts so the page can list them without
// pulling the Gemini call into the browser.

export interface PhotoPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  /**
   * A fixed brighten/warm/saturate pass run on the model's result
   * (photoEditRequest.ts). Gemini under-delivers on brightness however the
   * prompt words it, and pushing harder in words brought back lit fixtures
   * (2026-10-26), so the extra punch is done in pixels instead. midtones
   * lifts mids without clipping (keeps window views); brightness scales all.
   */
  boost?: { midtones?: number; brightness?: number; saturation: number; warmth: number };
}

export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    id: "bright-interior",
    label: "Bright interior",
    description:
      "Very bright, warm high-key interior, straightened, floor de-glare; windows keep their view, blinds and lights untouched",
    prompt:
      "Professional real estate flambient HDR interior edit:\n" +
      "1. ULTRA-BRIGHT, WARM EXPOSURE: Make the interior exposure an extra +6 stops brighter. Blown-out bright. Overexposed! Walls, ceilings, and whites glowing and clipping. Not a single dim corner or shadowy area left. Flood ceilings, walls, and dark corners with luminous, warm golden-white light — warm and inviting, never cool or grey.\n" +
      "2. VERY VIBRANT AND WARM: Heavily boosted vibrance and saturation in wood, fabrics, plants, and decor, crisp punchy contrast, and a strong warm golden tone through the whole room — magazine-grade, never washed out or neutral.\n" +
      "3. WINDOWS KEEP THEIR VIEW: Do NOT turn windows white. If the original window shows trees, sky, a yard, or a neighboring house, keep that exact view visible — pull its exposure down to match the bright room (window-pull) so it reads clearly. Only a pane that is already pure white in the original stays white, with nothing invented in it.\n" +
      "4. FLOOR ANTI-GLARE: Apply an aggressive polarizer effect to remove harsh white reflections and glare streaks on hardwood/tile floors and counters, restoring the natural grain.\n" +
      "5. Keep all existing furniture, decor, and room layout exactly as they are.",
    boost: { midtones: 3.0, saturation: 1.15, warmth: 0.04 },
  },
  {
    id: "sunset-exterior",
    label: "Sunset exterior",
    description:
      "Whole photo much brighter, warm and vibrant, with a sunset sky; house, landscape and windows unchanged, no lights on",
    prompt:
      "Professional real estate exterior edit. Improve the ENTIRE photo, not just the sky. This is NOT a dusk shoot — no lights come on anywhere.\n" +
      "1. WHOLE-IMAGE EXPOSURE: Raise the exposure of the whole photo by 2–3 stops, like +2.5 EV in Lightroom — house, siding, roof, porch, ground, and trees all obviously brighter than the original, with shadows fully opened up. It reads as a bright daytime listing photo, not an evening one.\n" +
      "2. WARM, VIBRANT, PUNCHY: Warm golden color balance across the whole scene, rich saturated color, crisp contrast and clarity. Lawn, plants, and trees lush, healthy green. Never flat, dull, or grey.\n" +
      "3. SKY: Replace the sky with a vibrant orange-pink sunset glow along the horizon blending into soft wispy blue clouds. Only the sky changes to sunset; the house and yard stay bright daylight.\n" +
      "4. SOFT EVEN LIGHT: Soften harsh midday shadows on the lawn, driveway, and siding so the light is even and flattering.\n" +
      "5. HOUSE AND LANDSCAPE UNCHANGED: Do not change the house or landscaping themselves — same shape, materials, colors, plants, trees, and objects. Never repaint: a black door stays black, grey siding stays grey, brick stays brick. Ground stays the same material: bark, dirt, gravel, mulch, and patchy or dry grass stay exactly that — never pave, never lay new sod, never add shrubs, plants, or paths. Brighten and warm the light only.\n" +
      "6. WINDOWS UNTOUCHED: Every window keeps exactly what it shows in the original — the same dark or reflective glass, blinds, or interior. Never turn a window white, never fill it with a flat color, and never make it glow warm or yellow as if a light were on inside.\n" +
      "7. NO LIGHTS: Every light fixture stays exactly as unlit as in the original. Wall sconces, porch lights, garage lights, lamp posts, landscape lights, and interior lights show no glow, no lit bulb, no halo.\n" +
      "8. STRAIGHTEN GEOMETRY: Straighten all vertical walls, columns, and rooflines so the house stands perfectly upright and level.\n" +
      "9. FINAL CHECK: Before returning, confirm the whole photo is clearly brighter and warmer than the original, no window turned white or glows, no light is on, and the house, ground, and plants are the same as the original — fix anything that isn't.",
    boost: { brightness: 1.22, saturation: 1.25, warmth: 0.05 },
  },
];

export function presetById(id: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.id === id);
}
