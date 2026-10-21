import type { Point } from "@/lib/photoGeometry";

/** A pointer event's position in an SVG's own (viewBox) coordinates. */
export function svgPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Point {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: p.x, y: p.y };
}
