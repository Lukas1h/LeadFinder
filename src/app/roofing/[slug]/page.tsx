import type { Metadata, Viewport } from "next";
import { getVertical } from "@/lib/verticals";
import { VerticalPage, verticalMetadata } from "./VerticalPage";

// A fresh navigation from outside the app, same as the agent page.
export const instant = false;

/** White browser chrome instead of the admin app's dark theme color. */
export const viewport: Viewport = { themeColor: "#ffffff" };

const KEY = "roofing";

export async function generateMetadata(): Promise<Metadata> {
  return verticalMetadata(getVertical(KEY)!);
}

/** A roofing company's personal page (src/app/verticals is the admin side). */
export default async function RoofingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  return <VerticalPage vertical={getVertical(KEY)!} slug={slug} previewParam={preview === "1"} />;
}
