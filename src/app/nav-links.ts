import { Inbox, KanbanSquare, CalendarCheck, Settings, Send, Users, Wrench } from "lucide-react";

export const NAV_LINKS = [
  { href: "/", label: "Leads", icon: Inbox },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/booked", label: "Booked", icon: CalendarCheck },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/messaging", label: "Messaging", icon: Send },
  // Still reachable by URL on mobile — just skips the bottom tab bar (see
  // BottomTabBar's hideOnMobile filter) since it's the least-used tab day
  // to day and the bar is already tight on space at six items.
  { href: "/settings", label: "Settings", icon: Settings, hideOnMobile: true },
] as const;

// Desktop sidebar only (see AppSidebar) — not in NAV_LINKS since that also
// drives the mobile bottom tab bar, and these are dev-only tools with no
// need to take up a mobile tab slot.
export const DEV_LINKS = [{ href: "/develop", label: "Develop", icon: Wrench }] as const;
