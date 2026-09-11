import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
