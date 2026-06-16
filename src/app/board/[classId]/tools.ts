/**
 * Whiteboard tools — pure geometry, payload narrowers, and hit-testing.
 *
 * Like strokes.ts, this is framework- and DOM-free so it can be unit tested.
 * It backs the geometry/text/image tools and the OBJECT ERASER: the board sends
 * every created object onto the wire with a stable `id`, and the eraser uses
 * `topmostHit` to find which object sits under a click so it can broadcast an
 * `erase` op targeting that id.
 *
 * Coordinate convention (matches the rest of the board): all geometry is stored
 * NORMALIZED 0..1 relative to the viewport. Hit-testing is done in PIXEL space —
 * we convert with the live surface size — because per-axis normalization is not
 * isotropic, so a fixed normalized tolerance would be tighter on the long axis.
 */
import {
  asStroke,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  type Pt,
} from "./strokes";

/** Default type size (px) for text labels and equations. */
export const DEFAULT_FONT_SIZE = 18;
/** Click slop (px) for selecting thin objects with the eraser. */
export const HIT_TOLERANCE_PX = 8;

/** Pixel size of the drawing surface. */
export interface Size {
  w: number;
  h: number;
}

/** Every tool the board exposes. */
export type Tool =
  | "select"
  | "pan"
  | "pen"
  | "line"
  | "rect"
  | "ellipse"
  | "arrow"
  | "arc"
  | "polygon"
  | "frame"
  | "text"
  | "math"
  | "image"
  | "pdf"
  | "erase";

export type ShapeKind =
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "arc"
  | "polygon"
  | "frame"
  | "text"
  | "image";

/** A straight line or an arrow (arrowhead derived at render time). */
export interface SegmentShape {
  id?: string;
  kind: "line" | "arrow";
  start: Pt;
  end: Pt;
  color: string;
  width: number;
}

/** A rectangle or ellipse inscribed in the start/end bounding box. */
export interface BoxShape {
  id?: string;
  kind: "rect" | "ellipse";
  start: Pt;
  end: Pt;
  color: string;
  width: number;
  fill?: boolean;
  /** Explicit fill colour; when absent and `fill`, the stroke colour is used. */
  fillColor?: string;
}

/** A plain text label anchored at its top-left (x,y). */
export interface TextShape {
  id?: string;
  kind: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
}

