"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { linkAgentToListing } from "./agents/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Add agent" prompt for a listing Zillapi returned with no agent info at
 * all — same Dialog+form pattern as ImportAgentForm on the Agents page, but
 * scoped to one listing: saving both creates/reuses the matching Agent row
 * and fills in the listing's own agentName/agentPhone/brokerName columns
 * (see linkAgentToListing), so it shows up everywhere a normal
 * Zillapi-found agent would — AgentRow, the Contact button, etc. — with no
 * page revisit needed.
 */
export function LinkAgentForm({ listingId, trigger }: { listingId: string; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await linkAgentToListing(listingId, { name, phone, email, brokerName });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success("Agent added");
    setName("");
    setPhone("");
    setEmail("");
    setBrokerName("");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add agent</DialogTitle>
            <DialogDescription>No agent came back with this listing — fill in what you know.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-agent-name">Name</Label>
              <Input
                id="link-agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah Nantucket"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-agent-phone">Phone</Label>
                <Input
                  id="link-agent-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-agent-email">Email</Label>
                <Input
                  id="link-agent-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agent@brokerage.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-agent-broker">Brokerage</Label>
              <Input
                id="link-agent-broker"
                value={brokerName}
                onChange={(e) => setBrokerName(e.target.value)}
                placeholder="Optional"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting || !phone.trim()}>
              <UserPlus />
              {isSubmitting ? "Adding…" : "Add agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
