"use client";

import { useMemo, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apply, invert, solve, type Geometry, type Point } from "@/lib/photoGeometry";
import { markWidth, renderCanvas, toOutput, type SourceImage, type Stroke } from "./prepare";
import { svgPoint } from "./svgPoint";

const VIEW_PX = 1200;

/**
 * Mark what to remove: draw in red over the photo as it will be sent
 * (straightened and cropped). The marks are kept in the original photo's
 * pixels, so a later straighten or crop carries them along.
 */
export function AnnotateDialog({
  open,
  onOpenChange,
  source,
  geometry,
  strokes: initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceImage;
  geometry: Geometry;
  strokes: Stroke[];
  onApply: (strokes: Stroke[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const view = useMemo(() => {
    const solved = solve(geometry, source.width, source.height);
    if (!solved) return null;
    const canvas = renderCanvas(source, solved, VIEW_PX);
    const scale = canvas.width / solved.crop.w;
    const inv = invert(solved.M);
    return {
      url: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height,
      toView: toOutput(solved, scale),
      toSource: (p: Point) => apply(inv, { x: solved.crop.x + p.x / scale, y: solved.crop.y + p.y / scale }),
    };
  }, [source, geometry]);
  // Drawn in view pixels; turned back into source pixels on Apply.
  const [strokes, setStrokes] = useState<Stroke[]>(() => (view ? initial.map((s) => s.map(view.toView)) : []));
  const [drawing, setDrawing] = useState<Stroke | null>(null);

  if (!view) return null;
  const width = markWidth(Math.max(view.width, view.height));
  const path = (s: Stroke) => s.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + (s.length === 1 ? "l0.1 0" : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Mark what to remove</DialogTitle>
          <DialogDescription>
            Circle or scribble over anything that should go. The model removes only what&rsquo;s marked in red and fills in
            what was around it.
          </DialogDescription>
        </DialogHeader>
        <svg
          ref={svg}
          viewBox={`0 0 ${view.width} ${view.height}`}
          className="w-full touch-none select-none rounded-md bg-black"
          style={{ cursor: "crosshair" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrawing([svgPoint(svg.current!, e)]);
          }}
          onPointerMove={(e) => drawing && setDrawing([...drawing, svgPoint(svg.current!, e)])}
          onPointerUp={() => {
            if (drawing) setStrokes((prev) => [...prev, drawing]);
            setDrawing(null);
          }}
          onPointerCancel={() => setDrawing(null)}
        >
          <image href={view.url} width={view.width} height={view.height} />
          {[...strokes, ...(drawing ? [drawing] : [])].map((s, i) => (
            <path
              key={i}
              d={path(s)}
              fill="none"
              stroke="#ff0000"
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!strokes.length} onClick={() => setStrokes((prev) => prev.slice(0, -1))}>
              <Undo2 />
              Undo
            </Button>
            <Button variant="ghost" size="sm" disabled={!strokes.length} onClick={() => setStrokes([])}>
              Clear
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => onApply(strokes.map((s) => s.map(view.toSource)))}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
