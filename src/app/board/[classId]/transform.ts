/**
 * Whiteboard object transforms — pure 2D affine algebra, DOM- and framework-free.
 *
 * Every selectable object keeps its ORIGINAL geometry (the create op is never
 * rewritten). Move / resize / rotate are layered on top as a normalized affine
 * matrix `m`, carried in the collaborative `modify` op and reduced into
 * `mutations` exactly like `erase` is reduced into `erased`. This module is the
 * math behind that: building matrices, applying them, and turning a handle drag
 * into the next matrix.
 *
 * Coordinate spaces (the whole board is anisotropic — normalized 0..1 maps to a
 * w×h pixel surface, so a "square" already stretches with the viewport aspect;
 * we embrace that rather than fight it):
 *   - geometry + transforms are stored in NORMALIZED space (peer-independent),
 *   - rendering applies `toPixelMatrix(m,w,h)` to the already-pixel-drawn node,
 *   - resize is solved in normalized object-local space (the handle follows the
 *     cursor exactly, even under rotation),
 *   - rotation angle is measured in PIXEL space (so it feels natural to the
 *     person dragging) and conjugated back into a normalized matrix.
 *
 * A matrix is the SVG 6-tuple [a,b,c,d,e,f] meaning
 *     | a c e |     x' = a·x + c·y + e
 *     | b d f |     y' = b·x + d·y + f
 *     | 0 0 1 |
 */
import type { Pt } from "./strokes";
import { asStroke } from "./strokes";
import { asShape, asEquation, shapeBBox, DEFAULT_FONT_SIZE, type BBox, type Size } from "./tools";

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Is this a finite, non-degenerate, non-identity transform worth applying? */
export function isIdentity(m: Mat | undefined | null): boolean {
  if (!m) return true;
  return (
    m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
  );
}

/** Narrow an opaque value to a finite 6-number matrix, else identity. */
export function asMat(v: unknown): Mat {
  if (Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [v[0], v[1], v[2], v[3], v[4], v[5]];
  }
  return [...IDENTITY] as Mat;
}

/* ── matrix algebra ──────────────────────────────────────────────── */

/** m1 ∘ m2 (apply m2 first, then m1). */
export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Left-fold a chain: compose(A, B, C) applies C first, then B, then A. */
export function compose(...mats: Mat[]): Mat {
  return mats.reduce((acc, m) => multiply(acc, m), [...IDENTITY] as Mat);
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Inverse of an affine matrix; falls back to identity if (near-)singular. */
export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [...IDENTITY] as Mat;
  const id = 1 / det;
  return [
    d * id,
    -b * id,
    -c * id,
    a * id,
    (c * f - d * e) * id,
    (b * e - a * f) * id,
  ];
}

