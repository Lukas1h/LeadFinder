"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  apply,
  cornersOf,
  rectInside,
  solve,
  warp,
  type Geometry,
  type Point,
  type Rect,
} from "@/lib/photoGeometry";
import type { SourceImage } from "./prepare";
import { svgPoint } from "./svgPoint";

const VIEW_PX = 1000;
const MAX_ROTATION = 15;

/**
 * Crop at the photo's own aspect, with a rotation slider. The straightened
 * photo turns under a fixed crop box; the box can be moved or resized from a
 * corner but never past the photo's edge, so there are no blank corners.
 */
export function CropDialog({
  open,
  onOpenChange,
  source,
  geometry,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceImage;
  geometry: Geometry;
  onApply: (change: { rotation: number; crop: Rect | null }) => void;
}) {
  const [rotation, setRotation] = useState(geometry.rotation);
  const [crop, setCrop] = useState<Rect | null>(geometry.crop);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "move" | number; start: Point; rect: Rect } | null>(null);
  const aspect = source.width / source.height;

  // The straightened (not yet turned) photo, rendered once with clear edges; the turn is an SVG rotate.
  const upright = useMemo(() => {
    const solved = solve({ ...geometry, rotation: 0, crop: null }, source.width, source.height);
    if (!solved) return null;
    const quad = cornersOf(source.width, source.height).map((p) => apply(solved.upright, p));
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const scale = Math.min(1, VIEW_PX / Math.max(box.w, box.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(box.w * scale);
    canvas.height = Math.round(box.h * scale);
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(canvas.width, canvas.height);
    warp(source.pixels, solved.upright, box, scale, out, true);
    ctx.putImageData(out, 0, 0);
    return { box, url: canvas.toDataURL("image/png"), pivot: solved.pivot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, geometry.guides]);

  const solved = solve({ guides: geometry.guides, rotation, crop }, source.width, source.height);
  if (!upright || !solved) return null;
  const { quad } = solved;
  const shown = solved.crop;
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const pad = Math.max(...xs) - Math.min(...xs);
  const view = {
    x: Math.min(...xs) - pad * 0.02,
    y: Math.min(...ys) - pad * 0.02,
    w: Math.max(...xs) - Math.min(...xs) + pad * 0.04,
    h: Math.max(...ys) - Math.min(...ys) + pad * 0.04,
  };
  const long = Math.max(view.w, view.h);
  const minW = source.width * 0.15;

  const turn = (deg: number) => {
    setRotation(deg);
    // Keep his crop while it still fits the turned photo; otherwise back to the biggest that does.
    const next = solve({ guides: geometry.guides, rotation: deg, crop }, source.width, source.height);
    if (crop && next && !rectInside(next.quad, crop)) setCrop(null);
  };

  const onDown = (e: React.PointerEvent, kind: "move" | number) => {
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { kind, start: svgPoint(svg.current!, e), rect: shown };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = svgPoint(svg.current!, e);
    if (d.kind === "move") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      // Slide along an edge rather than stop dead at it.
      for (const r of [
        { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy },
        { ...d.rect, x: d.rect.x + dx },
        { ...d.rect, y: d.rect.y + dy },
      ]) {
        if (rectInside(quad, r)) return setCrop(r);
      }
      return;
    }
    // A corner: the opposite one stays put, the size follows the pointer at the photo's aspect.
    const corner = d.kind;
    const anchor = {
      x: corner === 0 || corner === 3 ? d.rect.x + d.rect.w : d.rect.x,
      y: corner === 0 || corner === 1 ? d.rect.y + d.rect.h : d.rect.y,
    };
    const sx = corner === 0 || corner === 3 ? -1 : 1;
    const sy = corner === 0 || corner === 1 ? -1 : 1;
    const want = Math.max(minW, Math.max(sx * (p.x - anchor.x), sy * (p.y - anchor.y) * aspect));
    const rectFor = (w: number): Rect => {
      const h = w / aspect;
      return { x: sx < 0 ? anchor.x - w : anchor.x, y: sy < 0 ? anchor.y - h : anchor.y, w, h };
    };
    if (rectInside(quad, rectFor(want))) return setCrop(rectFor(want));
    // As big as fits toward the pointer.
    let lo = minW;
    let hi = want;
    if (!rectInside(quad, rectFor(lo))) return;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (rectInside(quad, rectFor(mid))) lo = mid;
      else hi = mid;
    }
    setCrop(rectFor(lo));
  };
  const onUp = () => (drag.current = null);

  const corners = [
    { x: shown.x, y: shown.y },
    { x: shown.x + shown.w, y: shown.y },
    { x: shown.x + shown.w, y: shown.y + shown.h },
    { x: shown.x, y: shown.y + shown.h },
  ];
  const handle = long * 0.014;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Crop &amp; rotate</DialogTitle>
          <DialogDescription>
            Drag the box to move it, a corner to resize. It keeps the photo&rsquo;s shape and stays inside the photo.
          </DialogDescription>
        </DialogHeader>
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="w-full touch-none select-none rounded-md bg-neutral-900"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <g transform={`rotate(${rotation} ${upright.pivot.x} ${upright.pivot.y})`}>
            <image
              href={upright.url}
              x={upright.box.x}
              y={upright.box.y}
              width={upright.box.w}
              height={upright.box.h}
              preserveAspectRatio="none"
            />
          </g>
          <path
            fillRule="evenodd"
            fill="black"
            fillOpacity={0.6}
            d={`M${view.x} ${view.y}h${view.w}v${view.h}h${-view.w}Z M${shown.x} ${shown.y}h${shown.w}v${shown.h}h${-shown.w}Z`}
            pointerEvents="none"
          />
          <rect
            x={shown.x}
            y={shown.y}
            width={shown.w}
            height={shown.h}
            fill="transparent"
            stroke="white"
            strokeWidth={long * 0.002}
            style={{ cursor: "move" }}
            onPointerDown={(e) => onDown(e, "move")}
          />
          {[1, 2].map((k) => (
            <g key={k} stroke="white" strokeOpacity={0.5} strokeWidth={long * 0.001} pointerEvents="none">
              <line x1={shown.x + (shown.w * k) / 3} y1={shown.y} x2={shown.x + (shown.w * k) / 3} y2={shown.y + shown.h} />
              <line x1={shown.x} y1={shown.y + (shown.h * k) / 3} x2={shown.x + shown.w} y2={shown.y + (shown.h * k) / 3} />
            </g>
          ))}
          {corners.map((c, i) => (
            <rect
              key={i}
              x={c.x - handle}
              y={c.y - handle}
              width={handle * 2}
              height={handle * 2}
              fill="white"
              stroke="black"
              strokeWidth={long * 0.001}
              style={{ cursor: i === 0 || i === 2 ? "nwse-resize" : "nesw-resize" }}
              onPointerDown={(e) => onDown(e, i)}
            />
          ))}
        </svg>
        <div className="flex items-center gap-3">
          <span className="w-14 text-xs text-muted-foreground">Rotate</span>
          <input
            type="range"
            min={-MAX_ROTATION}
            max={MAX_ROTATION}
            step={0.1}
            value={rotation}
            onChange={(e) => turn(Number(e.target.value))}
            onDoubleClick={() => turn(0)}
            className="flex-1 accent-foreground"
          />
          <span className="w-12 text-right text-xs tabular-nums">{rotation.toFixed(1)}°</span>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRotation(0);
              setCrop(null);
            }}
          >
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => onApply({ rotation, crop })}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
