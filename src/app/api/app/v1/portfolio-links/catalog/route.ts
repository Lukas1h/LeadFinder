import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";

/**
 * The builder's fixed choices: the videos (key → title) and the lead-photo
 * picker (every photo but the last, which always closes the section). Photo
 * `src` is absolute so the app can load it.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json({
    videos: Object.entries(AGENT_PAGE_VIDEOS).map(([key, v]) => ({ key, id: v.id, title: v.title })),
    photos: AGENT_PAGE_PHOTOS.map((p) => ({ key: p.key, alt: p.alt, src: `${PORTFOLIO_ORIGIN}${p.src}` })),
  });
}
