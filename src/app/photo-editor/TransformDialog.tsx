"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_GUIDES, solve, type Guide, type Point } from "@/lib/photoGeometry";
import { renderCanvas, type SourceImage } from "./prepare";
import { svgPoint } from "./svgPoint";

const PREVIEW_PX = 720;

/**
 * Guided upright, like Lightroom's: draw up to four lines along things that
 * should be plumb (door frames, wall corners) or level, and the photo is
 * warped so they are. One line just rotates; two or more fix the perspective.
 * The result, auto-cropped to the photo's aspect, shows live with a grid.
 */
export function TransformDialog({
  open,
  onOpenChange,
  source,
  guides: initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceImage;
  guides: Guide[];
  onApply: (guides: Guide[]) => void;
}) {
  const [guides, setGuides] = useState<Guide[]>(initial);
  const [draft, setDraft] = useState<Guide | null>(null);
  const [drag, setDrag] = useState<{ index: number; end: "a" | "b" } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [invalid, setInvalid] = useState(false);

  const all = draft ? [...guides, draft] : guides;
  const long = Math.max(source.width, source.height);
  const handle = long * 0.012;

  // Live result, a frame at a time while dragging.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const solved = solve({ guides: all, rotation: 0, crop: null }, source.width, source.height);
      setInvalid(!solved);
      const canvas = preview.current;
      if (!solved || !canvas) return;
      const rendered = renderCanvas(source, solved, PREVIEW_PX);
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      canvas.getContext("2d")!.drawImage(rendered, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  });

  const at = (e: React.PointerEvent) => svgPoint(svg.current!, e);
  const clamp = (p: Point): Point => ({
    x: Math.min(source.width, Math.max(0, p.x)),
    y: Math.min(source.height, Math.max(0, p.y)),
  });

  const onDown = (e: React.PointerEvent) => {
    if (guides.length >= MAX_GUIDES) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = clamp(at(e));
    setDraft({ a: p, b: p });
  };
  const startDrag = (e: React.PointerEvent<SVGCircleElement>, index: number, end: "a" | "b") => {
    e.stopPropagation();
    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
    setDrag({ index, end });
  };
  const onMove = (e: React.PointerEvent) => {
    const p = clamp(at(e));
    if (drag) {
      const { index, end } = drag;
      setGuides((prev) => prev.map((g, i) => (i === index ? { ...g, [end]: p } : g)));
    } else if (draft) {
      setDraft({ ...draft, b: p });
    }
  };
  const onUp = () => {
    setDrag(null);
    if (draft) {
      // A tap, not a line.
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > long * 0.03) setGuides((prev) => [...prev, draft]);
      setDraft(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Straighten</DialogTitle>
          <DialogDescription>
            Drag a line along something that should be straight up and down (a door frame, a wall corner) or level. One
            line rotates; two or more fix the perspective. Up to {MAX_GUIDES}. Drag an end to adjust, double-click a line
            to remove it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <svg
            ref={svg}
            viewBox={`0 0 ${source.width} ${source.height}`}
            className="w-full touch-none select-none rounded-md bg-black"
            style={{ cursor: guides.length < MAX_GUIDES ? "crosshair" : "default" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <image href={source.url} width={source.width} height={source.height} />
            {all.map((g, i) => (
              <g key={i}>
                <line
                  x1={g.a.x}
                  y1={g.a.y}
                  x2={g.b.x}
                  y2={g.b.y}
                  stroke="black"
                  strokeOpacity={0.5}
                  strokeWidth={long * 0.006}
                />
                <line
                  x1={g.a.x}
                  y1={g.a.y}
                  x2={g.b.x}
                  y2={g.b.y}
                  stroke="#facc15"
                  strokeWidth={long * 0.003}
                  onDoubleClick={() => setGuides((prev) => prev.filter((_, j) => j !== i))}
                  style={{ cursor: "pointer" }}
                />
                {i < guides.length &&
                  (["a", "b"] as const).map((end) => (
                    <circle
                      key={end}
                      cx={g[end].x}
                      cy={g[end].y}
                      r={handle}
                      fill="#facc15"
                      stroke="black"
                      strokeWidth={long * 0.002}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => startDrag(e, i, end)}
                    />
                  ))}
              </g>
            ))}
          </svg>
          <div className="relative flex items-center justify-center overflow-hidden rounded-md bg-black">
            <canvas ref={preview} className="max-h-full w-full object-contain" />
            {/* A thirds-and-more grid to judge the verticals against. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)",
                backgroundSize: "12.5% 12.5%",
              }}
            />
            {invalid && (
              <p className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded bg-black/70 px-2 py-1 text-xs text-white">
                Those lines can&rsquo;t all be squared up. Adjust or remove one.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {guides.length} of {MAX_GUIDES} lines
            </span>
            <Button variant="ghost" size="sm" disabled={!guides.length} onClick={() => setGuides((prev) => prev.slice(0, -1))}>
              <Undo2 />
              Undo
            </Button>
            <Button variant="ghost" size="sm" disabled={!guides.length} onClick={() => setGuides([])}>
              Clear
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={invalid} onClick={() => onApply(guides)}>
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
