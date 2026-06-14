/**
 * Pure LaTeX segmentation for the derivation renderer.
 *
 * Gemma returns prose interleaved with LaTeX — inline `$...$`, display
 * `$$...$$`, and constructs like `\boxed{...}`. This splits that text into an
 * ordered list of segments so the (client-only) MathText component can hand the
 * math parts to KaTeX and render the prose verbatim.
 *
 * Kept free of React/KaTeX/CSS imports so it is unit-testable on its own.
 */
export type MathSegment =
  | { type: "text"; value: string }
  | { type: "inline"; value: string }
  | { type: "display"; value: string };

// Display ($$...$$) is matched before inline ($...$) by listing it first in the
// alternation. Inline disallows `$` inside so it can't swallow a `$$` fence.
const MATH_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

/**
 * Split `text` into plain-text and math segments, preserving order. Empty
 * math (e.g. a stray `$$`) is left as text so nothing silently disappears.
 */
export function parseMathSegments(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let last = 0;

  for (const m of text.matchAll(MATH_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });

    const tok = m[0];
    if (tok.startsWith("$$")) {
      out.push({ type: "display", value: tok.slice(2, -2).trim() });
    } else {
      out.push({ type: "inline", value: tok.slice(1, -1).trim() });
    }
    last = idx + tok.length;
  }

  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
