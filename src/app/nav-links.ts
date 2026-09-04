import { Inbox, KanbanSquare, Settings, FlaskConical } from "lucide-react";

export const NAV_LINKS = [
  { href: "/", label: "Leads", icon: Inbox },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/presets", label: "Presets", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
