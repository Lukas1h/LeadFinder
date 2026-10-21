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
      "Orange-pink sunset sky, soft even light with no harsh midday shadows, every light stays off, no surface repainted",
    prompt:
      "Professional real estate exterior edit: replace the sky with a sunset and soften the harsh daylight. This is NOT a dusk photo shoot — no lights come on anywhere.\n" +
      "1. SKY: Replace the sky with a vibrant, glowing orange-pink sunset along the horizon blending into soft wispy blue evening clouds. The sky is the only thing that may be replaced.\n" +
      "2. SOFT EVEN LIGHT: Remove all harsh midday sun shadows. Erase the hard-edged shadow patches on the lawn, driveway, siding, and under trees, and relight the whole scene with soft, even, shadowless ambient light, like the minute after the sun has set: the house and yard stay fully visible and bright, lit only by the sky.\n" +
      "3. NO LIGHTS ANYWHERE: Not one light turns on. No warm or yellow glow in any window — every window stays dim and shows exactly what it showed in the original photo (interior, blinds, or at most a faint reflection of the new sky). Porch lights, garage lights, landscape spotlights, path lights, and lamp posts that are off in the original stay off: no new glow, halo, or lit fixture anywhere in the photo.\n" +
      "4. NEVER REPAINT ANY SURFACE: Every surface keeps its exact original color and material. A black front door stays black. A black or dark garage door stays dark. Grey siding stays grey, brick stays brick, stone stays stone. Brighten the lighting only — never whiten, lighten, or recolor any painted or finished surface. This exterior rule overrides the interior high-key brightness standard.\n" +
      "5. STRAIGHTEN GEOMETRY: Straighten all vertical walls, columns, and rooflines so the architecture stands perfectly upright and level.\n" +
      "6. LANDSCAPING: Keep all existing landscaping without inventing new objects, and make existing lawn, plants, and trees lush green. Do not open or alter window blinds or curtains.\n" +
      "7. FINAL CHECK: Before returning the image, verify that no window glows, no fixture is lit, and no surface changed color — if any did, fix it before returning.",
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
