import { Dropbox } from "dropbox";

let client: Dropbox | undefined;

/**
 * One shared client for the whole process, same caching shape as
 * mailer.ts's transporter — the SDK refreshes its own short-lived access
 * token from DROPBOX_REFRESH_TOKEN automatically on every call
 * (checkAndRefreshAccessToken), so there's no manual OAuth dance here, just
 * the one-time app setup that produced the refresh token itself.
 */
function getClient(): Dropbox {
  if (!client) {
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const clientId = process.env.DROPBOX_APP_KEY;
    const clientSecret = process.env.DROPBOX_APP_SECRET;
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("DROPBOX_REFRESH_TOKEN / DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set");
    }
    client = new Dropbox({ refreshToken, clientId, clientSecret });
  }
  return client;
}

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|heic|heif|webp|gif|tiff?)$/i;

export interface GalleryPhoto {
  name: string;
  pathLower: string;
}

// The thumbnail route (src/app/api/gallery/[token]/thumbnail/route.ts) has
// to re-verify a requested filename against this listing on every single
// photo it serves, so one gallery page view means many calls here in quick
// succession — this short cache collapses those back down to one real
// Dropbox list_folder call per folder per minute instead of one per photo.
interface ListCacheEntry {
  photos: GalleryPhoto[];
  expiresAt: number;
}
const listCache = new Map<string, ListCacheEntry>();
const LIST_CACHE_TTL_MS = 60_000;

/**
 * Lists every photo in the given Dropbox shared-folder link, sorted by
 * filename — naming uploads with a numeric prefix (01-, 02-, ...) is what
 * controls display order, since Dropbox itself has no separate "custom
 * sort" of its own. Only non-recursive listing is supported against a
 * shared link (a Dropbox API limitation, not this code's choice), which is
 * fine here: a client gallery is a flat folder of photos, not nested
 * subfolders.
 */
export async function listGalleryPhotos(sharedLink: string): Promise<GalleryPhoto[]> {
  const cached = listCache.get(sharedLink);
  if (cached && cached.expiresAt > Date.now()) return cached.photos;

  const dbx = getClient();
  const photos: GalleryPhoto[] = [];

  let res = await dbx.filesListFolder({ path: "", shared_link: { url: sharedLink } });
  for (;;) {
    for (const entry of res.result.entries) {
      if (entry[".tag"] !== "file" || !entry.path_lower) continue;
      if (!IMAGE_EXTENSION_RE.test(entry.name)) continue;
      photos.push({ name: entry.name, pathLower: entry.path_lower });
    }
    if (!res.result.has_more) break;
    res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
  }

  photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  listCache.set(sharedLink, { photos, expiresAt: Date.now() + LIST_CACHE_TTL_MS });
  return photos;
}

// w480h320/w960h640 are Dropbox's two 3:2 sizes — real estate photos are
// natively shot 3:2, and requesting one of these directly (instead of a
// 4:3 size CSS-cropped down to 3:2 client-side) gets an actual 3:2 crop
// from Dropbox at full quality for that box, not a wasted/soft one.
export type GalleryThumbnailSize = "w256h256" | "w480h320" | "w640h480" | "w960h640" | "w1024h768" | "w2048h1536";

/**
 * Fetches a rendered JPEG thumbnail for one photo at the given size, via
 * the account's own direct path rather than the shared-link + relative-path
 * form — the folder belongs to this same Dropbox account (the one
 * DROPBOX_REFRESH_TOKEN authenticates as), so a plain path works and skips
 * an extra relative-path calculation.
 */
export async function getGalleryThumbnail(pathLower: string, size: GalleryThumbnailSize): Promise<Buffer> {
  const dbx = getClient();
  const res = await dbx.filesGetThumbnailV2({
    resource: { ".tag": "path", path: pathLower },
    format: { ".tag": "jpeg" },
    size: { ".tag": size },
    mode: { ".tag": "bestfit" },
  });
  // The SDK's return type is a fileBinary/fileBlob union, and which branch
  // actually comes back depends on which fetch/Response implementation is
  // in play at runtime — confirmed by testing: a plain tsx script gets
  // fileBinary, but the same call inside a Next.js route handler gets
  // fileBlob instead. Handle both rather than assuming either.
  if (res.result.fileBinary) return Buffer.from(res.result.fileBinary);
  if (res.result.fileBlob) return Buffer.from(await res.result.fileBlob.arrayBuffer());
  throw new Error("Dropbox thumbnail response had neither fileBinary nor fileBlob");
}

/**
 * The "download everything" link for a gallery — Dropbox itself zips a
 * shared folder on request when the link is hit with dl=1, so there's no
 * server-side zip to build or bandwidth to pay for; this just redirects to
 * Dropbox's own servers doing that work.
 */
export function dropboxZipDownloadUrl(sharedLink: string): string {
  const url = new URL(sharedLink);
  url.searchParams.set("dl", "1");
  return url.toString();
}
