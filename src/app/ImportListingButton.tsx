"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Import } from "lucide-react";
import { importListingsFromUrls } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

function splitUrls(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ImportListingButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const urls = splitUrls(text);

  const handleSubmit = () => {
    if (urls.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await importListingsFromUrls(urls);

      if (result.imported === 0 && result.skipped === 0 && result.failed > 0) {
        setError("Couldn't import any of those — check the links are Zillow listing URLs.");
        return;
      }

      const parts: string[] = [];
      if (result.imported > 0) parts.push(`${result.imported} imported`);
      if (result.skipped > 0) parts.push(`${result.skipped} already had`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      toast.success(parts.join(", ") || "Nothing to import");

      setDialogOpen(false);
      setText("");
      router.refresh();
    });
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) {
          setText("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground">
          <Import />
          Import
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import from Zillow</DialogTitle>
          <DialogDescription>
            Paste one or more Zillow listing links, one per line. Listings you already have are skipped
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Textarea
            autoFocus
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://www.zillow.com/homedetails/...\nhttps://www.zillow.com/homedetails/..."}
          />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending || urls.length === 0}>
            {isPending ? "Importing…" : urls.length > 1 ? `Import ${urls.length}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