/** A placed image (or a rasterized PDF page); x,y,w,h normalized 0..1. */
export interface ImageShape {
  id?: string;
  kind: "image";
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A circular arc: center (cx,cy) normalized, radius `r` a normalized scalar
 * (rendered rx=r·w, ry=r·h so it stretches with the viewport like an ellipse),
 * swept from `a0` to `a1` DEGREES (clockwise in screen space).
 */
export interface ArcShape {
  id?: string;
  kind: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  color: string;
  width: number;
}

/**
 * A regular polygon or star about (cx,cy) with normalized radius `r`, `sides`
 * points, rotated `rot` degrees. When `star`, vertices alternate between `r`
 * and an inner radius.
 */
export interface PolygonShape {
  id?: string;
  kind: "polygon";
  cx: number;
  cy: number;
  r: number;
  sides: number;
  rot: number;
  star: boolean;
  color: string;
  width: number;
  fill?: boolean;
  fillColor?: string;
}

/** A named work region; objects inside it export together as one PDF page. */
export interface FrameShape {
  id?: string;
  kind: "frame";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
}

export type ShapePayload =
  | SegmentShape
  | BoxShape
  | TextShape
  | ImageShape
  | ArcShape
  | PolygonShape
  | FrameShape;

/** A LaTeX equation rendered with KaTeX, anchored at its top-left (x,y). */
export interface EquationPayload {
  id?: string;
  x: number;
  y: number;
  latex: string;
  fontSize: number;
  color: string;
}

/** Axis-aligned bounding box (normalized unless noted). */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ── narrowers (mirror asStroke: object guard + per-field checks) ── */

function isPt(q: unknown): q is Pt {
  return (
    !!q &&
    typeof (q as Pt).x === "number" &&
    typeof (q as Pt).y === "number"
  );
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

/** Narrow an opaque `shape` payload to a renderable shape, else null. */
export function asShape(payload: unknown): ShapePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : undefined;
  const color = str(p.color, DEFAULT_COLOR);
  const width = num(p.width, DEFAULT_WIDTH);

  switch (p.kind) {
    case "line":
    case "arrow":
      if (!isPt(p.start) || !isPt(p.end)) return null;
      return { id, kind: p.kind, start: p.start, end: p.end, color, width };
    case "rect":
    case "ellipse":
      if (!isPt(p.start) || !isPt(p.end)) return null;
      return {
        id,
        kind: p.kind,
        start: p.start,
        end: p.end,
        color,
        width,
        fill: !!p.fill,
        ...(typeof p.fillColor === "string" ? { fillColor: p.fillColor } : {}),
      };
    case "text":
      if (
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        typeof p.text !== "string"
      ) {
        return null;
      }
      return {
        id,
        kind: "text",
        x: p.x,
        y: p.y,
        text: p.text,
        fontSize: num(p.fontSize, DEFAULT_FONT_SIZE),
        color,
      };
    case "image":
      if (
        typeof p.url !== "string" ||
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        typeof p.w !== "number" ||
        typeof p.h !== "number"
      ) {
        return null;
      }
      return { id, kind: "image", url: p.url, x: p.x, y: p.y, w: p.w, h: p.h };
    case "arc":
      if (
        typeof p.cx !== "number" ||
        typeof p.cy !== "number" ||
        typeof p.r !== "number"
      ) {
        return null;
      }
      return {
        id,
        kind: "arc",
        cx: p.cx,
        cy: p.cy,
        r: Math.abs(p.r),
        a0: num(p.a0, 0),
        a1: num(p.a1, 360),
        color,
        width,
      };
    case "polygon":
      if (
        typeof p.cx !== "number" ||
        typeof p.cy !== "number" ||
        typeof p.r !== "number"
      ) {
        return null;
      }
      return {
        id,
        kind: "polygon",
        cx: p.cx,
        cy: p.cy,
        r: Math.abs(p.r),
        sides: Math.max(3, Math.min(24, Math.round(num(p.sides, 5)))),
        rot: num(p.rot, 0),
        star: !!p.star,
        color,
        width,
        fill: !!p.fill,
        ...(typeof p.fillColor === "string" ? { fillColor: p.fillColor } : {}),
      };
    case "frame":
      if (
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        typeof p.w !== "number" ||
        typeof p.h !== "number"
      ) {
        return null;
      }
      return {
        id,
        kind: "frame",
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        label: str(p.label, "Frame"),
        color: str(p.color, color),
      };
    default:
      return null;
  }
}

/** Title-bar height (px) drawn above a frame; also its grab strip. */
export const FRAME_LABEL_PX = 22;

/**
 * Per-axis NORMALIZED radius factors that render to an ISOTROPIC (true) circle.
 *
 * The board maps normalized x→[0,w] and y→[0,h], so a single normalized radius
 * `r` would draw as an ellipse squished by the viewport aspect. We instead anchor
 * the radius to the SMALLER pixel dimension (`ref = min(w,h)`): the pixel radius
 * is `r·ref` on BOTH axes, so circles/polygons/arcs stay round on any aspect.
 * Falls back to the legacy isotropic-in-normalized-space behaviour when no size
 * is supplied (keeps pure callers/tests working).
 */
export function radiusFactors(r: number, size?: Size): { rx: number; ry: number } {
  if (!size || !size.w || !size.h) return { rx: r, ry: r };
  const ref = Math.min(size.w, size.h);
  const rPx = r * ref;
  return { rx: rPx / size.w, ry: rPx / size.h };
}

/**
 * Sample an arc into normalized points (for both the polyline render and
 * hit-testing). `a0`/`a1` are degrees; the sweep goes the short way a0→a1.
 * `size` makes the arc circular (not elliptical) on non-square viewports.
 */
export function arcPoints(s: ArcShape, size?: Size, segments = 64): Pt[] {
  const a0 = (s.a0 * Math.PI) / 180;
  const a1 = (s.a1 * Math.PI) / 180;
  const span = a1 - a0;
  const n = Math.max(2, Math.ceil((Math.abs(span) / (2 * Math.PI)) * segments));
  const { rx, ry } = radiusFactors(s.r, size);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (span * i) / n;
    out.push({ x: s.cx + rx * Math.cos(t), y: s.cy + ry * Math.sin(t) });
  }
  return out;
}

