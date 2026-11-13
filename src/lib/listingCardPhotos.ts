import { listGalleryMedia } from "@/lib/dropbox";

/** Photos per "Recent listings" card on an agent page — also the most highlight photos a booking can pick. */
export const CARD_PHOTOS = 10;

/**
 * Which of a job's delivered photos its agent-page card shows: spread evenly
 * across the whole gallery, starting with its first (the front exterior) —
 * galleries open with the outside shots, so the first few alone never got
 * past the yard. Worked out on every view from the gallery as it is now,
 * the same way by the page and by the photo route that serves them.
 *
 * A booking's own pick (bookings.highlight_photos) wins: those photos, in
 * that order, skipping any no longer in the folder. If none of them are
 * left, it falls back to the even spread.
 */
export async function listingCardPhotoNames(dropboxFolderLink: string, highlightPhotos?: string[] | null): Promise<string[]> {
  const { photos } = await listGalleryMedia(dropboxFolderLink);
  if (highlightPhotos?.length) {
    const present = new Set(photos.map((p) => p.name));
    const picked = highlightPhotos.filter((n) => present.has(n));
    if (picked.length) return picked;
  }
  if (photos.length <= CARD_PHOTOS) return photos.map((p) => p.name);
  const picked = new Set<number>();
  for (let i = 0; i < CARD_PHOTOS; i++) picked.add(Math.round((i * (photos.length - 1)) / (CARD_PHOTOS - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => photos[i].name);
}
