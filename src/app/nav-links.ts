import { Inbox, KanbanSquare, CalendarCheck, CalendarDays, Settings, Send, Users, Wrench, ListOrdered } from "lucide-react";

// mobileTab: true puts a link in the mobile bottom tab bar; everything else
// is reached on mobile through the "More" tab (/more), which lists them.
// The desktop sidebar shows every link.
export const NAV_LINKS = [
  { href: "/", label: "Leads", icon: Inbox, mobileTab: true },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, mobileTab: true },
  { href: "/booked", label: "Booked", icon: CalendarCheck, mobileTab: true },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/queue", label: "Queue", icon: ListOrdered },
  { href: "/messaging", label: "Messaging", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Links that live behind the mobile "More" tab. */
export const MORE_LINKS = NAV_LINKS.filter((link) => !("mobileTab" in link && link.mobileTab));

// Desktop sidebar only (see AppSidebar) — not in NAV_LINKS since that also
// drives the mobile bottom tab bar, and these are dev-only tools with no
// need to take up a mobile tab slot.
export const DEV_LINKS = [{ href: "/develop", label: "Develop", icon: Wrench }] as const;
