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

export const AGENT_PAGE_PHOTOS: AgentPagePhoto[] = [
  ["daltonct-25", "Open-concept living room with sectional sofa and kitchen"],
  ["alameda-13", "Spacious kitchen with island and wood cabinets"],
  ["southbank-17", "Backyard fire pit with Adirondack chairs among tall trees"],
  ["daltonct-01", "Modern single-story home exterior with landscaped yard"],
  ["daltonct-30", "Primary bedroom with soft natural light"],
  ["alameda-22", "Living area with sliding door and mountain views"],
  ["wingfoot-13", "Vaulted living room with sliding glass door"],
  ["daltonct-26", "Living room with black fireplace wall"],
  ["alameda-19", "Open kitchen and living space with valley views"],
  ["southbank-11", "Aerial drone view of a river winding through an Oregon valley"],
].map(([key, alt]) => ({ key, src: `${PF}${key}.jpg`, alt }));

// Douglas County towns; anything else counts as the Eugene side. Used to pick
// which of Lukas's jobs count as "near" an agent when prefilling listings.
const ROSEBURG_AREA = ["roseburg", "sutherlin", "winston", "myrtle creek", "oakland", "glide", "green", "canyonville", "douglas"];

export function agentPageRegion(place: string): "eugene" | "roseburg" {
  return ROSEBURG_AREA.some((c) => place.toLowerCase().includes(c)) ? "roseburg" : "eugene";
}

export const AGENT_PAGE_BA_DEFAULT = {
  before: `${PF}ba/hamilton-before.jpg`,
  after: `${PF}ba/hamilton-after.jpg`,
};
