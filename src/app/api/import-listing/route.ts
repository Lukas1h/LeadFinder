import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractZpidFromUrl } from "@/lib/zillapi";
import { importListingFromUrl } from "@/app/actions";

// See matching comment in src/app/page.tsx — Hobby plan's real ceiling is
// 300s with Fluid compute, and 60 wasn't leaving enough margin.
export const maxDuration = 300;

// Hit directly by an iOS Shortcut run from the Share Sheet (see the Import
// button's own instructions on the Leads page) — no browser involved, so
// this can't rely on the same-origin/user-gesture protections a page load
// gets. IMPORT_SHARE_SECRET gates it the same way CRON_SECRET gates the
// sync cron route, since a bare public endpoint that spends a Zillapi
// credit per call is worth locking down even for a single-user app.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.IMPORT_SHARE_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  return new URL(req.url).searchParams.get("key") === secret;
}

async function handle(req: NextRequest, url: string | null): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!url) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  const zpid = extractZpidFromUrl(url);
  if (!zpid) {
    return NextResponse.json({ error: "That doesn't look like a Zillow listing URL." }, { status: 400 });
  }

  const [existing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.zpid, zpid));
  if (existing) {
    return NextResponse.json({ status: "exists" });
  }

  // The actual fetch+enrich+score round trip runs in the background —
  // the Shortcut doesn't need to block on it, and a push notification
  // already fires once the listing is actually in (see notifyNewListings),
  // so there's nothing left worth waiting to report back.
  after(() => importListingFromUrl(url));

  return NextResponse.json({ status: "importing" }, { status: 202 });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = body?.url ?? new URL(req.url).searchParams.get("url");
  return handle(req, url);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  return handle(req, url);
}
