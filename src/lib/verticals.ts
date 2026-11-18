// Other verticals: side niches outside real estate (roofing first,
// 2026-11-18), kept apart from the agent funnel on purpose — see the
// vertical_* tables in src/db/schema.ts. Everything a vertical's page says
// lives here; a link (vertical_links) only adds the company's contact name
// and area. Page: /<path>/<slug> (src/app/roofing/[slug]); admin:
// /verticals/<key>.

import { MAIN_SITE_URL } from "@/lib/siteUrls";
import { LUKAS_PHONE } from "@/lib/agentVcard";

export interface VerticalPhoto {
  src: string;
  alt: string;
}

export interface VerticalConfig {
  key: string;
  /** Sidebar / hub name. */
  label: string;
  /** Public path segment: lukashahn.media/<path>/<slug>. */
  path: string;
  /** Header subtitle under "Hahn Media" and the contact card's title. */
  subtitle: string;
  /** Hero headline; {area} → " in <area>" when the link has one, else nothing. */
  headline: string;
  tagline: string;
  /** Link preview title. */
  ogTitle: string;
  photos: VerticalPhoto[];
  /** Silent looping MP4 + poster, or null for none. */
  video: { mp4: string; poster: string; title: string } | null;
  tiles: { title: string; body: string }[];
  /** Price options, the highlighted one first. */
  packages: { name: string; price: string; unit?: string; badge?: string; perks: string[] }[];
  /** A first-job discount line, or null. */
  offer: string | null;
  /** Under the save button: why they'd want his number later. */
  saveReason: string;
  /** Contact card NOTE. */
  vcardNote: string;
  /** Pre-filled body of the "Text me" sms: link. */
  smsBody: string;
}

// Placeholder photos (aerials and exteriors from the agent page) until Lukas
// sends his drone set for this; then they go in public/vertical/roofing/.
const AP = "/agent-page/";

export const VERTICALS: Record<string, VerticalConfig> = {
  roofing: {
    key: "roofing",
    label: "Roofing",
    path: "roofing",
    subtitle: "Photo, Video & Aerial",
    headline: "Aerial photo & video for roofing companies{area}",
    tagline: "Show off every finished roof from the angle that sells it.",
    ogTitle: "Aerial photo & video for roofers | Hahn Media",
    photos: [
      { src: `${AP}pf-19.jpg`, alt: "Aerial drone view of house in autumn woods with mountains beyond" },
      { src: `${AP}pf-17.jpg`, alt: "Aerial drone view of house and fenced acreage surrounded by autumn woods" },
      { src: `${AP}pf-16.jpg`, alt: "Exterior of sage green ranch house with white garage door and lawn" },
      { src: `${AP}pf-18.jpg`, alt: "Exterior of gray-green house with covered porch and leaf-covered yard" },
      { src: `${AP}pf-15.jpg`, alt: "Exterior of olive-green house with brick chimney and two-car garage" },
      { src: `${AP}pf-20.jpg`, alt: "Covered patio with wood pergola roof, stone columns and fenced garden" },
    ],
    video: null,
    tiles: [
      { title: "Licensed and insured", body: "FAA Part 107 certified drone pilot, fully insured on every job site." },
      { title: "I come to you", body: "I schedule around your crew and shoot as soon as the job wraps." },
      { title: "Edited by hand", body: "Every photo and clip is edited by a real person, not AI." },
      { title: "Yours to use", body: "Use it all on your website, Google profile, social media and ads." },
    ],
    packages: [
      {
        name: "Monthly",
        price: "$1,000",
        unit: "/mo",
        badge: "Best value",
        perks: ["Up to 4 jobs a month ($250 each)", "Aerial + ground photos and a vertical clip per job", "Priority scheduling"],
      },
      {
        name: "Single job",
        price: "$300",
        perks: ["About 25 edited aerial + ground photos", "30–60s vertical video for social"],
      },
    ],
    offer: "$100 off your first job",
    saveReason: "Save my contact for your next finished roof.",
    vcardNote: "Photo\\, video & aerial for roofing and construction. FAA Part 107 certified & insured.",
    smsBody: "Hi Lukas, I saw your page. I'd like to talk about photos for one of our jobs.",
  },
};

export function getVertical(key: string): VerticalConfig | null {
  return Object.hasOwn(VERTICALS, key) ? VERTICALS[key] : null;
}

/** The hero headline with " in <area>" filled in, or dropped when there's no area. */
export function verticalHeadline(v: VerticalConfig, area: string | null | undefined): string {
  const a = area?.trim();
  return v.headline.replace("{area}", a ? ` in ${a}` : "");
}

/** Lukas's contact card as a vertical's page hands it out: Hahn Media, with the vertical's own title and note. */
export function verticalVcard(v: VerticalConfig): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Hahn Photographer;Lukas;;;",
    "FN:Lukas Hahn Photographer",
    "ORG:Hahn Media",
    `TITLE:${v.subtitle.replace(/,/g, "\\,")}`,
    `TEL;TYPE=CELL:${LUKAS_PHONE}`,
    "EMAIL;TYPE=WORK:lukas@lukashahn.media",
    `URL:${MAIN_SITE_URL}`,
    "ADR;TYPE=WORK:;;;Eugene;OR;;USA",
    `NOTE:${v.vcardNote}`,
    "END:VCARD",
  ].join("\r\n");
}
