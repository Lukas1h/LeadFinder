"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardPaste, Search } from "lucide-react";
import type { Agent } from "@/db/schema";
import { saveAgentEmail } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Loose on purpose: picks the address out of whatever got copied, e.g.
// "Email: jane@brokerage.com" off a profile page.
const EMAIL_IN_TEXT = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;

/**
 * For an agent with no email on file — usually one who just replied "sure,
 * send samples" to a text. "Find email" is a real link (iOS PWAs only open a
 * new tab from a genuine <a> tap) to a Google search; copy the address there,
 * close it, and Paste reads the clipboard and saves it in one tap. Typing
 * into the box and pressing Save works too.
 */
export function FindEmailBox({ agent, onSaved }: { agent: Agent; onSaved: (agent: Agent) => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const query = `${agent.name ?? agent.phone ?? ""} realtor email`.trim();

  const save = async (value: string) => {
    setSaving(true);
    const result = await saveAgentEmail(agent.id, value);
    setSaving(false);
    if (result.error || !result.agent) {
      toast.error(result.error ?? "Couldn't save the email");
      return;
    }
    toast.success(`Saved ${result.agent.email}`);
    onSaved(result.agent);
    router.refresh();
  };

  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("Couldn't read the clipboard — paste it into the box instead");
      return;
    }
    const found = text.match(EMAIL_IN_TEXT)?.[0];
    if (!found) {
      toast.error("There's no email on the clipboard");
      return;
    }
    setEmail(found);
    await save(found);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">No email on file</span>
        <Button variant="outline" size="sm" asChild>
          <a href={`https://www.google.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noopener noreferrer">
            <Search />
            Find email
          </a>
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) save(email);
        }}
      >
        <Input
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="Their email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        {email.trim() ? (
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={paste} disabled={saving}>
            <ClipboardPaste />
            Paste
          </Button>
        )}
      </form>
    </div>
  );
}
