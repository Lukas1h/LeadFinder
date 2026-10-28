import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // This app's own JS/CSS live under /lf/_next, so lukashahn.media (the main
  // site, a separate project) can forward agent pages and their assets here
  // without colliding with its own /_next (Next.js multi-zones). See
  // AGENT_PAGE_ORIGIN in src/lib/siteUrls.ts.
  assetPrefix: "/lf",
  // Default 1MB is too small for email-preset attachment uploads (pricing
  // PDF, portfolio photos) — see uploadPresetAttachment in
  // src/app/messaging/actions.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
