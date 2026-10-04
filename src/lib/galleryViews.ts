import { db } from "@/db";
import { galleryViews, type GalleryEvent } from "@/db/schema";

/**
 * Logs one gallery open/download for the booking's detail dialog. Takes the
 * request headers rather than reading them itself so callers can grab them
 * up front and run this in after(), off the response's critical path.
 * Never throws — a logging hiccup must not break a client's gallery.
 */
export async function recordGalleryEvent(
  bookingId: string,
  event: GalleryEvent,
  headers: Headers,
  detail?: string
): Promise<void> {
  // Vercel URL-encodes the city header ("Eugene", "San%20Francisco").
  const decode = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  try {
    await db.insert(galleryViews).values({
      bookingId,
      event,
      detail: detail ?? null,
      ip: headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip"),
      city: decode(headers.get("x-vercel-ip-city")),
      region: headers.get("x-vercel-ip-country-region"),
      country: headers.get("x-vercel-ip-country"),
      userAgent: headers.get("user-agent"),
      referer: headers.get("referer"),
    });
  } catch (err) {
    console.error("recordGalleryEvent failed", err);
  }
}

export interface ParsedUserAgent {
  device: string;
  browser: string;
  /** A link-preview fetcher (iMessage, Facebook, Slack…), not a person. */
  isPreview: boolean;
}

/**
 * Just enough user-agent parsing to read "iPhone · Safari" in a list — not a
 * full parser. iMessage's link preview identifies as facebookexternalhit/
 * Twitterbot, so texting a gallery link logs a visit before anyone taps it;
 * those are flagged as previews.
 */
export function parseUserAgent(ua: string | null): ParsedUserAgent {
  if (!ua) return { device: "Unknown device", browser: "Unknown browser", isPreview: false };
  const isPreview = /facebookexternalhit|Facebot|Twitterbot|Slackbot|WhatsApp|TelegramBot|Discordbot|LinkedInBot|Googlebot|bingbot|bot\b|crawler|spider/i.test(ua);

  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Unknown device";

  // Order matters: Edge, Samsung, Chrome-on-iOS and in-app browsers all also
  // claim "Safari"/"Chrome" somewhere in the string.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /CriOS/.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /GSA\//.test(ua)
            ? "Google app"
            : /FBAN|FBAV|Instagram/.test(ua)
              ? "Facebook/Instagram app"
              : /Chrome\//.test(ua)
                ? "Chrome"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : /(iPhone|iPad).*AppleWebKit/.test(ua)
                    ? "In-app browser"
                    : "Unknown browser";

  return { device, browser, isPreview };
}
