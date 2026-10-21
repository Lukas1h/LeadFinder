import { z } from "zod";
import { captureHomesProfile } from "@/lib/homesCapture";

const body = z.object({
  html: z.string().min(200),
  url: z.string().url(),
  /** Pin the capture to one agent, for when the name on the page fits more than one of ours. */
  agentId: z.string().uuid().optional(),
});

/**
 * The manual way in: Lukas's Tampermonkey userscript
 * (scripts/userscripts/homes-agent-capture.user.js) posts a homes.com profile
 * page here when he opens one. The daily cron (lib/homesRefresh.ts) does the
 * same for everyone due without him; this is for an agent he wants updated
 * now, or one the cron couldn't tell apart from a namesake.
 */
export async function POST(req: Request) {
  const secret = process.env.HOMES_CAPTURE_SECRET;
  if (!secret || req.headers.get("x-capture-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  return Response.json(await captureHomesProfile(parsed.data));
}
