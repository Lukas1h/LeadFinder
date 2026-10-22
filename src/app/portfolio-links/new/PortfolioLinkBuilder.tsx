"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPortfolioLinkAction,
  getBookingGalleryPhotos,
  searchAgentsForPortfolio,
  searchBookingsForPortfolio,
  type AgentMatch,
  type BookingMatch,
} from "../actions";

const MAX_HOUSES = 4;
const photoThumb = (bookingId: string, name: string) =>
  `/api/portfolio-links/photo?bookingId=${bookingId}&name=${encodeURIComponent(name)}`;

interface House {
  bookingId: string;
  address: string | null;
  city: string | null;
  available: string[];
  selected: Set<string>;
}

export function PortfolioLinkBuilder() {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentMatch | null>(null);
  const [area, setArea] = useState("");
  const [youtubeId, setYoutubeId] = useState("");
  const [videoTitle, setVideoTitle] = useState("");

  // The shared "best of" pool: bookings picked purely as a source of photos to feature.
  const [poolBooking, setPoolBooking] = useState<BookingMatch | null>(null);
  const [poolPhotos, setPoolPhotos] = useState<string[]>([]);
  const [pool, setPool] = useState<{ bookingId: string; name: string }[]>([]);

  const [houses, setHouses] = useState<House[]>([]);
  const [houseBooking, setHouseBooking] = useState<BookingMatch | null>(null);
  const [houseBookingPhotos, setHouseBookingPhotos] = useState<string[]>([]);

  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ slug: string; url: string } | null>(null);

  const togglePool = (bookingId: string, name: string) =>
    setPool((prev) =>
      prev.some((p) => p.bookingId === bookingId && p.name === name)
        ? prev.filter((p) => !(p.bookingId === bookingId && p.name === name))
        : [...prev, { bookingId, name }]
    );

  const addHouse = () => {
    if (!houseBooking || houseBookingPhotos.length === 0) return;
    if (houses.length >= MAX_HOUSES) return toast.error(`Up to ${MAX_HOUSES} houses`);
    setHouses((prev) => [
      ...prev,
      { bookingId: houseBooking.id, address: houseBooking.address, city: houseBooking.city, available: houseBookingPhotos, selected: new Set() },
    ]);
    setHouseBooking(null);
    setHouseBookingPhotos([]);
  };

  const toggleHousePhoto = (bookingId: string, name: string) =>
    setHouses((prev) =>
      prev.map((h) => {
        if (h.bookingId !== bookingId) return h;
        const selected = new Set(h.selected);
        if (selected.has(name)) selected.delete(name);
        else selected.add(name);
        return { ...h, selected };
      })
    );

  const create = async () => {
    const housesContent = houses.filter((h) => h.selected.size > 0).map((h) => ({
      bookingId: h.bookingId,
      address: h.address,
      city: h.city,
      photos: [...h.selected],
    }));
    if (pool.length === 0 && housesContent.length === 0) return toast.error("Pick at least a photo or a house");

    setCreating(true);
    try {
      const { slug, url } = await createPortfolioLinkAction(agent?.id ?? null, {
        area: area.trim() || null,
        photos: pool,
        video: youtubeId.trim() ? { youtubeId: youtubeId.trim(), title: videoTitle.trim() || "Video" } : null,
        houses: housesContent,
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
        <label className="text-sm font-medium">Who this is for (optional — never shown on the page)</label>
        <AgentPicker value={agent} onChange={setAgent} />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Area (hero line: "Real Estate Photography & Video in ___, Oregon")</label>
        <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Eugene" className="max-w-xs" />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-sm font-medium">Photo portfolio — the condensed "best of" grid</h2>
        <BookingPicker
          value={poolBooking}
          onChange={async (b) => {
            setPoolBooking(b);
            setPoolPhotos([]);
            if (!b) return;
            setLoadingPhotos(true);
            setPoolPhotos(await getBookingGalleryPhotos(b.id));
            setLoadingPhotos(false);
          }}
        />
        {loadingPhotos && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {poolBooking && poolPhotos.length > 0 && (
          <PhotoGrid
            bookingId={poolBooking.id}
            photos={poolPhotos}
            isSelected={(name) => pool.some((p) => p.bookingId === poolBooking.id && p.name === name)}
            onToggle={(name) => togglePool(poolBooking.id, name)}
          />
        )}
        {pool.length > 0 && <p className="text-xs text-muted-foreground">{pool.length} photo{pool.length === 1 ? "" : "s"} in the pool</p>}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-sm font-medium">One of my videos (optional)</h2>
        <div className="flex gap-2">
          <Input value={youtubeId} onChange={(e) => setYoutubeId(e.target.value)} placeholder="YouTube video id" />
          <Input value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} placeholder="Title" />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-sm font-medium">Specific houses, with address and a carousel ({houses.length}/{MAX_HOUSES})</h2>
        {houses.map((h) => (
          <div key={h.bookingId} className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {h.address}
                {h.city ? `, ${h.city}` : ""}
              </span>
              <Button variant="ghost" size="icon" onClick={() => setHouses((prev) => prev.filter((x) => x.bookingId !== h.bookingId))}>
                <X />
              </Button>
            </div>
            <PhotoGrid
              bookingId={h.bookingId}
              photos={h.available}
              isSelected={(name) => h.selected.has(name)}
              onToggle={(name) => toggleHousePhoto(h.bookingId, name)}
            />
          </div>
        ))}
        {houses.length < MAX_HOUSES && (
          <div className="flex flex-col gap-2">
            <BookingPicker
              value={houseBooking}
              onChange={async (b) => {
                setHouseBooking(b);
                setHouseBookingPhotos([]);
                if (!b) return;
                setHouseBookingPhotos(await getBookingGalleryPhotos(b.id));
              }}
            />
            {houseBooking && houseBookingPhotos.length > 0 && (
              <Button size="sm" onClick={addHouse} className="w-fit">
                Add as a house
              </Button>
            )}
          </div>
        )}
      </section>

      <Button disabled={creating} onClick={create}>
        {creating ? <Loader2 className="animate-spin" /> : null}
        Create the link
      </Button>
    </div>
  );
}

function PhotoGrid({
  bookingId,
  photos,
  isSelected,
  onToggle,
}: {
  bookingId: string;
  photos: string[];
  isSelected: (name: string) => boolean;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
      {photos.map((name) => {
        const on = isSelected(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggle(name)}
            className={`relative aspect-square overflow-hidden rounded-md border-2 ${on ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoThumb(bookingId, name)} alt={name} loading="lazy" className="h-full w-full object-cover" />
            {on && (
              <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                <Check className="size-3" />
              </span>
            )}
          </button>
        );
      })}
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

function BookingPicker({ value, onChange }: { value: BookingMatch | null; onChange: (b: BookingMatch | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookingMatch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBookingsForPortfolio(query)
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
        <span className="text-sm">{value.label}</span>
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
        placeholder="Search a job by address or city"
        className="pl-8"
      />
      {open && query.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                disabled={!b.hasGallery}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-40"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onChange(b);
                }}
              >
                <span>{b.label}</span>
                {!b.hasGallery && <span className="text-xs text-muted-foreground">no gallery</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
