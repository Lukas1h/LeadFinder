// The photo editor's presets, verbatim from Lukas's EstateHDR test app
// (2026-10-20). The emphatic wording ("Overexposed! ...so white they are
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
}

export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    id: "bright-interior",
    label: "Bright interior",
    description:
      "+5 stops brighter high-key whites, AI straightening, floor de-glare, keeps blinds untouched & blown-out windows pure white",
    prompt:
      "Professional real estate flambient HDR edit:\n" +
      "1. ULTRA-BRIGHT EXPOSURE: Make the interior exposure an extra +5 stops brighter. Like borderline blown out. Overexposed! I want the things to be so white they are clipping! Flood ceilings, walls, and dark corners with ultra-bright, luminous warm-white fill light.\n" +
      "2. DO NOT OPEN BLINDS: Never open, raise, remove, or alter window blinds, shades, shutters, or curtains. If blinds or shades are closed or partially closed, leave them in their exact original position.\n" +
      "3. LEAVE BLOWN-OUT WINDOWS WHITE (ZERO HALLUCINATION): If windows are white and blown out in the original photo, LEAVE THEM WHITE AND BLOWN OUT instead of hallucinating data! Do NOT invent or generate fake trees, skies, or outdoor scenery where the window is pure white. Only enhance outdoor sky/foliage vibrancy if clear outdoor details are already visible in the original photo.\n" +
      "4. STRAIGHTEN GEOMETRY: Automatically straighten all architectural perspective — make all vertical walls, doorframes, cabinetry, and window edges perfectly plumb (90-degree vertical) and level the horizon.\n" +
      "5. FLOOR ANTI-GLARE: Apply an aggressive polarizer effect to completely eliminate harsh white reflections and glare streaks on the hardwood/tile floor.\n" +
      "6. Keep all existing furniture and room layout intact.",
  },
  {
    id: "sunset-exterior",
    label: "Sunset exterior",
    description:
      "Glowing orange-pink sunset with wispy blue clouds, bright overexposed-style façade lift, straightened verticals",
    prompt:
      "Professional real estate exterior HDR twilight edit:\n" +
      "1. SKY: Replace dull exterior sky with a vibrant, glowing orange-pink sunset along the horizon blending seamlessly into soft wispy blue evening clouds.\n" +
      "2. ULTRA-BRIGHT EXPOSURE: Boost the house exterior exposure an extra +3 to +5 stops brighter so the façade, trim, porch, and driveway are ultra-bright, crisp, and luminous with zero dark shadows.\n" +
      "3. STRAIGHTEN GEOMETRY: Straighten all vertical house walls, columns, and rooflines so the architecture stands perfectly upright and level.\n" +
      "4. DO NOT TOUCH BLINDS & LANDSCAPING: Do not open or alter any window blinds or curtains. Keep all existing landscaping without inventing new objects, and make any existing lawn grass, plants, and trees extra vibrant lush green.",
  },
  {
    id: "max-anti-glare",
    label: "Max anti-glare",
    description:
      "AI tilt-shift straightening, aggressive floor polarizer, +5 stop bright lift, leaves blinds closed & white windows untouched",
    prompt:
      "Professional architectural photo restoration:\n" +
      "1. Make the interior exposure an extra +5 stops brighter. Like borderline blown out. Overexposed! I want the things to be so white they are clipping!\n" +
      "2. DO NOT OPEN BLINDS: Keep all window blinds, shades, shutters, and curtains in their exact original state.\n" +
      "3. IF WINDOWS ARE WHITE AND BLOWN OUT, LEAVE THEM THAT WAY INSTEAD OF HALLUCINATING DATA: Never generate fake outdoor trees or sky inside overexposed white windows. Only boost vibrancy on outdoor details that are already clearly visible.\n" +
      "4. Straighten all vertical walls, doorframes, and horizontal lines so perspective is 100% square and plumb.\n" +
      "5. Heavy polarizing filter pass: strip out all specular glare and reflections from floors, glass tables, and countertops.",
  },
];

export function presetById(id: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.id === id);
}
