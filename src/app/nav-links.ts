import {
  Inbox,
  KanbanSquare,
  CalendarCheck,
  CalendarDays,
  Settings,
  Send,
  Users,
  Wrench,
  ListOrdered,
  HeartHandshake,
} from "lucide-react";

// The desktop sidebar shows every link. Mobile shows MOBILE_TABS instead.
// Agent-first order: finding agents, keeping in touch, then the rest. Pipeline
// is still here but last-ish — the work moved from properties to people.
export const NAV_LINKS = [
  { href: "/", label: "Leads", icon: Inbox },
  { href: "/follow-up", label: "Follow up", icon: HeartHandshake },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/messaging", label: "Messaging", icon: Send },
  { href: "/queue", label: "Queue", icon: ListOrdered },
  { href: "/booked", label: "Booked", icon: CalendarCheck },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type NavLink = (typeof NAV_LINKS)[number];
const link = (href: NavLink["href"]) => NAV_LINKS.find((l) => l.href === href)!;

/**
 * Mobile's bottom tabs, each paired with one less-used page that the mobile
 * header links to from that tab (and back again). The tab stays lit on its
 * paired page, so every page belongs to exactly one tab.
 */
export const MOBILE_TABS: { tab: NavLink; companion: NavLink; also?: NavLink[] }[] = [
  // Pipeline gave its header spot to Follow up, but still belongs to Leads:
  // reached from the link at the bottom of Leads (and import notifications),
  // with the same "‹ Leads" back link as a companion page.
  { tab: link("/"), companion: link("/follow-up"), also: [link("/pipeline")] },
  { tab: link("/booked"), companion: link("/schedule") },
  { tab: link("/messaging"), companion: link("/queue") },
  { tab: link("/agents"), companion: link("/settings") },
];

const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** The mobile tab a page belongs to, and whether it's the tab's paired page. */
export function mobileTabFor(pathname: string) {
  for (const pair of MOBILE_TABS) {
    if (matches(pathname, pair.companion.href) || pair.also?.some((l) => matches(pathname, l.href)))
      return { ...pair, onCompanion: true };
    if (matches(pathname, pair.tab.href)) return { ...pair, onCompanion: false };
  }
  return null;
}

// Desktop sidebar only (see AppSidebar) — not in NAV_LINKS since that also
// drives the mobile bottom tab bar, and these are dev-only tools with no
// need to take up a mobile tab slot.
export const DEV_LINKS = [{ href: "/develop", label: "Develop", icon: Wrench }] as const;
