import { NextRequest, NextResponse } from "next/server";
import { importListingFromUrl } from "@/app/actions";

export const maxDuration = 60;

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

  const result = await importListingFromUrl(url);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
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
