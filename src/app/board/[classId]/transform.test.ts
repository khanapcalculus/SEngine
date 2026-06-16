/**
 * Unit tests for the affine transform core (./transform) — the math behind
 * collaborative move / resize / rotate. Pure, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  IDENTITY,
  asMat,
  isIdentity,
  multiply,
  apply,
  invert,
  scaleAbout,
  rotateAbout,
  toPixelMatrix,
  pixelDeltaToNorm,
  opBBox,
  unionBBox,
  resizeMatrix,
  rotateMatrix,
  translateMatrix,
  type Mat,
} from "./transform";
import type { Size } from "./tools";

const SIZE: Size = { w: 1000, h: 500 };
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const nearPt = (p: { x: number; y: number }, x: number, y: number) => {
  near(p.x, x);
  near(p.y, y);
};

describe("matrix algebra", () => {
  it("identity is detected and applied as a no-op", () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(undefined)).toBe(true);
    expect(isIdentity([1, 0, 0, 1, 0.1, 0])).toBe(false);
    nearPt(apply(IDENTITY, { x: 0.3, y: 0.7 }), 0.3, 0.7);
  });

  it("multiply applies the right matrix first", () => {
    const t = translateMatrix(IDENTITY, 0.1, 0.2); // translate(0.1,0.2)
    const s = scaleAbout(2, 2, 0, 0);
    // (t ∘ s) scales then translates: point (0.1,0.1) -> (0.2,0.2) -> (0.3,0.4)
    nearPt(apply(multiply(t, s), { x: 0.1, y: 0.1 }), 0.3, 0.4);
  });

  it("invert undoes a transform", () => {
    const m = multiply(rotateAbout(0.5, 0.4, 0.4), scaleAbout(1.7, 0.6, 0.2, 0.2));
    const p = { x: 0.33, y: 0.81 };
    nearPt(apply(invert(m), apply(m, p)), p.x, p.y);
  });

  it("asMat narrows a 6-number array, else identity", () => {
    expect(asMat([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(asMat([1, 2, 3])).toEqual(IDENTITY);
    expect(asMat("nope")).toEqual(IDENTITY);
    expect(asMat([1, 2, 3, 4, 5, NaN])).toEqual(IDENTITY);
  });

  it("scaleAbout keeps the pivot fixed", () => {
    nearPt(apply(scaleAbout(3, 3, 0.5, 0.5), { x: 0.5, y: 0.5 }), 0.5, 0.5);
    nearPt(apply(scaleAbout(2, 2, 0.5, 0.5), { x: 0.6, y: 0.5 }), 0.7, 0.5);
  });

  it("rotateAbout keeps the pivot fixed and rotates 90°", () => {
    const m = rotateAbout(Math.PI / 2, 0.5, 0.5);
    nearPt(apply(m, { x: 0.5, y: 0.5 }), 0.5, 0.5);
    nearPt(apply(m, { x: 0.6, y: 0.5 }), 0.5, 0.6);
  });
});

describe("normalized ↔ pixel", () => {
  it("toPixelMatrix conjugates a pure translate into pixel units", () => {
    const m: Mat = [1, 0, 0, 1, 0.1, 0.2]; // normalized translate
    const px = toPixelMatrix(m, SIZE.w, SIZE.h);
    // translate 0.1·w = 100, 0.2·h = 100
    near(px[4], 100);
    near(px[5], 100);
  });

  it("pixelDeltaToNorm is the inverse conjugation of toPixelMatrix's space", () => {
    const dPx = scaleAbout(2, 2, 100, 50); // a pixel-space delta
    const dNorm = pixelDeltaToNorm(dPx, SIZE.w, SIZE.h);
    // applying the normalized delta then scaling to px == pixel delta on px point
    const norm = { x: 0.3, y: 0.4 };
    const viaNorm = apply(dNorm, norm);
    nearPt({ x: viaNorm.x * SIZE.w, y: viaNorm.y * SIZE.h }, apply(dPx, { x: norm.x * SIZE.w, y: norm.y * SIZE.h }).x, apply(dPx, { x: norm.x * SIZE.w, y: norm.y * SIZE.h }).y);
  });
});

describe("opBBox", () => {
  it("bounds a stroke by its points", () => {
    const b = opBBox({ type: "stroke", payload: { points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }] } });
    expect(b).toMatchObject({ x: 0.2, y: 0.1 });
    near(b!.w, 0.4);
    near(b!.h, 0.2);
  });

  it("bounds a shape and returns null for junk", () => {
    const b = opBBox({ type: "shape", payload: { kind: "rect", start: { x: 0.1, y: 0.1 }, end: { x: 0.5, y: 0.4 } } });
    expect(b).toMatchObject({ x: 0.1, y: 0.1 });
    expect(opBBox({ type: "shape", payload: { kind: "junk" } })).toBeNull();
  });

  it("unionBBox merges boxes", () => {
    const u = unionBBox([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.5, y: 0.4, w: 0.1, h: 0.1 },
    ]);
    expect(u).toMatchObject({ x: 0.1, y: 0.1 });
    near(u!.w, 0.5);
    near(u!.h, 0.4);
  });
});

describe("resizeMatrix", () => {
  const bbox = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }; // se corner = (0.6,0.6)

  it("dragging the SE corner lands exactly under the cursor", () => {
    const m = resizeMatrix(bbox, IDENTITY, "se", { x: 0.8, y: 0.8 });
    // the SE object-space point (0.6,0.6) should now map to (0.8,0.8)
    nearPt(apply(m, { x: 0.6, y: 0.6 }), 0.8, 0.8);
    // the NW anchor (0.2,0.2) stays put
    nearPt(apply(m, { x: 0.2, y: 0.2 }), 0.2, 0.2);
  });

  it("an edge handle scales only one axis", () => {
    const m = resizeMatrix(bbox, IDENTITY, "e", { x: 0.9, y: 0.5 });
    // x stretched, y unchanged at the east mid-point
    nearPt(apply(m, { x: 0.6, y: 0.4 }), 0.9, 0.4);
  });

  it("resize composes correctly on an already-rotated object", () => {
    const rot = rotateAbout(Math.PI / 2, 0.4, 0.4);
    const m = resizeMatrix(bbox, rot, "se", { x: 0.1, y: 0.9 });
    // The transformed SE handle still follows the cursor.
    nearPt(apply(m, { x: 0.6, y: 0.6 }), 0.1, 0.9);
  });

  it("uniform locks aspect on a corner", () => {
    const m = resizeMatrix(bbox, IDENTITY, "se", { x: 1.0, y: 0.65 }, true);
    // equal scale on both axes => |sx| == |sy|
    near(Math.abs(m[0]), Math.abs(m[3]));
  });
});

describe("rotateMatrix", () => {
  it("rotates about the world center by the pixel-space angle", () => {
    const center = { x: 0.5, y: 0.5 };
    const m = rotateMatrix(IDENTITY, center, Math.PI / 2, { w: 600, h: 600 }); // square px → clean rotation
    // a point to the east of center rotates to the south (square pixel space)
    nearPt(apply(m, { x: 0.6, y: 0.5 }), 0.5, 0.6);
    nearPt(apply(m, center), 0.5, 0.5);
  });
});
