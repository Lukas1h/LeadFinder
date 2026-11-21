import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { bookingByUploadToken, recordUploadEvent, uploadRowAddress } from "@/lib/mediaUploads";
import { UploadClient } from "./UploadClient";

// Same reasoning as the gallery page: a fresh navigation from a texted link, nothing to prerender.
export const instant = false;

// The gallery's type pairing (src/app/gallery/[token]/page.tsx).
const notoSerif = Noto_Serif({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-gallery-serif" });
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-gallery-sans" });

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  const address = row ? uploadRowAddress(row) : null;
  return {
    title: address ? `Upload · ${address}` : "Upload",
    robots: { index: false, follow: false },
  };
}

/**
 * A subcontracted shooter's upload page: <GALLERY_ORIGIN>/upload/<token>.
 * Files go straight into the job's Dropbox folder (src/lib/mediaUploads.ts,
 * uploadEngine.ts). Shows only the address and day — nothing else about
 * the job.
 */
export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bookingByUploadToken(token);
  if (!row) notFound();

  const requestHeaders = new Headers(await headers());
  after(() => recordUploadEvent(row.id, "view", requestHeaders));

  const jobDate = row.jobDate
    ? row.jobDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
    : null;

  return (
    <div className={`${notoSerif.variable} ${outfit.variable} min-h-screen bg-white`}>
      <UploadClient
        token={token}
        address={uploadRowAddress(row)}
        jobDate={jobDate}
      />
    </div>
  );
}
