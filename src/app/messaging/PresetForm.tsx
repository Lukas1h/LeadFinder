"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MessagePreset, PresetType, MessageChannel } from "@/db/schema";
import { createPreset, updatePreset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_OPTIONS: { value: PresetType; label: string }[] = [
  { value: "initial_outreach", label: "Initial Outreach" },
  { value: "follow_up", label: "Follow-up" },
];

const CHANNEL_OPTIONS: { value: MessageChannel; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
];

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function PresetForm({
  preset,
  defaultType,
  defaultChannel,
  quickActionChoices = [],
  trigger,
}: {
  preset?: MessagePreset;
  defaultType?: PresetType;
  defaultChannel?: MessageChannel;
  /** Templates an SMS preset can offer as quick actions on its messages. */
  quickActionChoices?: { id: string; name: string; channel: MessageChannel }[];
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(preset?.name ?? "");
  const [type, setType] = useState<PresetType>(preset?.type ?? defaultType ?? "initial_outreach");
  const [channel, setChannel] = useState<MessageChannel>(preset?.channel ?? defaultChannel ?? "sms");
  const [minScore, setMinScore] = useState(preset?.minScore?.toString() ?? "");
  const [leadSection, setLeadSection] = useState(preset?.leadSection ?? "");
  const [comingSoon, setComingSoon] = useState(
    preset?.comingSoon == null ? "any" : preset.comingSoon ? "yes" : "no"
  );
  const [sitting, setSitting] = useState(preset?.sitting == null ? "any" : preset.sitting ? "yes" : "no");
  const [maxScore, setMaxScore] = useState(preset?.maxScore?.toString() ?? "");
  const [minPrice, setMinPrice] = useState(preset?.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(preset?.maxPrice?.toString() ?? "");
  const [maxListingAgeDays, setMaxListingAgeDays] = useState(
    preset?.maxListingAgeDays?.toString() ?? ""
  );
  const [minPhotoCount, setMinPhotoCount] = useState(preset?.minPhotoCount?.toString() ?? "");
  const [maxPhotoCount, setMaxPhotoCount] = useState(preset?.maxPhotoCount?.toString() ?? "");
  const [pitchesListing, setPitchesListing] = useState(preset?.pitchesListing === false ? "agent" : "listing");
  const [secondMessage, setSecondMessage] = useState(preset?.secondMessage ?? "");
  // Kept in the order they were ticked, which is the order the buttons show in.
  const [quickActionIds, setQuickActionIds] = useState<string[]>(preset?.quickActionPresetIds ?? []);
  const [quickActionOnly, setQuickActionOnly] = useState(preset?.quickActionOnly ?? false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!preset;
  const typeIsLocked = isEditing || !!defaultType;
  const channelIsLocked = isEditing || !!defaultChannel;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const criteria = {
      minScore: toNumberOrNull(minScore),
      maxScore: toNumberOrNull(maxScore),
      minPrice: toNumberOrNull(minPrice),
      maxPrice: toNumberOrNull(maxPrice),
      maxListingAgeDays: toNumberOrNull(maxListingAgeDays),
      minPhotoCount: toNumberOrNull(minPhotoCount),
      maxPhotoCount: toNumberOrNull(maxPhotoCount),
      leadSection: leadSection || null,
      comingSoon: comingSoon === "any" ? null : comingSoon === "yes",
      sitting: sitting === "any" ? null : sitting === "yes",
      secondMessage: channel === "sms" ? secondMessage : null,
      quickActionPresetIds: channel === "sms" ? quickActionIds : [],
      quickActionOnly: channel === "sms" && quickActionOnly,
      pitchesListing: pitchesListing === "listing",
    };

    const result = isEditing
      ? await updatePreset(preset.id, { name, ...criteria })
      : await createPreset({ name, type, channel, ...criteria });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Preset updated" : "Preset created");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit preset" : "New preset"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Renaming doesn't affect its send history or variants."
                : "Give it a name you'll recognize later — you'll add 2-3 variants to A/B test next."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quick Turnaround Pitch"
                required
              />
            </div>

            {!typeIsLocked && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preset-type">Used for</Label>
                <Select value={type} onValueChange={(v) => setType(v as PresetType)}>
                  <SelectTrigger id="preset-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!channelIsLocked && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preset-channel">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as MessageChannel)}>
                  <SelectTrigger id="preset-channel" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pitches-listing">This message is about</Label>
              <Select value={pitchesListing} onValueChange={setPitchesListing}>
                <SelectTrigger id="pitches-listing" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="listing">The listing (moves it to the Pipeline)</SelectItem>
                  <SelectItem value="agent">Me (the listing skips the Pipeline)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pick &ldquo;me&rdquo; when the listing is just a reason to reach out, like Backup Option.
              </p>
            </div>

            {channel === "sms" && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="second-message">Second message</Label>
                  <Textarea
                    id="second-message"
                    value={secondMessage}
                    onChange={(e) => setSecondMessage(e.target.value)}
                    rows={2}
                    className="text-sm resize-none"
                    placeholder="Mind if I send over a few samples of my work and a pricing sheet?"
                  />
                  <p className="text-xs text-muted-foreground">Copied when you send, to paste as a second text.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Quick actions</Label>
                  {quickActionChoices.filter((t) => t.id !== preset?.id).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No other templates to offer yet.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {quickActionChoices
                        .filter((t) => t.id !== preset?.id)
                        .map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={quickActionIds.includes(t.id)}
                              onChange={(e) =>
                                setQuickActionIds((ids) =>
                                  e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)
                                )
                              }
                            />
                            {t.name}
                            <span className="text-xs text-muted-foreground">{t.channel === "email" ? "email" : "text"}</span>
                          </label>
                        ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    One-tap buttons on a message sent from this template, in the order ticked.
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 mt-0.5 accent-primary"
                    checked={quickActionOnly}
                    onChange={(e) => setQuickActionOnly(e.target.checked)}
                  />
                  <span>
                    Only a quick action
                    <span className="block text-xs text-muted-foreground">
                      Leave it out of the send dialogs, like the vCard or photo samples.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {channel === "sms" && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <Label className="text-xs text-muted-foreground font-normal">
                  Recommend this preset for listings matching (leave blank for no constraint)
                </Label>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="lead-section" className="text-xs">
                      Leads page section
                    </Label>
                    <Select value={leadSection} onValueChange={setLeadSection}>
                      <SelectTrigger id="lead-section">
                        <SelectValue placeholder="Any section" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="photo">Photo opportunities</SelectItem>
                        <SelectItem value="video">Video opportunities</SelectItem>
                        <SelectItem value="backup">Backup opportunities</SelectItem>
                        <SelectItem value="texted">Texted before</SelectItem>
                        <SelectItem value="unlikely">Unlikely matches</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="coming-soon" className="text-xs">
                      Coming soon
                    </Label>
                    <Select value={comingSoon} onValueChange={setComingSoon}>
                      <SelectTrigger id="coming-soon">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any listing</SelectItem>
                        <SelectItem value="yes">Only coming soon</SelectItem>
                        <SelectItem value="no">Not coming soon</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sitting" className="text-xs">
                      Price cut or on market 30+ days
                    </Label>
                    <Select value={sitting} onValueChange={setSitting}>
                      <SelectTrigger id="sitting">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any listing</SelectItem>
                        <SelectItem value="yes">Only those</SelectItem>
                        <SelectItem value="no">Only fresh ones</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="min-score" className="text-xs">
                      Min photo score
                    </Label>
                    <Input
                      id="min-score"
                      type="number"
                      min={1}
                      max={10}
                      value={minScore}
                      onChange={(e) => setMinScore(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="max-score" className="text-xs">
                      Max photo score
                    </Label>
                    <Input
                      id="max-score"
                      type="number"
                      min={1}
                      max={10}
                      value={maxScore}
                      onChange={(e) => setMaxScore(e.target.value)}
                      placeholder="10"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="min-price" className="text-xs">
                      Min price
                    </Label>
                    <Input
                      id="min-price"
                      type="number"
                      min={0}
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      placeholder="$"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="max-price" className="text-xs">
                      Max price
                    </Label>
                    <Input
                      id="max-price"
                      type="number"
                      min={0}
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      placeholder="$"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label htmlFor="max-age" className="text-xs">
                      Max listing age (days)
                    </Label>
                    <Input
                      id="max-age"
                      type="number"
                      min={0}
                      value={maxListingAgeDays}
                      onChange={(e) => setMaxListingAgeDays(e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="min-photos" className="text-xs">
                      Min # of photos
                    </Label>
                    <Input
                      id="min-photos"
                      type="number"
                      min={0}
                      value={minPhotoCount}
                      onChange={(e) => setMinPhotoCount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="max-photos" className="text-xs">
                      Max # of photos
                    </Label>
                    <Input
                      id="max-photos"
                      type="number"
                      min={0}
                      value={maxPhotoCount}
                      onChange={(e) => setMaxPhotoCount(e.target.value)}
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create preset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
