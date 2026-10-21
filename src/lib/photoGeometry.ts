// The photo editor's hand corrections, done as exact math in the browser
// rather than asked of the model (which redraws instead of transforming):
// Lightroom-style guided upright, then a rotation, then a crop that keeps the
// photo's aspect. All three compose into one homography M from the source
// photo's pixels (S) to the corrected frame (F); the crop is a rectangle in F,
// and rendering samples each output pixel back through M⁻¹.

export type Point = { x: number; y: number };
/** A line drawn along something that should be plumb or level. Which one it is goes by its angle. */
export type Guide = { a: Point; b: Point };
export type Rect = { x: number; y: number; w: number; h: number };
/** Row-major 3×3. */
export type Mat3 = number[];

export interface Geometry {
  /** Up to four, in source pixels. */
  guides: Guide[];
  /** Degrees, clockwise. */
  rotation: number;
  /** In the corrected frame; null is the largest rectangle of the photo's aspect that fits. */
  crop: Rect | null;
}

export const NO_GEOMETRY: Geometry = { guides: [], rotation: 0, crop: null };
export const MAX_GUIDES = 4;

export const isIdentity = (g: Geometry) => g.guides.length === 0 && g.rotation === 0 && g.crop === null;

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function apply(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/** The denominator at p: it must stay positive over the photo, or the warp folds through infinity. */
const depth = (m: Mat3, p: Point) => m[6] * p.x + m[7] * p.y + m[8];

const isVertical = (g: Guide) => Math.abs(g.b.x - g.a.x) < Math.abs(g.b.y - g.a.y);

function rotationAbout(deg: number, c: Point): Mat3 {
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [cos, -sin, c.x - c.x * cos + c.y * sin, sin, cos, c.y - c.x * sin - c.y * cos, 0, 0, 1];
}

/** Least squares homography through point pairs (four or more), on normalized coordinates for stability. */
function fitHomography(src: Point[], dst: Point[], width: number, height: number): Mat3 | null {
  const s = 2 / Math.max(width, height);
  const T: Mat3 = [s, 0, -s * width / 2, 0, s, -s * height / 2, 0, 0, 1];
  const n = (p: Point) => apply(T, p);
  const ata = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb = new Array(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let r = 0; r < 8; r++) {
      atb[r] += row[r] * v;
      for (let c = 0; c < 8; c++) ata[r][c] += row[r] * row[c];
    }
  };
  src.forEach((p0, i) => {
    const p = n(p0);
    const q = n(dst[i]);
    add([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y], q.x);
    add([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y], q.y);
  });
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(ata[r][col]) > Math.abs(ata[pivot][col])) pivot = r;
    if (Math.abs(ata[pivot][col]) < 1e-12) return null;
    [ata[col], ata[pivot]] = [ata[pivot], ata[col]];
    [atb[col], atb[pivot]] = [atb[pivot], atb[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = ata[r][col] / ata[col][col];
      for (let c = col; c < 8; c++) ata[r][c] -= f * ata[col][c];
      atb[r] -= f * atb[col];
    }
  }
  const h = atb.map((v, i) => v / ata[i][i]);
  const Hn: Mat3 = [...h, 1];
  return multiply(invert(T), multiply(Hn, T));
}

/**
 * The upright correction the guides ask for. One guide is a pure rotation
 * that makes it plumb (or level). Two or more are a perspective correction:
 * each guide's ends move onto a vertical (or horizontal) line through its
 * middle, staying at the same height (or across), which is the keystone fix
 * Lightroom's Guided Upright makes. Null when the guides can't all be met
 * without folding the photo.
 */
export function uprightMatrix(guides: Guide[], width: number, height: number): Mat3 | null {
  if (guides.length === 0) return IDENTITY;
  const center = { x: width / 2, y: height / 2 };
  if (guides.length === 1) {
    const g = guides[0];
    const angle = (Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x) * 180) / Math.PI;
    // Off by how much from the nearest of vertical / horizontal.
    const target = isVertical(g) ? (angle > 0 ? 90 : -90) : Math.abs(angle) > 90 ? (angle > 0 ? 180 : -180) : 0;
    return rotationAbout(target - angle, center);
  }
  const src: Point[] = [];
  const dst: Point[] = [];
  for (const g of guides) {
    src.push(g.a, g.b);
    if (isVertical(g)) {
      const x = (g.a.x + g.b.x) / 2;
      dst.push({ x, y: g.a.y }, { x, y: g.b.y });
    } else {
      const y = (g.a.y + g.b.y) / 2;
      dst.push({ x: g.a.x, y }, { x: g.b.x, y });
    }
  }
  const H = fitHomography(src, dst, width, height);
  if (!H) return null;
  const corners = cornersOf(width, height);
  if (corners.some((p) => depth(H, p) <= 0)) return null;
  if (!isConvex(corners.map((p) => apply(H, p)))) return null;
  return H;
}

