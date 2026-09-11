"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { UserPlus, Phone, MessageCircle, Mail, History, Pencil } from "lucide-react";
import type { Agent, Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { telUrl, smsUrl } from "@/lib/sms";
import { StatusBadge } from "@/app/badges";
import { ListingModal } from "@/app/ListingModal";
import {
  updateAgentNotes,
  updateAgentContactInfo,
  getAgentSendHistory,
  type AgentSendHistoryItem,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const RESULT_LABELS: Record<AgentSendHistoryItem["result"], string> = {
  pending: "Pending",
  quoted: "Quoted",
  booked: "Booked",
  declined: "Declined",
};

const TYPE_LABELS: Record<AgentSendHistoryItem["type"], string> = {
  initial_outreach: "Initial outreach",
  follow_up: "Follow-up",
};

function SendHistoryRow({ item }: { item: AgentSendHistoryItem }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {item.channel === "email" ? (
        <Mail className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
      ) : (
        <MessageCircle className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          {item.presetName} <span className="text-muted-foreground">· {TYPE_LABELS[item.type]}</span>
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(item.sentAt)}</p>
      </div>
      {item.result !== "pending" && (
        <Badge variant="secondary" className="shrink-0">
          {RESULT_LABELS[item.result]}
        </Badge>
      )}
      {item.respondedAt && item.result === "pending" && (
        <Badge variant="secondary" className="shrink-0">
          Replied
        </Badge>
      )}
    </div>
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

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editName, setEditName] = useState(agent.name ?? "");
  const [editPhone, setEditPhone] = useState(agent.phone ?? "");
  const [editEmail, setEditEmail] = useState(agent.email ?? "");
  const [contactError, setContactError] = useState<string | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);

  const startEditingContact = () => {
    setEditName(agent.name ?? "");
    setEditPhone(agent.phone ?? "");
    setEditEmail(agent.email ?? "");
    setContactError(null);
    setIsEditingContact(true);
  };

  const handleSaveContactInfo = async () => {
    setContactError(null);
    setIsSavingContact(true);
    const result = await updateAgentContactInfo(agent.id, { name: editName, phone: editPhone, email: editEmail });
    setIsSavingContact(false);
    if (result.error) {
      setContactError(result.error);
      return;
    }
    toast.success("Agent updated");
    setIsEditingContact(false);
    router.refresh();
  };

  const [history, setHistory] = useState<AgentSendHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHistoryLoaded(false);
    getAgentSendHistory(agent.id).then((items) => {
      setHistory(items);
      setHistoryLoaded(true);
    });
  }, [open, agent.id]);

  const handleSaveNotes = () => {
    startTransition(async () => {
      await updateAgentNotes(agent.id, notes);
      toast.success("Note saved");
      router.refresh();
    });
  };

  const callHref = telUrl(agent.phone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{agent.name ?? "Unknown name"}</DialogTitle>
          <DialogDescription className="flex flex-col font-mono">
            {agent.phone && <span>{agent.phone}</span>}
            {agent.email && <span>{agent.email}</span>}
          </DialogDescription>
        </DialogHeader>

        {isEditingContact ? (
          <div className="flex flex-col gap-2">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
            <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" />
            <Input
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="Email"
              type="email"
            />
            {contactError && <p className="text-sm text-destructive">{contactError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setIsEditingContact(false)} disabled={isSavingContact}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveContactInfo} disabled={isSavingContact}>
                {isSavingContact ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {callHref && (
              <Button variant="outline" size="sm" asChild>
                <a href={callHref}>
                  <Phone />
                  Call
                </a>
              </Button>
            )}
            {agent.phone && (
              <Button variant="outline" size="sm" asChild>
                <a href={smsUrl(agent.phone, "")}>
                  <MessageCircle />
                  Text
                </a>
              </Button>
            )}
            {agent.email && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/messaging?agent=${agent.id}`}>
                  <Mail />
                  Email
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={startEditingContact}>
              <Pencil />
              Edit
            </Button>
            <Button variant="outline" size="sm" className="ml-auto" asChild>
              <a href={`/api/agents/${agent.id}/vcard`}>
                <UserPlus />
                Save contact
              </a>
            </Button>
          </div>
        )}

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

        {historyLoaded && history.length > 0 && (
          <div className="flex flex-col gap-0.5 border-t pt-3">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <History className="size-3.5" />
              Contact history
            </Label>
            <div className="max-h-40 overflow-y-auto -mx-1 px-1 divide-y divide-border/70">
              {history.map((item) => (
                <SendHistoryRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

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
