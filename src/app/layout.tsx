import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
import { AppChrome } from "./AppChrome";
import "./globals.css";

// headers() below (to read x-gallery-view) makes every route depend on
// runtime request data at the root, which blocks static-shell
// prerendering app-wide — this is the documented way to opt out of that
// validation at the layout that actually needs it, per Next's own
// guidance for exactly this shape of dependency.
export const instant = false;

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LeadFinder",
  description: "New listing leads",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Lets the header bar (see MobileHeader) paint its own dark background
    // straight through the status bar/notch area instead of iOS reserving
    // an opaque bar above it — the native-app look. Status bar glyphs
    // render white under this style, so anything behind them needs to
    // stay dark (MobileHeader is a fixed dark bar for exactly this).
    statusBarStyle: "black-translucent",
    title: "LeadFinder",
    // Explicit per-device splash images — iOS's manifest-based
    // auto-splash is inconsistent in practice, this is the reliable path.
    // Generated at each iPhone 16 model's exact device pixel size (@3x);
    // 750x1334 covers older/SE-size devices as a fallback.
    startupImage: [
      {
        url: "/splash/splash-1320x2868.png",
        media:
          "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/splash-1290x2796.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/splash-1206x2622.png",
        media:
          "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/splash-1179x2556.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/splash-750x1334.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
    ],
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#111116",
  viewportFit: "cover",
  // Native apps don't let a stray pinch or double-tap zoom the UI.
  userScalable: false,
  maximumScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by src/proxy.ts on any request serving the public /gallery/[token]
  // experience — decided here, server-side, off the same signal proxy.ts
  // itself used, rather than client-side by matching usePathname() against
  // "/gallery/". That client-side version shipped a real bug: a rewrite is
  // invisible to the browser's URL bar, so on gallery.lukashahn.art/<token>
  // usePathname() reports the bare /<token> path, never "/gallery/...", and
  // the admin nav chrome rendered anyway.
  const isGalleryView = (await headers()).get("x-gallery-view") === "1";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased `}
    >
      <body className="bg-black">
        <ServiceWorkerRegistration />
        <TooltipProvider>{isGalleryView ? children : <AppChrome>{children}</AppChrome>}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
