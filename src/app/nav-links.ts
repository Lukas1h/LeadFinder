import { Inbox, KanbanSquare, Settings, FlaskConical, Users, Wrench } from "lucide-react";

export const NAV_LINKS = [
  { href: "/", label: "Leads", icon: Inbox },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/presets", label: "Presets", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

// Desktop sidebar only (see AppSidebar) — not in NAV_LINKS since that also
// drives the mobile bottom tab bar, and these are dev-only tools with no
// need to take up a mobile tab slot.
export const DEV_LINKS = [{ href: "/develop", label: "Develop", icon: Wrench }] as const;
