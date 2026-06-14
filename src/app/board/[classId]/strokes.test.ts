/**
 * Unit tests for the whiteboard stroke geometry core (./strokes).
 *
 * These lock down the two bits that govern the drawing engine's accuracy and
 * performance: how an opaque payload is normalized back into a renderable
 * stroke (asStroke), how the path is thinned as the pointer moves (isFarEnough),
 * and how a finished path is packed for the wire (packStrokePayload).
 */
import { describe, it, expect } from "vitest";
import {
  asStroke,
  isFarEnough,
  packStrokePayload,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  MIN_POINT_DELTA,
} from "./strokes";

describe("asStroke — payload normalization", () => {
  it("passes through a well-formed multi-point payload", () => {
    const payload = {
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
      color: "#ff0000",
      width: 8,
    };
    expect(asStroke(payload)).toEqual(payload);
  });

  it("fills missing color/width with defaults", () => {
    const s = asStroke({ points: [{ x: 0.5, y: 0.5 }] });
    expect(s).toEqual({
      points: [{ x: 0.5, y: 0.5 }],
      color: DEFAULT_COLOR,
      width: DEFAULT_WIDTH,
    });
  });

  it("ignores a non-string color and a non-number width", () => {
    const s = asStroke({
      points: [{ x: 0, y: 0 }],
      color: 123,
      width: "fat",
    });
    expect(s?.color).toBe(DEFAULT_COLOR);
    expect(s?.width).toBe(DEFAULT_WIDTH);
  });

  it("filters out junk entries inside the points array", () => {
    const s = asStroke({
      points: [
        { x: 0.1, y: 0.1 },
        null,
        { x: "bad", y: 0 },
        { y: 0.2 },
        { x: 0.9, y: 0.9 },
      ],
    });
    expect(s?.points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ]);
  });

  it("returns null when the points array has no valid points", () => {
    expect(asStroke({ points: [] })).toBeNull();
    expect(asStroke({ points: [null, { x: "x", y: "y" }] })).toBeNull();
  });

  it("upgrades a legacy single-dot {x,y} payload to a one-point stroke", () => {
    expect(asStroke({ x: 0.25, y: 0.75 })).toEqual({
      points: [{ x: 0.25, y: 0.75 }],
      color: DEFAULT_COLOR,
      width: DEFAULT_WIDTH,
    });
  });

  it("returns null for non-object / empty / unrelated payloads", () => {
    expect(asStroke(null)).toBeNull();
    expect(asStroke(undefined)).toBeNull();
    expect(asStroke("stroke")).toBeNull();
    expect(asStroke(42)).toBeNull();
    expect(asStroke({})).toBeNull();
    expect(asStroke({ type: "cursor" })).toBeNull();
  });
});

describe("isFarEnough — distance-thinning gate", () => {
  it("always keeps the first point of a stroke (no previous point)", () => {
    expect(isFarEnough(undefined, { x: 0.5, y: 0.5 })).toBe(true);
  });

  it("rejects a point that barely moved on both axes", () => {
    const last = { x: 0.5, y: 0.5 };
    const tiny = MIN_POINT_DELTA / 2;
    expect(
      isFarEnough(last, { x: 0.5 + tiny, y: 0.5 - tiny }),
    ).toBe(false);
  });

  it("keeps a point that moved far enough on EITHER axis (max-norm)", () => {
    const last = { x: 0.5, y: 0.5 };
    const far = MIN_POINT_DELTA * 2;
    // Far on x only.
    expect(isFarEnough(last, { x: 0.5 + far, y: 0.5 })).toBe(true);
    // Far on y only.
    expect(isFarEnough(last, { x: 0.5, y: 0.5 + far })).toBe(true);
  });

  it("treats the threshold as inclusive (>= keeps)", () => {
    // Use an exactly-representable delta so the boundary isn't float-fuzzy.
    const last = { x: 0, y: 0 };
    expect(isFarEnough(last, { x: 0.25, y: 0 }, 0.25)).toBe(true);
    expect(isFarEnough(last, { x: 0.125, y: 0 }, 0.25)).toBe(false);
  });

  it("honors a custom minDelta override", () => {
    const last = { x: 0, y: 0 };
    const p = { x: 0.01, y: 0 };
    expect(isFarEnough(last, p, 0.02)).toBe(false);
    expect(isFarEnough(last, p, 0.005)).toBe(true);
  });

  it("simulating a drag, thins a dense point stream down", () => {
    // A jittery horizontal drag: many sub-threshold wiggles, a few real moves.
    const raw = [
      { x: 0.0, y: 0.5 },
      { x: 0.0005, y: 0.5 }, // jitter — drop
      { x: 0.001, y: 0.5 }, // jitter — drop
      { x: 0.01, y: 0.5 }, // real move — keep
      { x: 0.0102, y: 0.5 }, // jitter — drop
      { x: 0.05, y: 0.5 }, // real move — keep
    ];
    const kept: typeof raw = [];
    for (const p of raw) {
      if (isFarEnough(kept[kept.length - 1], p, MIN_POINT_DELTA)) kept.push(p);
    }
    expect(kept).toEqual([
      { x: 0.0, y: 0.5 },
      { x: 0.01, y: 0.5 },
      { x: 0.05, y: 0.5 },
    ]);
  });
});

describe("packStrokePayload — wire packing", () => {
  it("packs points, color, and width into the opaque payload shape", () => {
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ];
    expect(packStrokePayload(points, "#abcdef", 6)).toEqual({
      points,
      color: "#abcdef",
      width: 6,
    });
  });

  it("round-trips through asStroke unchanged (pack → normalize)", () => {
    const points = [
      { x: 0.3, y: 0.7 },
      { x: 0.31, y: 0.72 },
    ];
    const packed = packStrokePayload(points, "#00ff88", 3);
    expect(asStroke(packed)).toEqual(packed);
  });
});
