"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Import } from "lucide-react";
import { importListingFromUrl } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function looksLikeZillowUrl(value: string): boolean {
  try {
    return /(^|\.)zillow\.com$/i.test(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
}

export function ImportListingButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const runImport = (url: string) => {
    startTransition(async () => {
      const result = await importListingFromUrl(url);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Listing imported");
      setDialogOpen(false);
      setManualUrl("");
      setError(null);
      router.refresh();
    });
  };

  const handleClick = async () => {
    let clipboardText = "";
    try {
      clipboardText = (await navigator.clipboard.readText()).trim();
    } catch {
      // Clipboard read denied/unsupported (e.g. no permission granted yet) —
      // fall through to the manual-paste dialog below instead of failing.
    }

    if (looksLikeZillowUrl(clipboardText)) {
      runImport(clipboardText);
      return;
    }

    setManualUrl(clipboardText);
    setError(null);
    setDialogOpen(true);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <Button
        variant="ghost"
        className="text-muted-foreground"
        onClick={handleClick}
        disabled={isPending}
      >
        <Import />
        {isPending ? "Importing…" : "Import"}
      </Button>

      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runImport(manualUrl.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Import from Zillow</DialogTitle>
            <DialogDescription>
              Couldn&rsquo;t read a Zillow URL from your clipboard — paste the listing link.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Input
              autoFocus
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://www.zillow.com/homedetails/..."
            />
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending || !manualUrl.trim()}>
              {isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