export const cornersOf = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function isConvex(quad: Point[]): boolean {
  const signs = quad.map((p, i) => Math.sign(cross(p, quad[(i + 1) % 4], quad[(i + 2) % 4])));
  return signs.every((s) => s === signs[0] && s !== 0);
}

export function insideQuad(quad: Point[], p: Point, eps = 0.5): boolean {
  const s = Math.sign(cross(quad[0], quad[1], quad[2]));
  return quad.every((q, i) => s * cross(q, quad[(i + 1) % 4], p) >= -eps * Math.hypot(quad[(i + 1) % 4].x - q.x, quad[(i + 1) % 4].y - q.y));
}

export const rectCorners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

export const rectInside = (quad: Point[], r: Rect, eps = 0.5) => rectCorners(r).every((p) => insideQuad(quad, p, eps));

export const centroid = (pts: Point[]): Point => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** The biggest rectangle of this aspect centered on the quad's middle that stays inside it: no blank corners. */
export function largestInscribed(quad: Point[], aspect: number): Rect {
  const c = centroid(quad);
  let lo = 0;
  let hi = Math.max(...quad.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = { x: c.x - mid * aspect, y: c.y - mid, w: 2 * mid * aspect, h: 2 * mid };
    if (rectInside(quad, r, 0)) lo = mid;
    else hi = mid;
  }
  return { x: c.x - lo * aspect, y: c.y - lo, w: 2 * lo * aspect, h: 2 * lo };
}

export interface Solved {
  /** Source pixels → corrected frame. */
  M: Mat3;
  /** Where the photo lands in the corrected frame. */
  quad: Point[];
  crop: Rect;
  /** The upright step alone, and the point the rotation turns about (for previews that rotate with CSS). */
  upright: Mat3;
  pivot: Point;
}

/** The geometry, solved for a photo this size. Null when the guides can't be met. */
export function solve(g: Geometry, width: number, height: number): Solved | null {
  const upright = uprightMatrix(g.guides, width, height);
  if (!upright) return null;
  const pivot = centroid(cornersOf(width, height).map((p) => apply(upright, p)));
  const M = multiply(rotationAbout(g.rotation, pivot), upright);
  const quad = cornersOf(width, height).map((p) => apply(M, p));
  const auto = largestInscribed(quad, width / height);
  const crop = g.crop && rectInside(quad, g.crop) ? g.crop : auto;
  return { M, quad, crop, upright, pivot };
}

/**
 * Renders the corrected crop: each output pixel sampled bilinearly from the
 * source through M⁻¹. `scale` is output pixels per corrected-frame pixel.
 * Pixels that fall outside the photo repeat its edge, or with `transparent`
 * are left clear (the crop tool's view of the whole turned photo).
 */
export function warp(src: ImageData, M: Mat3, crop: Rect, scale: number, out: ImageData, transparent = false): void {
  const inv = invert(M);
  const { width: sw, height: sh, data: s } = src;
  const { width: ow, height: oh, data: o } = out;
  for (let j = 0; j < oh; j++) {
    const fy = crop.y + (j + 0.5) / scale;
    for (let i = 0; i < ow; i++) {
      const fx = crop.x + (i + 0.5) / scale;
      const w = inv[6] * fx + inv[7] * fy + inv[8];
      let x = (inv[0] * fx + inv[1] * fy + inv[2]) / w - 0.5;
      let y = (inv[3] * fx + inv[4] * fy + inv[5]) / w - 0.5;
      if (transparent && (x < -0.5 || y < -0.5 || x > sw - 0.5 || y > sh - 0.5)) continue;
      x = Math.min(sw - 1, Math.max(0, x));
      y = Math.min(sh - 1, Math.max(0, y));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const dx = x - x0;
      const dy = y - y0;
      const p00 = (y0 * sw + x0) * 4;
      const p10 = (y0 * sw + x1) * 4;
      const p01 = (y1 * sw + x0) * 4;
      const p11 = (y1 * sw + x1) * 4;
      const q = (j * ow + i) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[p00 + c] + (s[p10 + c] - s[p00 + c]) * dx;
        const bottom = s[p01 + c] + (s[p11 + c] - s[p01 + c]) * dx;
        o[q + c] = top + (bottom - top) * dy;
      }
      o[q + 3] = 255;
    }
  }
}
