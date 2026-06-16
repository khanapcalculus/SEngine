/**
 * Unit tests for the whiteboard tools core (./tools) — payload narrowers,
 * bounding boxes, and the pixel-space hit-testing that powers the object eraser.
 */
import { describe, it, expect } from "vitest";
import {
  asShape,
  asEquation,
  idOf,
  shapeBBox,
  distToSegment,
  hitTest,
  topmostHit,
  DEFAULT_FONT_SIZE,
  type Size,
} from "./tools";
import { DEFAULT_COLOR, DEFAULT_WIDTH } from "./strokes";

const SIZE: Size = { w: 1000, h: 1000 };

describe("asShape — shape narrowing", () => {
  it("narrows a line/arrow with start+end", () => {
    const s = asShape({ kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, color: "#f00", width: 3 });
    expect(s).toEqual({ id: undefined, kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, color: "#f00", width: 3 });
  });

  it("defaults color/width and coerces fill to boolean for rect/ellipse", () => {
    const s = asShape({ kind: "rect", start: { x: 0, y: 0 }, end: { x: 0.5, y: 0.5 }, fill: 1 });
    expect(s).toMatchObject({ kind: "rect", color: DEFAULT_COLOR, width: DEFAULT_WIDTH, fill: true });
  });

  it("narrows text with a default font size", () => {
    const s = asShape({ kind: "text", x: 0.2, y: 0.3, text: "hi" });
    expect(s).toMatchObject({ kind: "text", x: 0.2, y: 0.3, text: "hi", fontSize: DEFAULT_FONT_SIZE });
  });

  it("narrows an image with url + box", () => {
    const s = asShape({ kind: "image", url: "u", x: 0.1, y: 0.1, w: 0.4, h: 0.3 });
    expect(s).toEqual({ id: undefined, kind: "image", url: "u", x: 0.1, y: 0.1, w: 0.4, h: 0.3 });
  });

  it("keeps the id when present", () => {
    expect(asShape({ id: "X", kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })?.id).toBe("X");
  });

  it("returns null for junk, unknown kind, or missing geometry", () => {
    expect(asShape(null)).toBeNull();
    expect(asShape({})).toBeNull();
    expect(asShape({ kind: "spiral", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })).toBeNull();
    expect(asShape({ kind: "line", start: { x: 0, y: 0 } })).toBeNull();
    expect(asShape({ kind: "text", x: 0, y: 0 })).toBeNull(); // no text
    expect(asShape({ kind: "image", url: "u", x: 0, y: 0, w: 1 })).toBeNull(); // no h
  });
});

describe("asEquation — equation narrowing", () => {
  it("narrows x/y/latex with defaults", () => {
    expect(asEquation({ x: 0.1, y: 0.2, latex: "\\frac{a}{b}" })).toEqual({
      id: undefined,
      x: 0.1,
      y: 0.2,
      latex: "\\frac{a}{b}",
      fontSize: DEFAULT_FONT_SIZE,
      color: DEFAULT_COLOR,
    });
  });

  it("returns null without a latex string", () => {
    expect(asEquation({ x: 0, y: 0 })).toBeNull();
    expect(asEquation({ x: 0, y: 0, latex: 5 })).toBeNull();
    expect(asEquation("nope")).toBeNull();
  });
});

describe("idOf", () => {
  it("reads a string id from the payload, else null", () => {
    expect(idOf({ payload: { id: "abc" } })).toBe("abc");
    expect(idOf({ payload: { id: 7 } })).toBeNull();
    expect(idOf({ payload: {} })).toBeNull();
    expect(idOf({ payload: undefined })).toBeNull();
  });
});