/**
 * The closed vertex ring of a polygon/star in normalized points. `size` keeps
 * regular polygons regular (equal pixel radius) instead of aspect-compressed.
 */
export function polygonPoints(s: PolygonShape, size?: Size): Pt[] {
  const sides = Math.max(3, Math.round(s.sides));
  const rot = (s.rot * Math.PI) / 180;
  const { rx, ry } = radiusFactors(s.r, size);
  const { rx: irx, ry: iry } = radiusFactors(s.r * 0.45, size); // star waist
  const out: Pt[] = [];
  const count = s.star ? sides * 2 : sides;
  for (let i = 0; i < count; i++) {
    const useInner = s.star && i % 2 === 1;
    const ax = useInner ? irx : rx;
    const ay = useInner ? iry : ry;
    // Start at the top (−90°) so polygons sit upright.
    const a = rot - Math.PI / 2 + (i * Math.PI * 2) / count;
    out.push({ x: s.cx + ax * Math.cos(a), y: s.cy + ay * Math.sin(a) });
  }
  return out;
}

/** Narrow an opaque `equation` payload, else null. */
export function asEquation(payload: unknown): EquationPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.x !== "number" || typeof p.y !== "number" || typeof p.latex !== "string") {
    return null;
  }
  return {
    id: typeof p.id === "string" ? p.id : undefined,
    x: p.x,
    y: p.y,
    latex: p.latex,
    fontSize: num(p.fontSize, DEFAULT_FONT_SIZE),
    color: str(p.color, DEFAULT_COLOR),
  };
}

