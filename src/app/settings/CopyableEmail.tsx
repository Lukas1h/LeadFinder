"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyableEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <code className="text-sm font-mono flex-1 truncate">{email}</code>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleCopy}>
        {copied ? <Check className="text-green-600" /> : <Copy />}
        <span className="sr-only">Copy</span>
      </Button>
    </div>
  );
}
