import { NextRequest, NextResponse } from "next/server";
import { listFolderFiles, temporaryUploadLink, TEMP_LINK_MAX_BYTES } from "@/lib/dropbox";
import {
  bookingByUploadToken,
  ensureBookingUploadFolder,
  finishUploadBatch,
  recordUploadProgress,
  safeRelativePath,
  startUploadBatch,
  uploadFolderFor,
} from "@/lib/mediaUploads";

/**
 * The shooter upload page's API (src/app/upload/[token]). The token is the
 * only access control, as with galleries; every path is forced under that
 * job's own Dropbox folder.
 *
 *   GET                          → { files: [{ path, size }] } already in the folder
 *   POST { action: "start", batchId?, files, bytes, skipped } → { batchId }
 *   POST { action: "links", files: [{ path, size }] }         → { links: [url|null] }
 *   POST { action: "progress", batchId, doneFiles, doneBytes, failed } → {}
 *   POST { action: "finish", batchId }                        → {}
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  if (!row) return NextResponse.json({ error: "This upload link isn't valid" }, { status: 404 });
  try {
    // ensure (not just read) so a folder deleted in Dropbox comes back before uploads start.
    const folder = await ensureBookingUploadFolder(row);
    return NextResponse.json({ files: await listFolderFiles(folder) }, { headers: NO_STORE });
  } catch (err) {
    console.error("upload: list failed", err);
    return NextResponse.json({ error: "Couldn't reach Dropbox" }, { status: 502, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  if (!row) return NextResponse.json({ error: "This upload link isn't valid" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const batchId = typeof body.batchId === "string" && /^[0-9a-f-]{36}$/i.test(body.batchId) ? body.batchId : null;

  try {
    switch (body.action) {
      case "start": {
        const id = await startUploadBatch(
          row,
          { batchId, files: Number(body.files), bytes: Number(body.bytes), skipped: Number(body.skipped) },
          req.headers
        );
        return NextResponse.json({ batchId: id }, { headers: NO_STORE });
      }
      case "links": {
        const files = Array.isArray(body.files) ? body.files.slice(0, 25) : [];
        const folder = await uploadFolderFor(row);
        const links = await Promise.all(
          files.map(async (f: { path?: unknown; size?: unknown }) => {
            const rel = safeRelativePath(f?.path);
            if (!rel || Number(f?.size) > TEMP_LINK_MAX_BYTES) return null;
            return temporaryUploadLink(`${folder}/${rel}`);
          })
        );
        return NextResponse.json({ links }, { headers: NO_STORE });
      }
      case "progress": {
        if (!batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });
        const failed = Array.isArray(body.failed)
          ? body.failed.map((f: { path?: unknown; error?: unknown }) => ({ path: String(f?.path ?? ""), error: String(f?.error ?? "") }))
          : [];
        await recordUploadProgress(row, batchId, { doneFiles: Number(body.doneFiles), doneBytes: Number(body.doneBytes), recovered: Number(body.recovered), failed }, req.headers);
        return NextResponse.json({}, { headers: NO_STORE });
      }
      case "finish": {
        if (!batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });
        await finishUploadBatch(row, batchId, req.headers);
        return NextResponse.json({}, { headers: NO_STORE });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error(`upload: ${String(body.action)} failed`, err);
    return NextResponse.json({ error: "Couldn't reach Dropbox" }, { status: 502, headers: NO_STORE });
  }
}
