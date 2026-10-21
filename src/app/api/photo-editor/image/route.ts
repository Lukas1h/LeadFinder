import { largestPhotoUrl } from "@/lib/photoEdit";

/**
 * A listing photo, from our own origin, for the photo editor's canvas: Zillow
 * and Compass send no CORS headers, so the browser can show their photos but
 * not read the pixels the straighten, crop and markup tools work on. Only
 * their photo hosts, so this isn't an open proxy (and it's behind the login).
 */
const HOSTS = /^(photos\.zillowstatic\.com|(www\.)?compass\.com)$/;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (url.protocol !== "https:" || !HOSTS.test(url.hostname)) return new Response("Not a listing photo", { status: 400 });

  let res = await fetch(largestPhotoUrl(url.toString()));
  if (!res.ok) res = await fetch(url);
  if (!res.ok) return new Response("Couldn't fetch the photo", { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
