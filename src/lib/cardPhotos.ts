/**
 * How many photos a lead card shows, and which ones.
 *
 * A listing can have thirty photos, and a card has room for a handful, so
 * instead of the first few — which are all exterior shots of the same angle —
 * we sample a spread across the whole set. This lives in a plain module rather
 * than inside AgentLeadCard.tsx because that file is "use client": the JSON API
 * for the iPhone app can't import a value out of it, and a card that sampled
 * differently on the phone than on the web would be exactly the drift this
 * project keeps trying to avoid.
 */
export const CARD_MAX_PHOTOS = 5;

export function sampleCardPhotos(photos: string[]): string[] {
  if (photos.length <= CARD_MAX_PHOTOS) return photos;
  const indexes: number[] = [];
  for (let i = 0; i < CARD_MAX_PHOTOS; i++) {
    indexes.push(Math.round((i * (photos.length - 1)) / (CARD_MAX_PHOTOS - 1)));
  }
  return [...new Set(indexes)].map((i) => photos[i]);
}