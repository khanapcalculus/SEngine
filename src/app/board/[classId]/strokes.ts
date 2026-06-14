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
): StrokePayload {
  return { points, color, width };
}