/** The stable id carried in an op's payload, or null (legacy/un-id'd ops). */
export function idOf(op: { payload?: unknown }): string | null {
  const pl = op.payload;
  if (pl && typeof pl === "object") {
    const id = (pl as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

/* ── bounding boxes (normalized) ─────────────────────────────────── */

/** Normalized AABB for a shape. Text height is approximated from fontSize. */
export function shapeBBox(s: ShapePayload, size?: Size): BBox {
  switch (s.kind) {
    case "line":
    case "arrow":
    case "rect":
    case "ellipse": {
      const x = Math.min(s.start.x, s.end.x);
      const y = Math.min(s.start.y, s.end.y);
      return { x, y, w: Math.abs(s.end.x - s.start.x), h: Math.abs(s.end.y - s.start.y) };
    }
    case "image":
    case "frame":
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "arc":
    case "polygon": {
      const pts = s.kind === "arc" ? arcPoints(s, size) : polygonPoints(s, size);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "text": {
      // fontSize is px; approximate extent and convert to normalized if we know
      // the surface size (otherwise return a zero-size anchor box).
      const wPx = s.text.length * s.fontSize * 0.6;
      const hPx = s.fontSize * 1.3;
      return {
        x: s.x,
        y: s.y,
        w: size ? wPx / size.w : 0,
        h: size ? hPx / size.h : 0,
      };
    }
  }
}

/* ── hit-testing (pixel space) ───────────────────────────────────── */

function toPx(p: Pt, size: Size): { x: number; y: number } {
  return { x: p.x * size.w, y: p.y * size.h };
}

/** Shortest distance (px) from point `p` to segment `a`–`b`. */
export function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y); // degenerate segment
  // Project p onto the segment, clamped to [0,1].
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return Math.hypot(p.x - fx, p.y - fy);
}

function hitSegment(s: SegmentShape, pPx: { x: number; y: number }, size: Size): boolean {
  const a = toPx(s.start, size);
  const b = toPx(s.end, size);
  return distToSegment(pPx, a, b) <= HIT_TOLERANCE_PX + s.width / 2;
}

function hitBox(s: BoxShape, pPx: { x: number; y: number }, size: Size): boolean {
  const a = toPx(s.start, size);
  const b = toPx(s.end, size);
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const tol = HIT_TOLERANCE_PX + s.width / 2;

  if (s.kind === "rect") {
    if (s.fill) {
      return pPx.x >= x0 - tol && pPx.x <= x1 + tol && pPx.y >= y0 - tol && pPx.y <= y1 + tol;
    }
    // Outline: near any of the four edges, within the box's tol band.
    const nearV =
      (Math.abs(pPx.x - x0) <= tol || Math.abs(pPx.x - x1) <= tol) &&
      pPx.y >= y0 - tol &&
      pPx.y <= y1 + tol;
    const nearH =
      (Math.abs(pPx.y - y0) <= tol || Math.abs(pPx.y - y1) <= tol) &&
      pPx.x >= x0 - tol &&
      pPx.x <= x1 + tol;
    return nearV || nearH;
  }

  // Ellipse inscribed in the box.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) return false;
  const norm = ((pPx.x - cx) / rx) ** 2 + ((pPx.y - cy) / ry) ** 2;
  if (s.fill) return norm <= 1 + tol / Math.min(rx, ry);
  // Outline: near the unit ring. Convert the px tol to a roughly proportional band.
  const band = tol / Math.min(rx, ry);
  return Math.abs(Math.sqrt(norm) - 1) <= band;
}

function hitImage(s: ImageShape, pPx: { x: number; y: number }, size: Size): boolean {
  const x0 = s.x * size.w;
  const y0 = s.y * size.h;
  return pPx.x >= x0 && pPx.x <= x0 + s.w * size.w && pPx.y >= y0 && pPx.y <= y0 + s.h * size.h;
}

function hitTextBox(
  anchor: { x: number; y: number },
  text: string,
  fontSize: number,
  pPx: { x: number; y: number },
  size: Size,
): boolean {
  const x0 = anchor.x * size.w;
  const y0 = anchor.y * size.h;
  const wPx = Math.max(text.length * fontSize * 0.6, fontSize); // never zero-width
  const hPx = fontSize * 1.3;
  const tol = HIT_TOLERANCE_PX;
  return (
    pPx.x >= x0 - tol &&
    pPx.x <= x0 + wPx + tol &&
    pPx.y >= y0 - tol &&
    pPx.y <= y0 + hPx + tol
  );
}

/** Min pixel distance from `pPx` to a normalized polyline (open). */
function distToPolyline(pts: Pt[], pPx: { x: number; y: number }, size: Size): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(pPx, toPx(pts[i], size), toPx(pts[i + 1], size)));
  }
  return best;
}