describe("shapeBBox", () => {
  it("computes an AABB regardless of endpoint order", () => {
    const a = shapeBBox({ kind: "rect", start: { x: 0.8, y: 0.8 }, end: { x: 0.2, y: 0.3 }, color: "#fff", width: 1 });
    expect(a.x).toBeCloseTo(0.2);
    expect(a.y).toBeCloseTo(0.3);
    expect(a.w).toBeCloseTo(0.6);
    expect(a.h).toBeCloseTo(0.5);
  });

  it("uses x,y,w,h directly for images", () => {
    expect(shapeBBox({ kind: "image", url: "u", x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("approximates a text box from fontSize when a size is given", () => {
    const b = shapeBBox(
      { kind: "text", x: 0, y: 0, text: "abc", fontSize: 20, color: "#fff" },
      { w: 1000, h: 1000 },
    );
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
  });
});

describe("distToSegment (pixel space)", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("is zero on the segment", () => {
    expect(distToSegment({ x: 5, y: 0 }, a, b)).toBe(0);
  });

  it("measures perpendicular distance off the segment", () => {
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3);
  });

  it("clamps to the endpoints beyond the segment", () => {
    expect(distToSegment({ x: -4, y: 0 }, a, b)).toBeCloseTo(4);
    expect(distToSegment({ x: 14, y: 0 }, a, b)).toBeCloseTo(4);
  });

  it("handles a zero-length segment as distance to the point", () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5);
  });
});

describe("hitTest", () => {
  it("hits a stroke near its path and misses far away", () => {
    const op = {
      type: "stroke",
      payload: { id: "s", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], color: "#fff", width: 2 },
    };
    expect(hitTest(op, { x: 0.5, y: 0.5 }, SIZE)).toBe(true);
    expect(hitTest(op, { x: 0.5, y: 0.9 }, SIZE)).toBe(false);
  });

  it("hits a line along its length", () => {
    const op = { type: "shape", payload: { id: "l", kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, color: "#fff", width: 2 } };
    expect(hitTest(op, { x: 0.5, y: 0.5 }, SIZE)).toBe(true);
    expect(hitTest(op, { x: 0.5, y: 0.1 }, SIZE)).toBe(false);
  });

  it("filled rect is hit inside; outline rect is hit only near an edge", () => {
    const base = { kind: "rect", start: { x: 0.2, y: 0.2 }, end: { x: 0.8, y: 0.8 }, color: "#fff", width: 2 };
    const filled = { type: "shape", payload: { ...base, id: "r1", fill: true } };
    const outline = { type: "shape", payload: { ...base, id: "r2", fill: false } };
    expect(hitTest(filled, { x: 0.5, y: 0.5 }, SIZE)).toBe(true);
    expect(hitTest(outline, { x: 0.5, y: 0.5 }, SIZE)).toBe(false); // interior, not near an edge
    expect(hitTest(outline, { x: 0.2, y: 0.5 }, SIZE)).toBe(true); // on the left edge
  });

  it("ellipse: filled hit inside, outline hit near the ring", () => {
    const base = { kind: "ellipse", start: { x: 0.2, y: 0.2 }, end: { x: 0.8, y: 0.8 }, color: "#fff", width: 2 };
    const filled = { type: "shape", payload: { ...base, id: "e1", fill: true } };
    const outline = { type: "shape", payload: { ...base, id: "e2", fill: false } };
    expect(hitTest(filled, { x: 0.5, y: 0.5 }, SIZE)).toBe(true);
    expect(hitTest(outline, { x: 0.5, y: 0.5 }, SIZE)).toBe(false); // center, off the ring
    expect(hitTest(outline, { x: 0.5, y: 0.2 }, SIZE)).toBe(true); // top of the ring
  });

  it("image and text are hit within their box", () => {
    const img = { type: "shape", payload: { id: "i", kind: "image", url: "u", x: 0.1, y: 0.1, w: 0.4, h: 0.4 } };
    expect(hitTest(img, { x: 0.2, y: 0.2 }, SIZE)).toBe(true);
    expect(hitTest(img, { x: 0.8, y: 0.8 }, SIZE)).toBe(false);

    const txt = { type: "shape", payload: { id: "t", kind: "text", x: 0.1, y: 0.1, text: "hello", fontSize: 20, color: "#fff" } };
    expect(hitTest(txt, { x: 0.105, y: 0.105 }, SIZE)).toBe(true);
  });

  it("returns false for a degenerate size or un-narrowable op", () => {
    const op = { type: "shape", payload: { id: "l", kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, color: "#fff", width: 2 } };
    expect(hitTest(op, { x: 0.5, y: 0.5 }, { w: 0, h: 0 })).toBe(false);
    expect(hitTest({ type: "shape", payload: { kind: "nope" } }, { x: 0, y: 0 }, SIZE)).toBe(false);
  });
});

