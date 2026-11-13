// The fixed content of the agent page (src/app/portfolio/[slug]) — Lukas's
// "Hahn Media Agent Page" design. Per-link settings (area, first name, which
// video, listings, …) live in portfolioLinks.content; everything here is the
// same on every page. Photos are static files in public/agent-page/.

const PF = "/agent-page/";

// Lukas's headshot for the agent page's About block and the contact card;
// null until he adds /public/agent-page/lukas.jpg
export const LUKAS_PHOTO: string | null = null;

// id = the YouTube video (original-style pages). mp4/poster = the same video
// re-encoded silent at 1280px on Vercel Blob, played by a bare <video> on
// new-style pages so no YouTube UI ever shows.
export const AGENT_PAGE_VIDEOS = {
  summit: { id: "NVY-MTRMcPA", title: "Summit Sky", mp4: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/summit-W66dQpoAjQ1jYaKOQy86QRpwO0TxWZ.mp4", poster: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/summit-zW9Iy0d3hmmQe2OcnPBTxFIN9s2wj8.jpg" },
  timberline: { id: "pYjeklEaM8U", title: "Timberline Hills", mp4: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/timberline-nREi4HmwNEJbxIRiE3ZQowcqeXtiUa.mp4", poster: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/timberline-qTKDEyEZxyX8fQ3yAhdIpytqo7EycF.jpg" },
  arline: { id: "peNBeuqA410", title: "Arline Way", mp4: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/arline-mFgOKuVrCEIAD77Rf6vSYpvwbBHmOs.mp4", poster: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/arline-YIBbO3tn5Uec4MoY65gxCohklH1zIX.jpg" },
  woodland: { id: "gB_GGJD2IMQ", title: "Woodland Drive", mp4: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/woodland-RfH5ZhC1Ih9dCN2tpuxzMTApBiK4AO.mp4", poster: "https://tlsowjhy8o8pcgzv.public.blob.vercel-storage.com/agent-page/video/woodland-isrkvHloh7bB9Yn9hjKgEqXkCddcmn.jpg" },
} as const;

export type AgentPageVideoKey = keyof typeof AGENT_PAGE_VIDEOS;

export interface AgentPagePhoto {
  key: string;
  src: string;
  alt: string;
}

// Lukas's re-edited set (2026-11-12), in the order he put them on the main
// website. The last one closes the photo section full-width (an aerial reads
// best there), so it stays last; the lead photo moves to the front. Older
// links whose leadPhoto was a retired port-N key just start with the first.
export const AGENT_PAGE_PHOTOS: AgentPagePhoto[] = [
  ["pf-01", "Dining nook with round wood table, woven pendant light and garden windows"],
  ["pf-02", "Living room with black tile fireplace, white sofa and large windows"],
  ["pf-03", "Kitchen with light oak cabinets, navy island and glass globe pendants"],
  ["pf-04", "Kitchen with black cabinets, black island and sliding door to deck"],
  ["pf-10", "Empty peach-walled room with arched window and French doors"],
  ["pf-06", "Empty room with large windows overlooking autumn trees"],
  ["pf-07", "Kitchen counter detail with light wood cabinets and stainless range hood"],
  ["pf-08", "Kitchen sink with black faucet below window of red autumn leaves"],
  ["pf-09", "Bedroom with peach bedding, brass floor lamp and leaning wood mirror"],
  ["pf-05", "Empty living room with vaulted wood-beam ceiling, arched windows and red rug"],
  ["pf-11", "Bathroom with wood vanity, marble counter and glass walk-in shower"],
  ["pf-12", "Empty room with light wood floors and window overlooking a covered deck"],
  ["pf-13", "Open kitchen and dining space with white cabinets, island and ceiling fan"],
  ["pf-14", "Empty bedroom with wood floors and window framing autumn hillside views"],
  ["pf-19", "Aerial drone view of house in autumn woods with mountains beyond"],
  ["pf-16", "Exterior of sage green ranch house with white garage door and lawn"],
  ["pf-20", "Covered patio with wood pergola roof, stone columns and fenced garden"],
  ["pf-18", "Exterior of gray-green house with covered porch and leaf-covered yard"],
  ["pf-15", "Exterior of olive-green house with brick chimney and two-car garage"],
  ["pf-17", "Aerial drone view of house and fenced acreage surrounded by autumn woods"],
].map(([key, alt]) => ({ key, src: `${PF}${key}.jpg`, alt }));

// Douglas County towns; anything else counts as the Eugene side. Used to pick
// which of Lukas's jobs count as "near" an agent when prefilling listings.
const ROSEBURG_AREA = ["roseburg", "sutherlin", "winston", "myrtle creek", "oakland", "glide", "green", "canyonville", "douglas"];

export function agentPageRegion(place: string): "eugene" | "roseburg" {
  return ROSEBURG_AREA.some((c) => place.toLowerCase().includes(c)) ? "roseburg" : "eugene";
}

// Whether an area reads as the Portland metro rather than the Eugene side:
// picks the footer line and the contact card's note and address.
export function isPortlandArea(area: string | null | undefined): boolean {
  return /portland|vancouver|beaverton|hillsboro|gresham|oregon city|lake oswego|tigard|clackamas|happy valley|west linn|tualatin|wilsonville|milwaukie/i.test(
    area ?? ""
  );
}
