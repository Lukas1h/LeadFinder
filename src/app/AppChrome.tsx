"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { MobileHeader } from "./MobileHeader";
import { BottomTabBar } from "./BottomTabBar";

/**
 * Wraps every page in the internal app's nav chrome (sidebar, mobile
 * header, bottom tab bar) — except /gallery/[token], the one public,
 * client-facing route, which renders with no admin navigation at all. A
 * client opening a gallery link should see their photos, not a sidebar
 * full of Pipeline/Booked/Agents/Messaging/Settings links into the rest of
 * the app. Needs to be a Client Component (usePathname) since layout.tsx
 * itself is a Server Component with no direct access to the current path.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/gallery/")) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <MobileHeader />
        <div className="pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen">{children}</div>
        <BottomTabBar />
      </SidebarInset>
    </SidebarProvider>
  );
}