/** Even-odd point-in-polygon test in pixel space. */
function pointInPolygon(pts: Pt[], pPx: { x: number; y: number }, size: Size): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = toPx(pts[i], size);
    const b = toPx(pts[j], size);
    const hit =
      a.y > pPx.y !== b.y > pPx.y &&
      pPx.x < ((b.x - a.x) * (pPx.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function hitArc(s: ArcShape, pPx: { x: number; y: number }, size: Size): boolean {
  return distToPolyline(arcPoints(s, size), pPx, size) <= HIT_TOLERANCE_PX + s.width / 2;
}

function hitPolygon(s: PolygonShape, pPx: { x: number; y: number }, size: Size): boolean {
  const ring = polygonPoints(s, size);
  const closed = [...ring, ring[0]];
  if (distToPolyline(closed, pPx, size) <= HIT_TOLERANCE_PX + s.width / 2) return true;
  return s.fill ? pointInPolygon(ring, pPx, size) : false;
}

/** A frame is grabbed by its border band or its title strip — never its interior. */
function hitFrame(s: FrameShape, pPx: { x: number; y: number }, size: Size): boolean {
  const x0 = s.x * size.w;
  const y0 = s.y * size.h;
  const x1 = (s.x + s.w) * size.w;
  const y1 = (s.y + s.h) * size.h;
  const tol = HIT_TOLERANCE_PX + 2;
  if (pPx.x >= x0 - tol && pPx.x <= x1 + tol && pPx.y >= y0 - FRAME_LABEL_PX - tol && pPx.y <= y0) {
    return true; // title strip
  }
  const nearV = (Math.abs(pPx.x - x0) <= tol || Math.abs(pPx.x - x1) <= tol) && pPx.y >= y0 - tol && pPx.y <= y1 + tol;
  const nearH = (Math.abs(pPx.y - y0) <= tol || Math.abs(pPx.y - y1) <= tol) && pPx.x >= x0 - tol && pPx.x <= x1 + tol;
  return nearV || nearH;
}

/**
 * Does the normalized point `p` hit op `op` on a `size`-pixel surface?
 * Returns false for ops we can't narrow (legacy/unknown payloads).
 */
export function hitTest(
  op: { type: string; payload?: unknown },
  p: Pt,
  size: Size,
): boolean {
  if (size.w === 0 || size.h === 0) return false;
  const pPx = toPx(p, size);

  if (op.type === "stroke") {
    const s = asStroke(op.payload);
    if (!s) return false;
    if (s.points.length === 1) {
      const a = toPx(s.points[0], size);
      return Math.hypot(pPx.x - a.x, pPx.y - a.y) <= HIT_TOLERANCE_PX + s.width / 2;
    }
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = toPx(s.points[i], size);
      const b = toPx(s.points[i + 1], size);
      if (distToSegment(pPx, a, b) <= HIT_TOLERANCE_PX + s.width / 2) return true;
    }
    return false;
  }

  if (op.type === "shape") {
    const s = asShape(op.payload);
    if (!s) return false;
    switch (s.kind) {
      case "line":
      case "arrow":
        return hitSegment(s, pPx, size);
      case "rect":
      case "ellipse":
        return hitBox(s, pPx, size);
      case "image":
        return hitImage(s, pPx, size);
      case "arc":
        return hitArc(s, pPx, size);
      case "polygon":
        return hitPolygon(s, pPx, size);
      case "frame":
        return hitFrame(s, pPx, size);
      case "text":
        return hitTextBox({ x: s.x, y: s.y }, s.text, s.fontSize, pPx, size);
    }
  }

  if (op.type === "equation") {
    const e = asEquation(op.payload);
    if (!e) return false;
    // Treat the LaTeX source length as a rough width proxy for the rendered box.
    return hitTextBox({ x: e.x, y: e.y }, e.latex, e.fontSize, pPx, size);
  }

  return false;
}

/**
 * Find the id of the TOPMOST (latest-drawn) non-erased op under point `p`.
 * Iterates in reverse so the visually-front object is selected first. Returns
 * null when nothing is hit. Ops without an id (legacy) are skipped — they can't
 * be targeted by an erase.
 */
export function topmostHit(
  ops: Array<{ type: string; payload?: unknown }>,
  erased: Set<string>,
  p: Pt,
  size: Size,
): string | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const id = idOf(op);
    if (!id || erased.has(id)) continue;
    if (hitTest(op, p, size)) return id;
  }
  return null;
}
