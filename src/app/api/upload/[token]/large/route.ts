import { NextRequest, NextResponse } from "next/server";
import { SESSION_CHUNK_BYTES, uploadSessionAppend, uploadSessionFinish, uploadSessionStart } from "@/lib/dropbox";
import { bookingByUploadToken, safeRelativePath, uploadFolderFor } from "@/lib/mediaUploads";

/**
 * Files over 150 MB (video, drone clips), which a temporary upload link won't
 * take: a Dropbox concurrent upload session, fed 4 MiB chunks (under Vercel's
 * 4.5 MB body cap) several at a time by the upload page.
 *
 *   POST ?op=start                                  → { sessionId }
 *   PUT  ?session=…&offset=…&close=0|1  (body: chunk) → {}
 *   POST ?op=finish { sessionId, path, size }       → { path, size }
 *
 * Session ids are Dropbox's own unguessable ids; finish forces the path under
 * this job's folder, so a session can only ever land there.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  if (!row) return NextResponse.json({ error: "This upload link isn't valid" }, { status: 404 });
  const op = req.nextUrl.searchParams.get("op");

  try {
    if (op === "start") {
      return NextResponse.json({ sessionId: await uploadSessionStart() }, { headers: NO_STORE });
    }
    if (op === "finish") {
      const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown; path?: unknown; size?: unknown };
      const rel = safeRelativePath(body.path);
      const size = Number(body.size);
      if (typeof body.sessionId !== "string" || !rel || !Number.isSafeInteger(size) || size <= 0) {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
      }
      const folder = await uploadFolderFor(row);
      return NextResponse.json(await uploadSessionFinish(body.sessionId, size, `${folder}/${rel}`), { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    console.error(`upload large: ${op} failed`, err);
    const status = (err as { status?: number }).status;
    // A 4xx from Dropbox (the session expired or lost a chunk) means start the file over, not retry the same call.
    return NextResponse.json({ error: "Dropbox upload failed", restart: status === 409 || status === 404 }, { status: 502, headers: NO_STORE });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  if (!row) return NextResponse.json({ error: "This upload link isn't valid" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("session");
  const offset = Number(sp.get("offset"));
  const close = sp.get("close") === "1";
  if (!sessionId || !Number.isSafeInteger(offset) || offset < 0 || offset % SESSION_CHUNK_BYTES !== 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > SESSION_CHUNK_BYTES) return NextResponse.json({ error: "Bad chunk" }, { status: 400 });

  try {
    await uploadSessionAppend(sessionId, offset, close, body);
    return NextResponse.json({}, { headers: NO_STORE });
  } catch (err) {
    console.error("upload large: append failed", err);
    const status = (err as { status?: number }).status;
    return NextResponse.json({ error: "Dropbox upload failed", restart: status === 409 || status === 404 }, { status: 502, headers: NO_STORE });
  }
}
