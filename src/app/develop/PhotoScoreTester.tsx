"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { runPhotoScoreTest, type PhotoScoreTestResult } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ListingOption {
  id: string;
  address: string | null;
  photoCount: number | null;
}

export function PhotoScoreTester({ listings }: { listings: ListingOption[] }) {
  const [listingId, setListingId] = useState<string>(listings[0]?.id ?? "");
  const [result, setResult] = useState<PhotoScoreTestResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRun = () => {
    if (!listingId) return;
    setResult(null);
    startTransition(async () => {
      const res = await runPhotoScoreTest(listingId);
      setResult(res);
    });
  };

  return (
    <div className="rounded-lg border p-4">
      <h2 className="font-semibold text-foreground mb-1">Photo Rating Test</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Runs the real scorePhotos() rubric against a saved listing&rsquo;s photos — doesn&rsquo;t write
        anything back, so it&rsquo;s safe to re-run while tweaking src/lib/photoScore.ts.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={listingId} onValueChange={setListingId}>
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder="Pick a listing" />
          </SelectTrigger>
          <SelectContent>
            {listings.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.address ?? "(no address)"} — {l.photoCount ?? 0} photos
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleRun} disabled={!listingId || isPending}>
          <Sparkles />
          {isPending ? "Rating…" : "Run AI Rating"}
        </Button>
      </div>

      {result && (
        <div className="mt-4 rounded-lg bg-muted/40 border p-3">
          {result.error && !result.score ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Score: {result.score ?? "—"}/10
              </p>
              {result.reasoning && (
                <p className="text-sm text-muted-foreground mt-1">{result.reasoning}</p>
              )}
            </>
          )}

          {result.photosScored.length > 0 && (
            <div className="flex gap-2 mt-3 overflow-x-auto">
              {result.photosScored.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="h-20 w-28 shrink-0 rounded object-cover"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
