"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { UserPlus, Phone, PhoneIncoming, MessageCircle, Mail, History, CalendarCheck, Pencil, Trash2, Users } from "lucide-react";
import { getAgentTimeline, type TimelineItem } from "./interactionActions";
import { AddInteractionDialog } from "./AddInteractionDialog";
import type { Agent, AgentRelationshipStatus, Listing } from "@/db/schema";
import { formatDate, formatPrice } from "@/lib/format";
import { telUrl, smsUrl } from "@/lib/sms";
import { ListingRow } from "@/app/ListingRow";
import { FindLinkButton } from "@/app/FindLinkButton";
import { RelationshipBadge } from "@/app/badges";
import { getAgentBookings } from "@/app/booked/actions";
import { BookingRow } from "@/app/booked/BookingRow";
import type { BookingWithDetails } from "@/app/booked/BookedList";
import {
  updateAgentNotes,
  updateAgentContactInfo,
  updateAgentStats,
  deleteAgent,
  findAgentProfileUrl,
  getAgentListings,
} from "./actions";
import { resolveAvgDaysBetweenListings } from "./stats";
import { RELATIONSHIP_OPTIONS } from "./relationshipLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const RESULT_LABELS: Record<string, string> = {
  pending: "Pending",
  quoted: "Quoted",
  booked: "Booked",
  declined: "Declined",
};

const TYPE_LABELS: Record<string, string> = {
  initial_outreach: "Initial outreach",
  follow_up: "Follow-up",
};

// The structured channel/direction/outcome read back as the plain phrasing it
// was entered as.
const OUTCOME_LABELS: Record<string, string> = {
  answered: "answered",
  no_answer: "no answer",
  voicemail: "voicemail",
  sent: "sent",
  not_sent: "not sent",
};

function interactionLabel(item: Extract<TimelineItem, { kind: "interaction" }>): string {
  const outbound = item.direction === "outbound";
  if (item.channel === "call") {
    const base = outbound ? "Called them" : "They called";
    return item.outcome ? `${base} · ${OUTCOME_LABELS[item.outcome]}` : base;
  }
  if (item.channel === "text") {
    const base = outbound ? "Texted them" : "They texted";
    return item.outcome ? `${base} · ${OUTCOME_LABELS[item.outcome]}` : base;
  }
  if (item.channel === "email") return outbound ? "Emailed them" : "They emailed";
  if (item.channel === "in_person") return "Met in person";
  return "Other";
}

function InteractionIcon({ item }: { item: Extract<TimelineItem, { kind: "interaction" }> }) {
  const className = "size-3.5 shrink-0 mt-0.5 text-muted-foreground";
  if (item.channel === "call") {
    return item.direction === "outbound" ? <Phone className={className} /> : <PhoneIncoming className={className} />;
  }
  if (item.channel === "text") return <MessageCircle className={className} />;
  if (item.channel === "email") return <Mail className={className} />;
  return <Users className={className} />;
}

/**
 * Reads as the thing that happened rather than as the template that was used
 * — "Texted them about 37308 Highway 58" — with the preset, phase and date
 * underneath. Same voice as the hand-logged rows below, which matters now
 * that an app-sent text is one row instead of a send stacked on top of its
 * own interaction.
 */