describe("topmostHit", () => {
  const a = { type: "shape", payload: { id: "A", kind: "rect", start: { x: 0.1, y: 0.1 }, end: { x: 0.9, y: 0.9 }, color: "#fff", width: 2, fill: true } };
  const b = { type: "shape", payload: { id: "B", kind: "rect", start: { x: 0.3, y: 0.3 }, end: { x: 0.7, y: 0.7 }, color: "#fff", width: 2, fill: true } };

  it("returns the topmost (last-drawn) hit id", () => {
    expect(topmostHit([a, b], new Set(), { x: 0.5, y: 0.5 }, SIZE)).toBe("B");
  });

  it("skips erased objects and falls through to the next", () => {
    expect(topmostHit([a, b], new Set(["B"]), { x: 0.5, y: 0.5 }, SIZE)).toBe("A");
  });

  it("returns null when nothing is hit", () => {
    expect(topmostHit([a, b], new Set(), { x: 0.95, y: 0.95 }, SIZE)).toBeNull();
  });

  it("ignores ops with no id (legacy, non-erasable)", () => {
    const legacy = { type: "shape", payload: { kind: "rect", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, color: "#fff", width: 2, fill: true } };
    expect(topmostHit([legacy], new Set(), { x: 0.5, y: 0.5 }, SIZE)).toBeNull();
  });
});

describe("arc / polygon / frame", () => {
  it("narrows an arc with angle defaults and absolute radius", () => {
    const s = asShape({ kind: "arc", cx: 0.5, cy: 0.5, r: -0.2 });
    expect(s).toMatchObject({ kind: "arc", cx: 0.5, cy: 0.5, r: 0.2, a0: 0, a1: 360 });
  });

  it("clamps polygon sides into [3,24] and coerces star/fill", () => {
    const s = asShape({ kind: "polygon", cx: 0.5, cy: 0.5, r: 0.2, sides: 99, star: 1, fill: 1 });
    expect(s).toMatchObject({ kind: "polygon", sides: 24, star: true, fill: true });
    const t = asShape({ kind: "polygon", cx: 0.5, cy: 0.5, r: 0.2, sides: 1 });
    expect(t).toMatchObject({ sides: 3 });
  });

  it("narrows a frame with a default label", () => {
    expect(asShape({ kind: "frame", x: 0.1, y: 0.1, w: 0.4, h: 0.3 })).toMatchObject({
      kind: "frame",
      label: "Frame",
    });
  });

  it("hit-tests an arc near its ring and a polygon edge", () => {
    const arc = { type: "shape", payload: { id: "a", kind: "arc", cx: 0.5, cy: 0.5, r: 0.3, a0: 0, a1: 180, color: "#fff", width: 2 } };
    // a1=180° point sits to the WEST of center at (0.2, 0.5)
    expect(hitTest(arc, { x: 0.2, y: 0.5 }, SIZE)).toBe(true);
    expect(hitTest(arc, { x: 0.5, y: 0.5 }, SIZE)).toBe(false); // center, off the ring

    const poly = { type: "shape", payload: { id: "p", kind: "polygon", cx: 0.5, cy: 0.5, r: 0.3, sides: 4, rot: 0, star: false, fill: true, color: "#fff", width: 2 } };
    expect(hitTest(poly, { x: 0.5, y: 0.5 }, SIZE)).toBe(true); // filled interior
  });

  it("frame is grabbed by its border/title, not its interior", () => {
    const frame = { type: "shape", payload: { id: "f", kind: "frame", x: 0.2, y: 0.2, w: 0.6, h: 0.6, label: "Pg", color: "#fff" } };
    expect(hitTest(frame, { x: 0.2, y: 0.5 }, SIZE)).toBe(true); // left border
    expect(hitTest(frame, { x: 0.5, y: 0.5 }, SIZE)).toBe(false); // interior
  });
});
