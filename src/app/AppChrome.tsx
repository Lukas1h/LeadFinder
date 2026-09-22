import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { MobileHeader } from "./MobileHeader";
import { BottomTabBar } from "./BottomTabBar";
import { PendingInteractionPrompt } from "./PendingInteractionPrompt";

/**
 * The internal app's nav chrome — sidebar, mobile header, bottom tab bar.
 * layout.tsx decides server-side (via the x-gallery-view header proxy.ts
 * sets) whether a request gets wrapped in this at all; the public
 * /gallery/[token] route never does, so this component itself doesn't need
 * to know or care what route it's rendering for.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <MobileHeader />
        <div className="pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen">{children}</div>
        <BottomTabBar />
        {/* App-wide: the trip out to the dialer or Messages can return to any page. */}
        <PendingInteractionPrompt />
      </SidebarInset>
    </SidebarProvider>
  );
}