function sendLabel(item: Extract<TimelineItem, { kind: "send" }>): string {
  const verb = item.channel === "email" ? "Emailed them" : "Texted them";
  return item.listingAddress ? `${verb} about ${item.listingAddress}` : verb;
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "send") {
    return (
      <div className="flex items-start gap-2.5 py-1.5">
        {item.channel === "email" ? (
          <Mail className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        ) : (
          <MessageCircle className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{sendLabel(item)}</p>
          {item.note && <p className="text-xs text-muted-foreground mt-0.5">{item.note}</p>}
          <p className="text-xs text-muted-foreground">
            {item.presetName} · {TYPE_LABELS[item.type]} · {formatDate(item.at)}
          </p>
        </div>
        {item.pending ? (
          <Badge variant="secondary" className="shrink-0">
            Unconfirmed
          </Badge>
        ) : item.result !== "pending" ? (
          <Badge variant="secondary" className="shrink-0">
            {RESULT_LABELS[item.result]}
          </Badge>
        ) : (
          item.respondedAt && (
            <Badge variant="secondary" className="shrink-0">
              Replied
            </Badge>
          )
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <InteractionIcon item={item} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{interactionLabel(item)}</p>
        {item.note && <p className="text-xs text-muted-foreground mt-0.5">{item.note}</p>}
        <p className="text-xs text-muted-foreground">
          {formatDate(item.at)}
          {item.listingAddress ? ` · ${item.listingAddress}` : ""}
        </p>
      </div>
      {item.pending && (
        <Badge variant="secondary" className="shrink-0">
          Unconfirmed
        </Badge>
      )}
    </div>
  );
}

export function AgentDetailDialog({
  agent,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  agent: Agent;
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
  const [editStatus, setEditStatus] = useState<AgentRelationshipStatus>(agent.relationshipStatus);
  const [editAvgListingsPerYear, setEditAvgListingsPerYear] = useState(agent.avgListingsPerYear?.toString() ?? "");
  const [editAvgListingPrice, setEditAvgListingPrice] = useState(agent.avgListingPrice?.toString() ?? "");
  const [editAvgDaysBetween, setEditAvgDaysBetween] = useState(agent.avgDaysBetweenListings?.toString() ?? "");
  const [contactError, setContactError] = useState<string | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const startEditingContact = () => {
    setEditName(agent.name ?? "");
    setEditPhone(agent.phone ?? "");
    setEditEmail(agent.email ?? "");
    setEditStatus(agent.relationshipStatus);
    setEditAvgListingsPerYear(agent.avgListingsPerYear?.toString() ?? "");
    setEditAvgListingPrice(agent.avgListingPrice?.toString() ?? "");
    setEditAvgDaysBetween(agent.avgDaysBetweenListings?.toString() ?? "");
    setContactError(null);
    setIsEditingContact(true);
  };

  const handleSaveContactInfo = async () => {
    setContactError(null);
    setIsSavingContact(true);
    const result = await updateAgentContactInfo(agent.id, {
      name: editName,
      phone: editPhone,
      email: editEmail,
      relationshipStatus: editStatus,
    });
    if (result.error) {
      setIsSavingContact(false);
      setContactError(result.error);
      return;
    }
    await updateAgentStats(agent.id, {
      avgListingsPerYear: editAvgListingsPerYear.trim() ? Number(editAvgListingsPerYear) : null,
      avgListingPrice: editAvgListingPrice.trim() ? Number(editAvgListingPrice) : null,
      avgDaysBetweenListings: editAvgDaysBetween.trim() ? Number(editAvgDaysBetween) : null,
    });
    setIsSavingContact(false);
    toast.success("Agent updated");
    setIsEditingContact(false);
    router.refresh();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    await deleteAgent(agent.id);
    setIsDeleting(false);
    toast.success("Agent deleted");
    onOpenChange(false);
    router.refresh();
  };

  const findAgentProfile = async () => {
    const fallback = `https://www.google.com/search?q=${encodeURIComponent(`${agent.name} zillow`)}`;
    return (await findAgentProfileUrl(agent).catch(() => null)) ?? fallback;
  };

  const [history, setHistory] = useState<TimelineItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Bumped after logging an interaction so the timeline refetches in place.
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    setHistoryLoaded(false);
    getAgentTimeline(agent.id).then((items) => {
      setHistory(items);
      setHistoryLoaded(true);
    });
  }, [open, agent.id, historyVersion]);

  // Loaded here rather than handed down from the page: these rows carry the
  // photos array, and prefetching them for every agent just so one dialog can
  // open was the bulk of the Agents page's payload.
  // Keyed by agent rather than paired with a separate loading flag: the flag
  // version needed a synchronous reset on every open, and a slow response for a
  // previously-opened agent could land after this one's and overwrite it.
  const [loaded, setLoaded] = useState<{ agentId: string; items: Listing[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAgentListings(agent.id).then((items) => {
      if (!cancelled) setLoaded({ agentId: agent.id, items });
    });
    return () => {
      cancelled = true;
    };
  }, [open, agent.id]);

  const listingsLoaded = loaded?.agentId === agent.id;
  const listings = listingsLoaded ? loaded.items : [];

  const [agentBookings, setAgentBookings] = useState<BookingWithDetails[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBookingsLoaded(false);
    getAgentBookings(agent.id).then((items) => {
      setAgentBookings(items);
      setBookingsLoaded(true);
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
  const avgDaysBetweenListings = resolveAvgDaysBetweenListings(agent, listings);
  const hasAnyStats = agent.avgListingsPerYear != null || agent.avgListingPrice != null || avgDaysBetweenListings != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {agent.name ?? "Unknown name"}
            <RelationshipBadge status={agent.relationshipStatus} agentName={agent.name} className="shrink-0" />
          </DialogTitle>
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
            <Select value={editStatus} onValueChange={(v) => setEditStatus(v as AgentRelationshipStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                value={editAvgListingsPerYear}
                onChange={(e) => setEditAvgListingsPerYear(e.target.value)}
                placeholder="Avg listings/year"
                type="number"
                min="0"
                className="flex-1"
              />
              <Input
                value={editAvgListingPrice}
                onChange={(e) => setEditAvgListingPrice(e.target.value)}
                placeholder="Avg listing price $"
                type="number"
                min="0"
                className="flex-1"
              />
              <Input
                value={editAvgDaysBetween}
                onChange={(e) => setEditAvgDaysBetween(e.target.value)}
                placeholder="Days between listings"
                type="number"
                min="0"
                className="flex-1"
              />
            </div>
            {contactError && <p className="text-sm text-destructive">{contactError}</p>}
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive mr-auto"
                    disabled={isSavingContact}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {agent.name ?? "this agent"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes their profile, notes, and relationship status for good. Any bookings or messages
                      tied to them keep their own records, just no longer linked to a name. If they still have
                      listings on file, a bare profile for their phone number will reappear next time you open the
                      Agents page.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Keep agent</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                      {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="ghost" size="sm" onClick={() => setIsEditingContact(false)} disabled={isSavingContact}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveContactInfo} disabled={isSavingContact}>
                {isSavingContact ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(callHref || agent.phone || agent.email) && (
              <div className="flex gap-2">
                {callHref && (
                  <Button variant="outline" size="sm" asChild className="flex-1">
                    <a href={callHref}>
                      <Phone />
                      Call
                    </a>
                  </Button>
                )}
                {agent.phone && (
                  <Button variant="outline" size="sm" asChild className="flex-1">
                    <a href={smsUrl(agent.phone, "")}>
                      <MessageCircle />
                      Text
                    </a>
                  </Button>
                )}
                {agent.email && (
                  <Button variant="outline" size="sm" asChild className="flex-1">
                    <Link href={`/messaging?agent=${agent.id}`}>
                      <Mail />
                      Email
                    </Link>
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={startEditingContact}>
                <Pencil />
                Edit
              </Button>
              {agent.name && <FindLinkButton label="profile" initialUrl={agent.realtorProfileUrl} onFind={findAgentProfile} />}
              <Button variant="outline" size="sm" className="ml-auto" asChild>
                <a href={`/api/agents/${agent.id}/vcard`}>
                  <UserPlus />
                  Save contact
                </a>
              </Button>
            </div>
          </div>
        )}

        {hasAnyStats && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm">
            {agent.avgListingsPerYear != null && (
              <span>
                <span className="text-muted-foreground">Avg volume</span> {agent.avgListingsPerYear}/yr
              </span>
            )}
            {agent.avgListingPrice != null && (
              <span>
                <span className="text-muted-foreground">Avg price</span> {formatPrice(agent.avgListingPrice)}
              </span>
            )}
            {avgDaysBetweenListings != null && (
              <span>
                <span className="text-muted-foreground">Avg gap</span> {avgDaysBetweenListings}d
              </span>
            )}
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

        {historyLoaded && (
          <div className="flex flex-col gap-0.5 border-t pt-3">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <History className="size-3.5" />
                Contact history
              </Label>
              <AddInteractionDialog agentId={agent.id} onLogged={() => setHistoryVersion((v) => v + 1)} />
            </div>
            {history.length > 0 ? (
              <div className="max-h-56 overflow-y-auto -mx-1 px-1 divide-y divide-border/70">
                {history.map((item) => (
                  <TimelineRow key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-1.5">Nothing logged yet.</p>
            )}
          </div>
        )}

        {bookingsLoaded && agentBookings.length > 0 && (
          <div className="flex flex-col gap-0.5 border-t pt-3">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <CalendarCheck className="size-3.5" />
              Bookings ({agentBookings.length})
            </Label>
            <div className="flex flex-col max-h-56 overflow-y-auto -mx-1">
              {agentBookings.map((b) => (
                <BookingRow key={b.id} bookingId={b.id} booking={b} />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto -mx-2 border-t pt-3">
          {!listingsLoaded ? (
            <p className="text-sm text-muted-foreground py-4 px-2">Loading listings…</p>
          ) : listings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 px-2">No listings from this agent yet.</p>
          ) : (
            listings.map((l) => <ListingRow key={l.id} listing={l} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
