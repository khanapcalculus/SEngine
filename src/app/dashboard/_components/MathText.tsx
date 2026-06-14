"use client";

/**
 * Renders text with real math: prose verbatim, `$...$` and `$$...$$` via KaTeX.
 * Shared by the whiteboard derivation panel and the discussion post renderer,
 * so any saved derivation (or a student's `$x^2$`) shows as typeset math.
 * Segmentation is the pure parseMathSegments; this module adds the client-only
 * concerns (KaTeX + its stylesheet, dangerouslySetInnerHTML for the HTML).
 *
 * Style-neutral by design — the caller supplies any surrounding chrome (the
 * derivation panel wraps it in a box; discussion posts render it inline).
 *
 * KaTeX runs with throwOnError:false so a malformed expression renders in the
 * error colour inline instead of blowing up the surrounding view.
 */
import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { parseMathSegments } from "./math-segments";

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
    });
  } catch {
    // Last-resort guard (renderToString shouldn't throw with throwOnError:false).
    return tex;
  }
}

export function MathText({ text }: { text: string }) {
  const segments = useMemo(() => parseMathSegments(text), [text]);

  return (
    <div style={{ lineHeight: 1.6, overflowX: "auto" }}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          // Preserve the newlines/indentation of the numbered steps.
          return (
            <span key={i} style={{ whiteSpace: "pre-wrap" }}>
              {seg.value}
            </span>
          );
        }
        const html = renderKatex(seg.value, seg.type === "display");
        if (seg.type === "display") {
          return (
            <div
              key={i}
              style={{ margin: "8px 0" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}
