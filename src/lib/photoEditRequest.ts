import { z } from "zod";
import { editPhoto, presetById } from "@/lib/photoEdit";

const body = z.object({
  url: z.string().url().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  presetId: z.string().optional(),
  prompt: z.string().max(4000).optional(),
  /** This photo's own notes, added to the preset's prompt. */
  notes: z.string().max(500).optional(),
  /** The same photo with things to remove marked in red, as base64 JPEG. */
  marked: z.string().optional(),
  /** He straightened or cropped it by hand: the model should leave the geometry alone. */
  geometryFixed: z.boolean().optional(),
});

/** POST body → one edited photo as `{ image: "data:image/jpeg;base64,…" }`. Shared by the web page and the iPhone app. */
export async function handlePhotoEditRequest(req: Request): Promise<Response> {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { url, data, mimeType, presetId, prompt, notes, marked, geometryFixed } = parsed.data;

  const base = prompt?.trim() || (presetId ? presetById(presetId)?.prompt : undefined);
  const instruction = base && taskFor(base, { notes: notes?.trim(), marked: Boolean(marked), geometryFixed });
  if (!instruction) return Response.json({ error: "Pick a preset or write a prompt" }, { status: 400 });
  const source = url ? { url } : data && mimeType ? { data, mimeType } : null;
  if (!source) return Response.json({ error: "No photo given" }, { status: 400 });

  try {
    const image = await editPhoto(source, instruction, marked ? { data: marked, mimeType: "image/jpeg" } : undefined);
    return Response.json({ image: `data:${image.mimeType};base64,${image.data}` });
  } catch (error) {
    console.error("photo-editor edit failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Edit failed" }, { status: 502 });
  }
}

/**
 * The preset's prompt plus whatever this one photo needs: his notes, the
 * removal of what he marked in red, and leaving his own straightening alone.
 * It all goes in the Task slot of the verbatim wrapper (photoEdit.ts).
 */
function taskFor(prompt: string, extra: { notes?: string; marked: boolean; geometryFixed?: boolean }): string {
  const parts = [prompt];
  if (extra.notes) parts.push(`NOTES FOR THIS PHOTO (follow these as well): ${extra.notes}`);
  if (extra.marked) {
    parts.push(
      "OBJECT REMOVAL: The second image is the same photo with things circled or scribbled over in red. " +
        "Completely remove every object marked in red from the photo. Where each one was, continue exactly what " +
        "surrounds it (the same wall, floor, carpet, counter, cabinet, lawn, pavement, or sky) with matching texture, " +
        "color, lighting, and perspective, as if the object had never been there. Do NOT hallucinate or invent anything " +
        "behind or in place of a removed object: no new furniture, decor, doors, windows, outlets, vents, plants, or " +
        "patterns. Remove nothing that isn't marked, and leave no red marks in the result."
    );
  }
  if (extra.geometryFixed) {
    parts.push(
      "GEOMETRY ALREADY CORRECTED BY HAND: This photo has already been straightened and cropped. Keep its framing, " +
        "perspective, and every line exactly where it is; do not re-straighten, rotate, warp, or crop it."
    );
  }
  return parts.join("\n\n");
}
