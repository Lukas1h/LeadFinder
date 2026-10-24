"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** The link as sent to the agent — tracked, unlike the Preview buttons' ?preview=1 copy. */
export function CopyLinkButton({ url }: { url: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }}
    >
      <Copy />
      Copy link
    </Button>
  );
}
