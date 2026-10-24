import { listGalleryMedia } from "@/lib/dropbox";

/** Photos per "Recent listings" card on an agent page. */
const CARD_PHOTOS = 10;

/**
 * Which of a job's delivered photos its agent-page card shows: spread evenly
 * across the whole gallery, starting with its first (the front exterior) —
 * galleries open with the outside shots, so the first few alone never got
 * past the yard. Worked out on every view from the gallery as it is now,
 * the same way by the page and by the photo route that serves them.
 */
export async function listingCardPhotoNames(dropboxFolderLink: string): Promise<string[]> {
  const { photos } = await listGalleryMedia(dropboxFolderLink);
  if (photos.length <= CARD_PHOTOS) return photos.map((p) => p.name);
  const picked = new Set<number>();
  for (let i = 0; i < CARD_PHOTOS; i++) picked.add(Math.round((i * (photos.length - 1)) / (CARD_PHOTOS - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => photos[i].name);
}
