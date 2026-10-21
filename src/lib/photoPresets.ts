// The photo editor's presets, from Lukas's EstateHDR test app (2026-10-20).
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
    description: "Very bright, airy whites, straight verticals, floor glare removed, bright windows",
    prompt:
      "Professional real estate flambient HDR edit:\n" +
      "1. ULTRA-BRIGHT EXPOSURE: Make the interior exposure an extra +5 stops brighter, borderline blown out, so whites nearly clip. Flood ceilings, walls, and dark corners with luminous warm-white fill light.\n" +
      "2. STRAIGHTEN GEOMETRY: Make all vertical walls, doorframes, cabinetry, and window edges perfectly plumb and level the horizon, like a tilt-shift architectural lens.\n" +
      "3. SUPER-BRIGHT WINDOWS: Do NOT darken the windows into a dull window-pull. Keep them bright and high-key so they match the room, showing ONLY what is actually outside in the original photo, with a bright blue sky and vibrant green foliage if present.\n" +
      "4. FLOOR ANTI-GLARE: Apply an aggressive polarizer effect to remove harsh reflections and glare streaks on hardwood or tile floors.\n" +
      "5. Keep all existing furniture and room layout intact.",
  },
  {
    id: "sunset-exterior",
    label: "Sunset exterior",
    description: "Orange-pink sunset sky with wispy clouds, bright façade, straight verticals",
    prompt:
      "Professional real estate exterior HDR twilight edit:\n" +
      "1. SKY: Replace a dull sky with a glowing orange-pink sunset along the horizon blending into soft wispy blue evening clouds.\n" +
      "2. BRIGHT EXPOSURE: Brighten the house exterior +3 to +5 stops so the façade, trim, porch, and driveway are crisp and luminous with no dark shadows.\n" +
      "3. STRAIGHTEN GEOMETRY: Straighten all vertical walls, columns, and rooflines so the architecture stands upright and level.\n" +
      "4. GLARE & FOLIAGE: Remove window glare, keep the existing landscaping, and make existing lawn, plants, and trees lush green. Windows may show a warm interior glow, but not new rooms or furniture.",
  },
  {
    id: "max-anti-glare",
    label: "Max anti-glare",
    description: "Straightened, heavy floor and counter glare removal, very bright, bright windows",
    prompt:
      "Professional architectural photo restoration:\n" +
      "1. Make the interior exposure an extra +5 stops brighter, borderline blown out, so whites nearly clip.\n" +
      "2. Straighten all vertical walls, doorframes, and horizontal lines so perspective is square and plumb.\n" +
      "3. Heavy polarizing filter pass: strip out specular glare and reflections from floors, glass tables, and countertops.\n" +
      "4. Bright windows: keep windows bright and high-key, never dark or muddy, showing only the existing outdoor scenery with a bright blue sky and green foliage where applicable.",
  },
];

export function presetById(id: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.id === id);
}
