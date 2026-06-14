/**
 * Tests for the pure LaTeX segmenter.
 * Run: npx vitest run src/app/dashboard/whiteboard/math-segments.test.ts
 */
import { describe, it, expect } from "vitest";
import { parseMathSegments } from "./math-segments";

describe("parseMathSegments", () => {
  it("returns a single text segment when there is no math", () => {
    expect(parseMathSegments("just words")).toEqual([
      { type: "text", value: "just words" },
    ]);
  });

  it("extracts an inline math segment between prose", () => {
    expect(parseMathSegments("the value $x = 2$ holds")).toEqual([
      { type: "text", value: "the value " },
      { type: "inline", value: "x = 2" },
      { type: "text", value: " holds" },
    ]);
  });

  it("extracts a display math segment", () => {
    expect(parseMathSegments("$$\\int_0^1 x^2\\,dx$$")).toEqual([
      { type: "display", value: "\\int_0^1 x^2\\,dx" },
    ]);
  });

  it("does not let inline matching swallow a display fence", () => {
    const segs = parseMathSegments("a $$y=1$$ b");
    expect(segs).toEqual([
      { type: "text", value: "a " },
      { type: "display", value: "y=1" },
      { type: "text", value: " b" },
    ]);
  });

  it("handles multiple mixed segments incl. a boxed result", () => {
    const segs = parseMathSegments(
      "Step 1: $a+b$.\nRESULT: $$\\boxed{c=3}$$\ndone",
    );
    expect(segs.map((s) => s.type)).toEqual([
      "text",
      "inline",
      "text",
      "display",
      "text",
    ]);
    expect(segs[3]).toEqual({ type: "display", value: "\\boxed{c=3}" });
  });

  it("trims whitespace inside math but preserves surrounding text", () => {
    const segs = parseMathSegments("x $$  a = b  $$ y");
    expect(segs[1]).toEqual({ type: "display", value: "a = b" });
    expect(segs[0]).toEqual({ type: "text", value: "x " });
    expect(segs[2]).toEqual({ type: "text", value: " y" });
  });

  it("leaves an empty input as no segments", () => {
    expect(parseMathSegments("")).toEqual([]);
  });
});
