import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getEditorListing } from "./actions";
import { PhotoEditor } from "./PhotoEditor";

export default function PhotoEditorPage({ searchParams }: { searchParams: Promise<{ listing?: string; preset?: string }> }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Photo editor</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pick a listing or upload photos, add the ones to edit, and set each one up: a preset, notes, things to remove, straightening and
        crop.
      </p>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <EditorContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EditorContent({ searchParams }: { searchParams: Promise<{ listing?: string; preset?: string }> }) {
  const { listing, preset } = await searchParams;
  const initial = listing && /^[0-9a-f-]{36}$/i.test(listing) ? await getEditorListing(listing) : null;
  return <PhotoEditor key={initial?.id ?? "none"} initialListing={initial} initialPreset={preset ?? null} />;
}
