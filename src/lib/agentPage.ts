// The fixed content of the agent page (src/app/portfolio/[slug]) — Lukas's
// "Hahn Media Agent Page" design. Per-link settings (area, first name, which
// video, …) live in portfolioLinks.content; everything here is the same on
// every page. Photos are static files in public/agent-page/.

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

export interface AgentPageListing {
  id: string;
  region: "eugene" | "roseburg";
  status: string;
  price: string;
  beds: number;
  baths: number;
  sqft: string;
  type: string;
  address: string;
  city: string;
  agent: string;
  brokerage: string;
  photos: string[];
}

// Photo keys here; agentPageListings() turns them into URLs.
const LISTINGS: AgentPageListing[] = [
  { id: "larkspur", region: "eugene", status: "Just listed", price: "$689,000", beds: 4, baths: 2.5, sqft: "2,410", type: "Single family", address: "2865 Larkspur Ct", city: "Eugene, OR 97405", agent: "Megan Ross", brokerage: "Willamette Valley Realty", photos: ["daltonct-01", "daltonct-25", "daltonct-26", "daltonct-24", "daltonct-23", "daltonct-30", "daltonct-37"] },
  { id: "alameda", region: "eugene", status: "Just listed", price: "$825,000", beds: 3, baths: 2, sqft: "2,180", type: "Single family", address: "1462 Alameda Heights Dr", city: "Eugene, OR 97405", agent: "Daniel Ortiz", brokerage: "Cascade Home Group", photos: ["alameda-19", "alameda-13", "alameda-22"] },
  { id: "cedar", region: "eugene", status: "Just listed", price: "$549,900", beds: 3, baths: 2, sqft: "1,860", type: "Single family", address: "418 Cedar Ridge Dr", city: "Springfield, OR 97477", agent: "Hannah Lee", brokerage: "McKenzie River Realty", photos: ["wingfoot-02", "wingfoot-09", "wingfoot-13", "wingfoot-17"] },
  { id: "riverbend", region: "roseburg", status: "Just listed", price: "$615,000", beds: 3, baths: 2, sqft: "2,050", type: "Single family", address: "3320 River Bend Ln", city: "Roseburg, OR 97471", agent: "Megan Ross", brokerage: "Willamette Valley Realty", photos: ["southbank-1", "southbank-11", "southbank-17"] },
];

const ROSEBURG = ["roseburg", "sutherlin", "winston", "myrtle creek", "oakland", "glide", "green", "canyonville", "douglas"];

/** Three sample listings, the ones in the agent's own region first; photo keys resolved to URLs. */
export function agentPageListings(area: string): AgentPageListing[] {
  const region = ROSEBURG.some((c) => area.toLowerCase().includes(c)) ? "roseburg" : "eugene";
  return LISTINGS.slice()
    .sort((a, b) => Number(b.region === region) - Number(a.region === region))
    .slice(0, 3)
    .map((l) => ({ ...l, photos: l.photos.map((k) => `${PF}${k}.jpg`) }));
}

export const AGENT_PAGE_BA_DEFAULT = {
  before: `${PF}ba/hamilton-before.jpg`,
  after: `${PF}ba/hamilton-after.jpg`,
};
