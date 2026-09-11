"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Mail, Paperclip } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getComposeEmailOptions, sendComposeEmail } from "@/app/composeEmailActions";
import {
  findAgentMatches,
  searchAgentsByName,
  mergeAgentEmail,
  getAgentContactInfo,
  type AgentMatchSummary,
} from "@/app/agents/matchActions";
import type { PresetOption } from "@/app/messageActions";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { formatDate, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_LABELS: Record<PresetType, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow-up",
};

export function ComposeEmailPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  // "" rather than null — keeps the Template Select controlled from the
  // very first render instead of switching from uncontrolled (value=
  // undefined before presets load) to controlled once they do, which
  // otherwise trips React's controlled/uncontrolled warning.
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // False until the user edits Subject/Body directly — while false, both
  // keep re-rendering {{firstName}} live as the Name field is typed, since
  // (unlike the SMS send dialog, which already knows the agent's name from
  // the listing) there's no name to substitute until the user types one.
  const [contentEdited, setContentEdited] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [exactMatch, setExactMatch] = useState<AgentMatchSummary | null>(null);
  const [fuzzyMatches, setFuzzyMatches] = useState<AgentMatchSummary[]>([]);
  const [mergedAgent, setMergedAgent] = useState<{ id: string; name: string | null } | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [confirmAnyway, setConfirmAnyway] = useState(false);

  const [nameSuggestions, setNameSuggestions] = useState<AgentMatchSummary[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = presets.find((p) => p.presetId === selectedPresetId) ?? null;

  function applyTemplate(option: PresetOption | null, currentName: string) {
    setContentEdited(false);
    setSubject(option ? renderSubject(option.subject ?? "", currentName || null) : "");
    setBody(option ? renderMessageBody(option.text, currentName || null, null) : "");
  }

  useEffect(() => {
    getComposeEmailOptions().then(({ presets: options }) => {
      setPresets(options);
      const recommended = options.find((p) => p.recommended) ?? options[0] ?? null;
      setSelectedPresetId(recommended?.presetId ?? "");
      applyTemplate(recommended, "");
      setPresetsLoaded(true);
    });
    // Loads once — Compose always shows every enabled email template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Email" contact button deep link (AgentCard/AgentDetailDialog ->
  // /messaging?agent=<id>) — prefills Name/Email once presets have loaded
  // (so applyTemplate has something to render {{firstName}} into) and runs
  // the normal match check, same as if it'd been typed by hand.
  useEffect(() => {
    const agentId = searchParams.get("agent");
    if (!agentId || !presetsLoaded) return;
    getAgentContactInfo(agentId).then((info) => {
      if (!info) return;
      updateNameAndTemplate(info.name ?? "");
      setEmail(info.email ?? "");
      if (info.name || info.email) {
        findAgentMatches(info.name ?? "", info.email ?? "").then((result) => {
          setExactMatch(result.exactEmailMatch);
          setFuzzyMatches(result.exactEmailMatch ? [] : result.fuzzyMatches);
        });
      }
    });
    // Runs once presets finish loading — not meant to re-fire on every
    // searchParams/selected change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsLoaded]);

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    applyTemplate(presets.find((p) => p.presetId === presetId) ?? null, name);
  };

  // Updates Name + the live {{firstName}} substitution only — no
  // suggestion-search trigger, so this is safe to call from a suggestion
  // pick without immediately reopening the dropdown it was just closed from.
  function updateNameAndTemplate(value: string) {
    setName(value);
    if (!contentEdited) {
      setSubject(selected ? renderSubject(selected.subject ?? "", value || null) : "");
      setBody(selected ? renderMessageBody(selected.text, value || null, null) : "");
    }
  }

  const handleNameChange = (value: string) => {
    updateNameAndTemplate(value);

    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (value.trim().length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      const results = await searchAgentsByName(value);
      setNameSuggestions(results);
      setShowNameSuggestions(results.length > 0);
    }, 200);
  };

  // Clicking a suggestion fires the Name input's onBlur shortly after (its
  // onMouseDown, not onClick, only wins the race against blur starting —
  // blur still eventually runs) — this flag tells handleEmailOrNameBlur to
  // skip its own match-check so it doesn't clobber the match state a
  // selection just set definitively.
  const justSelectedSuggestion = useRef(false);

  async function handleEmailOrNameBlur() {
    // Delay so a suggestion's onMouseDown still fires before this hides the list.
    setTimeout(() => setShowNameSuggestions(false), 150);
    if (justSelectedSuggestion.current) {
      justSelectedSuggestion.current = false;
      return;
    }
    if (!email.trim() && !name.trim()) return;
    const result = await findAgentMatches(name, email);
    setExactMatch(result.exactEmailMatch);
    setFuzzyMatches(result.exactEmailMatch ? [] : result.fuzzyMatches);
    setMergedAgent(null);
    setConfirmAnyway(false);
  }

  function handleSelectSuggestion(agent: AgentMatchSummary) {
    justSelectedSuggestion.current = true;
    setShowNameSuggestions(false);
    updateNameAndTemplate(agent.name ?? "");
    setEmail(agent.email ?? "");
    setFuzzyMatches([]);
    setConfirmAnyway(false);

    if (agent.email) {
      // A real saved email now fills the field — let the normal exact-match
      // check run so the "already contacted" resend-confirm still applies.
      setMergedAgent(null);
      findAgentMatches(agent.name ?? "", agent.email).then((result) => setExactMatch(result.exactEmailMatch));
    } else {
      // No email on file yet — this is a confirmed pick, not a guess, so
      // merge directly instead of showing the fuzzy-match Merge/Keep-separate
      // banner (which would otherwise just be "match" finding itself).
      setExactMatch(null);
      setMergedAgent({ id: agent.id, name: agent.name });
    }
  }

  async function handleMergeClick(candidate: AgentMatchSummary) {
    setIsMerging(true);
    await mergeAgentEmail(candidate.id, name, email);
    setIsMerging(false);
    // Merged for real now (not deferred to send) — reflects as the same
    // "known contact" state an exact email match would produce, carrying
    // over the candidate's real lastContactedAt so the resend-confirm gate
    // below still only fires when they were actually contacted before.
    setExactMatch({ ...candidate, email });
    setFuzzyMatches([]);
    setMergedAgent(null);
    toast.success(`Merged into ${candidate.name}`);
  }

  function resetForm() {
    setName("");
    setEmail("");
    applyTemplate(selected, "");
    setExactMatch(null);
    setFuzzyMatches([]);
    setMergedAgent(null);
    setConfirmAnyway(false);
    setNameSuggestions([]);
    setShowNameSuggestions(false);
    nameRef.current?.focus();
  }

  async function handleSend() {
    if (!selected || !selected.type) return;

    // Only require the extra click when they were actually contacted
    // before — an agent that's merely on file (e.g. just merged, or
    // imported but never messaged) isn't a real double-send risk.
    if (exactMatch?.lastContactedAt && !confirmAnyway) {
      setConfirmAnyway(true);
      return;
    }

    setIsSending(true);
    const result = await sendComposeEmail({
      name,
      email,
      type: selected.type,
      presetId: selected.presetId,
      variantId: selected.variantId,
      subject,
      body,
    });
    setIsSending(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success("Email sent");
    resetForm();
    router.refresh();
  }

  const canSend = !!selected && !!name.trim() && !!email.trim() && !!subject.trim() && !!body.trim() && !isSending;

  return (
    <Card className="p-4 gap-4">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">Compose</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 relative">
          <Label htmlFor="compose-name">Name</Label>
          <Input
            id="compose-name"
            ref={nameRef}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
            onBlur={handleEmailOrNameBlur}
            placeholder="First Last"
            autoComplete="off"
          />
          {showNameSuggestions && (
            <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-border bg-popover shadow-md max-h-56 overflow-y-auto">
              {nameSuggestions.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onMouseDown={() => handleSelectSuggestion(agent)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col gap-0.5"
                >
                  <span className="text-foreground">{agent.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {agent.email ?? formatPhone(agent.phone) ?? "No contact info saved"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="compose-email">Email</Label>
          <Input
            id="compose-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={handleEmailOrNameBlur}
            placeholder="agent@brokerage.com"
          />
        </div>
      </div>

      {exactMatch && (
        <div
          className={
            exactMatch.lastContactedAt
              ? "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
              : "rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
          }
        >
          <p className={exactMatch.lastContactedAt ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
            {exactMatch.lastContactedAt ? (
              <>
                Already contacted <strong>{exactMatch.name ?? "this agent"}</strong> on{" "}
                {formatDate(exactMatch.lastContactedAt)}.
              </>
            ) : (
              <>
                <strong className="text-foreground">{exactMatch.name ?? "This agent"}</strong> is already in your
                agents list — not yet contacted.
              </>
            )}
          </p>
        </div>
      )}

      {!exactMatch && fuzzyMatches.length > 0 && !mergedAgent && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm flex flex-wrap items-center gap-2 justify-between">
          <p className="text-muted-foreground">
            Might be <strong className="text-foreground">{fuzzyMatches[0].name}</strong>
            {fuzzyMatches[0].phone && ` (${fuzzyMatches[0].phone})`} — merge into this agent?
          </p>
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isMerging}
              onClick={() => handleMergeClick(fuzzyMatches[0])}
            >
              {isMerging ? "Merging…" : "Merge"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isMerging} onClick={() => setFuzzyMatches([])}>
              Keep separate
            </Button>
          </div>
        </div>
      )}

      {mergedAgent && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm flex items-center justify-between gap-2">
          <p className="text-muted-foreground">
            Will merge into <strong className="text-foreground">{mergedAgent.name}</strong>.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMergedAgent(null)}>
            Undo
          </Button>
        </div>
      )}

      {presetsLoaded && presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No email templates yet — add one below to start composing.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-preset">Template</Label>
            <Select value={selectedPresetId} onValueChange={handleSelectPreset}>
              <SelectTrigger id="compose-preset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["initial_outreach", "follow_up"] as const).map((type) => {
                  const group = presets.filter((p) => p.type === type);
                  if (group.length === 0) return null;
                  return (
                    <SelectGroup key={type}>
                      <SelectLabel>{TYPE_LABELS[type]}</SelectLabel>
                      {group.map((p) => (
                        <SelectItem key={p.presetId} value={p.presetId}>
                          {p.presetName}
                          {p.recommended && " (Recommended)"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setContentEdited(true);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-body">Body</Label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setContentEdited(true);
              }}
              rows={10}
              className="text-sm"
            />
          </div>
          {selected?.attachments && selected.attachments.length > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <Paperclip className="size-3" />
              Attaching: {selected.attachments.map((a) => a.filename).join(", ")}
            </p>
          )}
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSend} disabled={!canSend}>
          <Mail />
          {isSending ? "Sending…" : confirmAnyway ? "Send anyway" : "Send"}
        </Button>
      </div>
    </Card>
  );
}
