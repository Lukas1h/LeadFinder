// The fixed content of the agent page (src/app/portfolio/[slug]) — Lukas's
// "Hahn Media Agent Page" design. Per-link settings (area, first name, which
// video, listings, …) live in portfolioLinks.content; everything here is the
// same on every page. Photos are static files in public/agent-page/.

const PF = "/agent-page/";

export const AGENT_PAGE_VIDEOS = {
  summit: { id: "NVY-MTRMcPA", title: "Summit Sky" },
  timberline: { id: "pYjeklEaM8U", title: "Timberline Hills" },
  arline: { id: "peNBeuqA410", title: "Arline Way" },
  woodland: { id: "gB_GGJD2IMQ", title: "Woodland Drive" },
} as const;

export type AgentPageVideoKey = keyof typeof AGENT_PAGE_VIDEOS;

export interface AgentPagePhoto {
  key: string;
  src: string;
  alt: string;
}

// Strongest first. The last one closes the photo section full-width (an
// aerial reads best there), so it stays last; the lead photo moves to the front.
export const AGENT_PAGE_PHOTOS: AgentPagePhoto[] = [
  ["port-2", "Living room with a black fireplace wall and sectional sofa"],
  ["port-5", "Kitchen with a navy island, quartz counters and wood cabinets"],
  ["port-3", "Single-story home with a white rail fence and rock wall in fall color"],
  ["port-1", "Dining nook with a globe pendant light by the kitchen"],
  ["port-6", "Open kitchen with a center island and stainless appliances"],
  ["port-7", "Living room with an arched window wall and vaulted beam ceiling"],
  ["port-4", "Split-level home with a two-car garage among tall trees"],
  ["port-13", "Bright bedroom with a wood-framed floor mirror"],
  ["port-10", "Empty living room with a corner of picture windows"],
  ["port-12", "Kitchen sink under a window with maple cabinets"],
  ["port-9", "Kids' bedroom with a wooden bunk bed"],
  ["port-11", "Double-vanity bathroom with a glass-front cabinet"],
  ["port-8", "Aerial drone view of a home in forested Oregon hills in fall"],
].map(([key, alt]) => ({ key, src: `${PF}${key}.jpg`, alt }));

// Douglas County towns; anything else counts as the Eugene side. Used to pick
// which of Lukas's jobs count as "near" an agent when prefilling listings.
const ROSEBURG_AREA = ["roseburg", "sutherlin", "winston", "myrtle creek", "oakland", "glide", "green", "canyonville", "douglas"];

export function agentPageRegion(place: string): "eugene" | "roseburg" {
  return ROSEBURG_AREA.some((c) => place.toLowerCase().includes(c)) ? "roseburg" : "eugene";
}
