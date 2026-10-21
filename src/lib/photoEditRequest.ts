import { z } from "zod";
import { editPhoto, presetById } from "@/lib/photoEdit";

const body = z.object({
  url: z.string().url().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  presetId: z.string().optional(),
  prompt: z.string().max(4000).optional(),
});

/** POST body → one edited photo as `{ image: "data:image/jpeg;base64,…" }`. Shared by the web page and the iPhone app. */
export async function handlePhotoEditRequest(req: Request): Promise<Response> {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { url, data, mimeType, presetId, prompt } = parsed.data;

  const instruction = prompt?.trim() || (presetId ? presetById(presetId)?.prompt : undefined);
  if (!instruction) return Response.json({ error: "Pick a preset or write a prompt" }, { status: 400 });
  const source = url ? { url } : data && mimeType ? { data, mimeType } : null;
  if (!source) return Response.json({ error: "No photo given" }, { status: 400 });

  try {
    const image = await editPhoto(source, instruction);
    return Response.json({ image: `data:${image.mimeType};base64,${image.data}` });
  } catch (error) {
    console.error("photo-editor edit failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Edit failed" }, { status: 502 });
  }
}
