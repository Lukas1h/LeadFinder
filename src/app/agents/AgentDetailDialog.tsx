"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import type { Agent, Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { StatusBadge } from "@/app/badges";
import { ListingModal } from "@/app/ListingModal";
import { updateAgentNotes } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

function ListingRow({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 w-full text-left rounded-lg p-2 hover:bg-muted/50"
      >
        <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
          {listing.photos && listing.photos.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.photos[0]} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[9px] text-muted-foreground text-center px-1">No photo</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {listing.address ?? "Unknown address"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPrice(listing.price)} · {formatDate(listing.listedAt)}
          </p>
        </div>
        <StatusBadge status={listing.status} />
      </button>
      <ListingModal lead={listing} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function AgentDetailDialog({
  agent,
  listings,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  agent: Agent;
  listings: Listing[];
  /** Omit when driving open/onOpenChange from outside (see AgentsList's link-triggered open). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const onOpenChange = onOpenChangeProp ?? setOpenState;

  const [notes, setNotes] = useState(agent.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const dirty = notes !== (agent.notes ?? "");

  const handleSaveNotes = () => {
    startTransition(async () => {
      await updateAgentNotes(agent.id, notes);
      toast.success("Note saved");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{agent.name ?? "Unknown name"}</DialogTitle>
          <DialogDescription className="font-mono">{agent.phone}</DialogDescription>
        </DialogHeader>

        <Button variant="outline" size="sm" className="w-fit" asChild>
          <a href={`/api/agents/${agent.id}/vcard`}>
            <UserPlus />
            Save contact
          </a>
        </Button>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label htmlFor="agent-notes" className="text-xs text-muted-foreground">
            Notes
          </Label>
          <Textarea
            id="agent-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this agent…"
            rows={3}
          />
          {dirty && (
            <Button size="sm" onClick={handleSaveNotes} disabled={isPending} className="self-end">
              {isPending ? "Saving…" : "Save note"}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto -mx-2 border-t pt-3">
          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 px-2">No listings from this agent yet.</p>
          ) : (
            listings.map((l) => <ListingRow key={l.id} listing={l} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
