import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { listPortfolioTemplates, listTownImages, townsWithoutImages } from "../actions";
import { TemplatesEditor } from "./TemplatesEditor";
import { TownImagesEditor } from "./TownImagesEditor";

/** Settings for agent pages: for now, the photo each town's links preview with. */
export default function PortfolioSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/portfolio-links" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Portfolio links
      </Link>
      <h1 className="mb-1 text-2xl font-semibold">Portfolio settings</h1>
      <h2 className="mt-6 text-lg font-medium">Area templates</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Defaults for new links by city: when the agent&apos;s area is one of a template&apos;s cities, the builder starts with its
        listings, toggles, video and link preview image. Everything stays editable per link.
      </p>
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <Templates />
      </Suspense>
      <h2 className="mt-6 text-lg font-medium">Town preview photos</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The picture a texted link shows when its page has no before/after, matched on the page&apos;s area. A drone shot of
        the town works well. With none set for a town, the lead portfolio photo is used.
      </p>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Towns />
      </Suspense>
    </main>
  );
}

async function Towns() {
  const [images, suggestions] = await Promise.all([listTownImages(), townsWithoutImages()]);
  return <TownImagesEditor images={images} suggestions={suggestions} />;
}

async function Templates() {
  return <TemplatesEditor templates={await listPortfolioTemplates()} />;
}
