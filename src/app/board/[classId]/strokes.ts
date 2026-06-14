/**
 * Whiteboard stroke geometry — pure, framework-agnostic core.
 *
 * The drawing engine in page.tsx builds continuous paths and packs them into the
 * connection's OPAQUE `stroke` payload. The mathematical bits that decide
 * accuracy (how a payload is normalized back into a renderable stroke) and
 * performance (how many points a path keeps) live here so they can be unit
 * tested without a DOM or a socket.
 */

/** A normalized canvas point; both axes are clamped to 0..1 by the caller. */
export interface Pt {
  x: number;
  y: number;
}

/** What we pack into the opaque `stroke` op payload. */
export interface StrokePayload {
  /** Stable id minted at creation; lets the object eraser target this stroke. */
  id?: string;
  points: Pt[];
  color: string;
  width: number;
}

/* ── palette / canvas constants (shared with the page) ───────────── */
export const BG = "#0f1424"; // board background; the eraser paints with this color
export const DEFAULT_COLOR = "#7fd1ff";
export const DEFAULT_WIDTH = 4;
/** Min normalized travel before a move point is recorded (keeps payloads lean). */
export const MIN_POINT_DELTA = 0.0035;
/** Hard cap on points per stroke — a runaway drag can't blow up the payload. */
export const MAX_POINTS = 1200;

/** True when `q` looks like a normalized point. */
function isPt(q: unknown): q is Pt {
  return (
    !!q &&
    typeof (q as Pt).x === "number" &&
    typeof (q as Pt).y === "number"
  );
}

/**
 * Narrow an opaque op payload into a renderable stroke, tolerating:
 *  - the current `{ points, color, width }` shape (filtering non-point junk),
 *  - the legacy single-dot `{ x, y }` payload from the original whiteboard page,
 *  - anything else → null (caller skips it).
 * Missing color/width fall back to the defaults so a partial payload still draws.
 */
export function asStroke(payload: unknown): StrokePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (Array.isArray(p.points)) {
    const points = p.points.filter(isPt);
    if (points.length === 0) return null;
    return {
      id: typeof p.id === "string" ? p.id : undefined,
      points,
      color: typeof p.color === "string" ? p.color : DEFAULT_COLOR,
      width: typeof p.width === "number" ? p.width : DEFAULT_WIDTH,
    };
  }

  // Legacy single-dot payload ({x,y}) from the original whiteboard page.
  if (typeof p.x === "number" && typeof p.y === "number") {
    return {
      points: [{ x: p.x, y: p.y }],
      color: DEFAULT_COLOR,
      width: DEFAULT_WIDTH,
    };
  }

  return null;
}

/**
 * Distance-thinning predicate: should a new point be recorded given the last one?
 * The first point of a stroke (no `last`) is always kept. Otherwise we keep it
 * only when it has travelled at least `minDelta` on EITHER axis — a Chebyshev
 * (max-norm) gate, matching the cheap per-axis check the pointer handler runs.
 */
export function isFarEnough(
  last: Pt | undefined,
  p: Pt,
  minDelta: number = MIN_POINT_DELTA,
): boolean {
  if (!last) return true;
  return Math.abs(p.x - last.x) >= minDelta || Math.abs(p.y - last.y) >= minDelta;
}

/** Pack a finished path into the opaque stroke payload sent over the wire. */
export function packStrokePayload(
  points: Pt[],
  color: string,
  width: number,
  id?: string,
): StrokePayload {
  return id ? { id, points, color, width } : { points, color, width };
}

/**
 * Build an SVG `<path>` `d` string that draws a SMOOTH curve through `points`
 * (normalized 0..1), scaled to a `w`×`h` pixel surface. This replaces the old
 * straight-segment `<polyline>`, which is why the pen looked faceted.
 *
 * Technique: quadratic Bézier through midpoints — the freehand-drawing standard.
 * We move to the first point, then for each interior point `pi` emit
 * `Q pi, midpoint(pi, pi+1)`, so every recorded point becomes a control point and
 * the curve passes smoothly through the midpoints (C1-continuous, no overshoot).
 * A final `L` lands the curve exactly on the last recorded point.
 *
 * Pure and DOM-free: takes the pixel size explicitly so it's unit-testable.
 *   - 0 or 1 points → "" (the caller renders a dot for the single-point case)
 *   - 2 points      → a straight line
 *   - 3+ points     → the smoothed quadratic chain
 */
export function buildSmoothPath(points: Pt[], w: number, h: number): string {
  if (points.length < 2) return "";
  const X = (p: Pt) => p.x * w;
  const Y = (p: Pt) => p.y * h;
  const n = points.length;

  if (n === 2) {
    return `M ${X(points[0])} ${Y(points[0])} L ${X(points[1])} ${Y(points[1])}`;
  }

  let d = `M ${X(points[0])} ${Y(points[0])}`;
  // Each interior point is a control point; the curve passes through the
  // midpoint between consecutive points.
  for (let i = 1; i < n - 1; i++) {
    const cx = X(points[i]);
    const cy = Y(points[i]);
    const mx = (X(points[i]) + X(points[i + 1])) / 2;
    const my = (Y(points[i]) + Y(points[i + 1])) / 2;
    d += ` Q ${cx} ${cy} ${mx} ${my}`;
  }
  // Finish exactly on the last point.
  d += ` L ${X(points[n - 1])} ${Y(points[n - 1])}`;
  return d;
}
