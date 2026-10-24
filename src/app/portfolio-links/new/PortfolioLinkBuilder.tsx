"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AGENT_PAGE_BA_DEFAULT, AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { createPortfolioLinkAction, searchAgentsForPortfolio, type AgentMatch } from "../actions";

export function PortfolioLinkBuilder() {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentMatch | null>(null);
  const [firstName, setFirstName] = useState("");
  const [area, setArea] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [video, setVideo] = useState("summit");
  const [leadPhoto, setLeadPhoto] = useState("daltonct-25");
  const [showTourOfHomes, setShowTourOfHomes] = useState(true);
  const [showOffer, setShowOffer] = useState(true);
  const [beforeAfter, setBeforeAfter] = useState(false);
  const [beforeSrc, setBeforeSrc] = useState("");
  const [afterSrc, setAfterSrc] = useState("");

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ slug: string; url: string } | null>(null);

  const pickAgent = (a: AgentMatch | null) => {
    setAgent(a);
    if (!a) return;
    setFirstName(a.name?.trim().split(/\s+/)[0] ?? "");
    if (a.homeCity) setArea(a.homeCity);
    setBrokerage(a.brokerage ?? "");
  };

  const create = async () => {
    setCreating(true);
    try {
      const { slug, url } = await createPortfolioLinkAction(agent?.id ?? null, {
        area: area.trim() || null,
        agentFirstName: firstName.trim() || null,
        brokerage: brokerage.trim() || null,
        video,
        leadPhoto,
        showTourOfHomes,
        showOffer,
        beforeAfter,
        beforeSrc: beforeAfter ? beforeSrc.trim() || null : null,
        afterSrc: beforeAfter ? afterSrc.trim() || null : null,
      });
      setResult({ slug, url });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the link");
    } finally {
      setCreating(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border p-6">
        <p className="font-medium">Link ready{agent?.name ? ` for ${agent.name}` : ""}:</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={result.url} className="font-mono text-sm" />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(result.url);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
        </div>
        <Button variant="ghost" onClick={() => router.push("/portfolio-links")}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Who this is for (optional — for your view notifications)</label>
        <AgentPicker value={agent} onChange={pickAgent} />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">First name (sign-off: &quot;Thanks for taking a look, ___&quot; — blank hides it)</label>
        <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Sarah" className="max-w-xs" />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Area (&quot;Real estate photo &amp; video in ___&quot;)</label>
        <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Eugene" className="max-w-xs" />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Brokerage (only in the prefilled &quot;Book a shoot&quot; text)</label>
        <Input value={brokerage} onChange={(e) => setBrokerage(e.target.value)} className="max-w-xs" />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Video</label>
        <select value={video} onChange={(e) => setVideo(e.target.value)} className="h-9 max-w-xs rounded-md border bg-transparent px-3 text-sm">
          {Object.entries(AGENT_PAGE_VIDEOS).map(([key, v]) => (
            <option key={key} value={key}>
              {v.title}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Lead photo (first in the grid)</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {AGENT_PAGE_PHOTOS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setLeadPhoto(p.key)}
              className={`overflow-hidden rounded ${leadPhoto === p.key ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static sample */}
              <img src={p.src} alt={p.alt} className="aspect-[3/2] w-full object-cover" />
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showTourOfHomes} onChange={(e) => setShowTourOfHomes(e.target.checked)} />
          Show &quot;Featured in the Eugene Tour of Homes&quot;
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOffer} onChange={(e) => setShowOffer(e.target.checked)} />
          Show the $50-off first shoot offer
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={beforeAfter} onChange={(e) => setBeforeAfter(e.target.checked)} />
          Before/after at the top
        </label>
      </section>

      {beforeAfter && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <label className="text-sm font-medium">Before photo URL (blank with an after URL = the after photo, dulled)</label>
          <Input value={beforeSrc} onChange={(e) => setBeforeSrc(e.target.value)} placeholder={AGENT_PAGE_BA_DEFAULT.before} />
          <label className="mt-2 text-sm font-medium">After photo URL (both blank = the Hamilton Heights sample)</label>
          <Input value={afterSrc} onChange={(e) => setAfterSrc(e.target.value)} placeholder={AGENT_PAGE_BA_DEFAULT.after} />
        </section>
      )}

      <Button onClick={create} disabled={creating} className="self-start">
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create link
      </Button>
    </div>
  );
}

function AgentPicker({ value, onChange }: { value: AgentMatch | null; onChange: (a: AgentMatch | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AgentMatch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAgentsForPortfolio(query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{value.name ?? value.phone}</span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by name or phone"
        className="pl-8"
      />
      {open && query.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onChange(a);
                }}
              >
                {a.name ?? "Unknown name"} <span className="text-muted-foreground">· {a.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