export function translation(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

/** Scale by (sx,sy) about pivot (cx,cy). */
export function scaleAbout(sx: number, sy: number, cx: number, cy: number): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

/** Rotate by `rad` about pivot (cx,cy). */
export function rotateAbout(rad: number, cx: number, cy: number): Mat {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/* ── normalized ↔ pixel ──────────────────────────────────────────── */

/** The diagonal normalized→pixel scale and its inverse. */
function pScale(w: number, h: number): Mat {
  return [w, 0, 0, h, 0, 0];
}
function pScaleInv(w: number, h: number): Mat {
  return [w ? 1 / w : 0, 0, 0, h ? 1 / h : 0, 0, 0];
}

/**
 * Convert a normalized object matrix into the matrix to apply to the object's
 * ALREADY pixel-rendered node: Pscale · m · Pscale⁻¹. Identical input data on
 * every peer; each renders to its own w×h.
 */
export function toPixelMatrix(m: Mat, w: number, h: number): Mat {
  if (isIdentity(m)) return [...IDENTITY] as Mat;
  return multiply(pScale(w, h), multiply(m, pScaleInv(w, h)));
}

/** `matrix(a,b,c,d,e,f)` for an SVG transform attribute. */
export function matrixToSvg(m: Mat): string {
  return `matrix(${m.map((n) => (Number.isFinite(n) ? +n.toFixed(6) : 0)).join(",")})`;
}

/**
 * Conjugate a PIXEL-space delta D into the equivalent NORMALIZED delta:
 * Pscale⁻¹ · D · Pscale. Used for rotation, whose angle we measure in pixels so
 * it feels right to the person dragging.
 */
export function pixelDeltaToNorm(d: Mat, w: number, h: number): Mat {
  return multiply(pScaleInv(w, h), multiply(d, pScale(w, h)));
}

/* ── object bounding boxes (normalized, pre-transform) ───────────── */

function strokeBBox(points: Pt[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Normalized AABB of an op's BASE geometry (before any transform). Returns null
 * for ops we can't narrow. `size` lets text/equation widths be approximated.
 */
export function opBBox(
  op: { type: string; payload?: unknown },
  size?: Size,
): BBox | null {
  if (op.type === "stroke") {
    const s = asStroke(op.payload);
    return s ? strokeBBox(s.points) : null;
  }
  if (op.type === "shape") {
    const s = asShape(op.payload);
    return s ? shapeBBox(s, size) : null;
  }
  if (op.type === "equation") {
    const e = asEquation(op.payload);
    if (!e) return null;
    const fs = e.fontSize || DEFAULT_FONT_SIZE;
    const wPx = Math.max(e.latex.length * fs * 0.55, fs);
    const hPx = fs * 1.4;
    return { x: e.x, y: e.y, w: size ? wPx / size.w : 0, h: size ? hPx / size.h : 0 };
  }
  return null;
}

/* ── selection geometry ──────────────────────────────────────────── */

/** Union of normalized AABBs. Null if empty. */
export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The transformed AABB of `bbox` under `m` (a new axis-aligned box). */
export function transformedAABB(bbox: BBox, m: Mat): BBox {
  const pts = bboxCorners(bbox).map((p) => apply(m, p));
  return unionBBox(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
}

/** [tl, tr, br, bl] corners of a normalized bbox. */
export function bboxCorners(b: BBox): [Pt, Pt, Pt, Pt] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** The 8 resize handles + the object-space anchor each one scales about. */
export type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_KEYS: HandleKey[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_FRAC: Record<HandleKey, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
};

/** Object-space point of a handle within `bbox` (fx,fy ∈ {0,.5,1}). */
export function handlePoint(bbox: BBox, key: HandleKey): Pt {
  const { fx, fy } = HANDLE_FRAC[key];
  return { x: bbox.x + fx * bbox.w, y: bbox.y + fy * bbox.h };
}

/** Which axes a handle scales: corners both, edges one. */
function handleAxes(key: HandleKey): { sx: boolean; sy: boolean } {
  return { sx: key === "e" || key === "w" || key.length === 2, sy: key === "n" || key === "s" || key.length === 2 };
}

/**
 * Next transform after dragging `key` to normalized `pointer`. Solves the scale
 * in OBJECT-LOCAL space about the opposite handle, so the dragged handle lands
 * exactly under the cursor even when `m` already rotates the object.
 * `uniform` forces an aspect-locked scale (Shift); only meaningful for corners.
 */
export function resizeMatrix(
  bbox: BBox,
  m: Mat,
  key: HandleKey,
  pointer: Pt,
  uniform = false,
): Mat {
  // Opposite handle (the fixed anchor) and the dragged handle, in object space.
  const opp: HandleKey = oppositeHandle(key);
  const anchor = handlePoint(bbox, opp);
  const dragged = handlePoint(bbox, key);
  // Where the cursor maps to in object space (undo the current transform).
  const target = apply(invert(m), pointer);

  const { sx: doX, sy: doY } = handleAxes(key);
  const dx = dragged.x - anchor.x;
  const dy = dragged.y - anchor.y;
  let sx = doX && Math.abs(dx) > 1e-6 ? (target.x - anchor.x) / dx : 1;
  let sy = doY && Math.abs(dy) > 1e-6 ? (target.y - anchor.y) / dy : 1;

  if (uniform && doX && doY) {
    const s = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * s;
    sy = Math.sign(sy || 1) * s;
  }
  // Never collapse an axis to nothing (keeps the object grabbable).
  if (doX && Math.abs(sx) < 1e-3) sx = sx < 0 ? -1e-3 : 1e-3;
  if (doY && Math.abs(sy) < 1e-3) sy = sy < 0 ? -1e-3 : 1e-3;

  return multiply(m, scaleAbout(sx, sy, anchor.x, anchor.y));
}

function oppositeHandle(key: HandleKey): HandleKey {
  const map: Record<HandleKey, HandleKey> = {
    nw: "se",
    n: "s",
    ne: "sw",
    e: "w",
    se: "nw",
    s: "n",
    sw: "ne",
    w: "e",
  };
  return map[key];
}

/**
 * Next transform after rotating about a world center. `dThetaPx` is the angle
 * delta measured in PIXEL space; we conjugate it into the normalized frame so
 * the stored matrix stays peer-independent.
 */
export function rotateMatrix(
  m0: Mat,
  centerNorm: Pt,
  dThetaPx: number,
  size: Size,
): Mat {
  const cx = centerNorm.x * size.w;
  const cy = centerNorm.y * size.h;
  const rPx = rotateAbout(dThetaPx, cx, cy);
  const rNorm = pixelDeltaToNorm(rPx, size.w, size.h);
  return multiply(rNorm, m0);
}

/** World-space angle (pixels) of `p` about `centerNorm`. */
export function angleAbout(centerNorm: Pt, p: Pt, size: Size): number {
  return Math.atan2((p.y - centerNorm.y) * size.h, (p.x - centerNorm.x) * size.w);
}

/** A pure world-translation applied on top of `m` (group move). */
export function translateMatrix(m: Mat, dx: number, dy: number): Mat {
  return multiply(translation(dx, dy), m);
}
