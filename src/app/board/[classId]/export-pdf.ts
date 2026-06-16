/**
 * Client-only "export the board to PDF" for the whiteboard.
 *
 * Sessions are framed: a teacher draws inside one or more `frame` regions and,
 * at the end, downloads them as a PDF — one page per frame (or the whole board
 * if no frames were drawn). Everything happens in the browser:
 *
 *   1. clone the live <svg> so we don't disturb what's on screen,
 *   2. INLINE every remote <image> (Vercel Blob) as a data URL — otherwise the
 *      SVG-as-image rasterization either can't fetch them or taints the canvas,
 *   3. rasterize each frame's sub-region to a canvas at 2× for crispness,
 *   4. place each canvas on its own PDF page via jsPDF.
 *
 * jsPDF is heavy and browser-only, so it is imported DYNAMICALLY from the export
 * handler — never at module top level — keeping it out of first paint, the same
 * pattern pdf.ts uses for pdf.js.
 */
import { BG } from "./strokes";

/** A normalized frame region to export as one page. */
export interface ExportRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** Supersampling factor for the rasterized pages (sharper text/vectors). */
const SCALE = 2;
/** Cap a page's longest edge (px) so a giant board can't blow up memory. */
const MAX_EDGE = 4000;

/**
 * Replace every <image href> in `svg` with an inlined data URL. Failures are
 * swallowed per-image (that page just renders without that picture) so one bad
 * asset can't abort the whole export.
 */
async function inlineImages(svg: SVGSVGElement): Promise<void> {
  const images = Array.from(svg.querySelectorAll("image"));
  await Promise.all(
    images.map(async (img) => {
      const href =
        img.getAttribute("href") || img.getAttribute("xlink:href") || "";
      if (!href || href.startsWith("data:")) return;
      try {
        const res = await fetch(href, { mode: "cors" });
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        img.setAttribute("href", dataUrl);
        img.setAttribute("xlink:href", dataUrl);
      } catch {
        /* leave the original href; the page just omits this image */
      }
    }),
  );
}

/** Rasterize the SVG image, cropping to a normalized region, onto a canvas. */
function rasterizeRegion(
  imgUrl: string,
  region: ExportRegion,
  boardW: number,
  boardH: number,
  bg: string,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = region.x * boardW;
      const sy = region.y * boardH;
      const sw = Math.max(1, region.w * boardW);
      const sh = Math.max(1, region.h * boardH);

      let scale = SCALE;
      if (Math.max(sw, sh) * scale > MAX_EDGE) scale = MAX_EDGE / Math.max(sw, sh);

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Crop the source region; the SVG rasterizes crisply at the dest size.
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Could not rasterize the board SVG."));
    img.src = imgUrl;
  });
}

/**
 * Export `regions` (or the whole board when empty) from `svg` to a downloaded
 * PDF. `size` is the board's live pixel size; `filename` the download name.
 */
export async function exportBoardPdf(
  svg: SVGSVGElement,
  regions: ExportRegion[],
  size: { w: number; h: number },
  filename: string,
  bg: string = BG,
): Promise<void> {
  if (size.w === 0 || size.h === 0) throw new Error("The board has no size yet.");

  const pages: ExportRegion[] =
    regions.length > 0
      ? regions
      : [{ x: 0, y: 0, w: 1, h: 1, label: "Board" }];

  // Clone so we never mutate the on-screen SVG, then pin its pixel size so the
  // crop math (region × board px) maps to the rasterized source 1:1.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(size.w));
  clone.setAttribute("height", String(size.h));
  clone.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
  // Neutralize the camera (pan/zoom) so content sits at its board pixels and the
  // crop math (region × board px) lines up regardless of the live view.
  clone.querySelectorAll("[data-camera]").forEach((n) => n.removeAttribute("transform"));
  // Drop transient overlay layers (selection handles, cursors) if tagged.
  clone.querySelectorAll("[data-export-skip]").forEach((n) => n.remove());

  await inlineImages(clone);

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);

  const canvases: HTMLCanvasElement[] = [];
  for (const region of pages) {
    canvases.push(await rasterizeRegion(svgUrl, region, size.w, size.h, bg));
  }

  const { jsPDF } = await import("jspdf");
  let doc: import("jspdf").jsPDF | null = null;
  canvases.forEach((canvas, i) => {
    const w = canvas.width;
    const h = canvas.height;
    const orientation = w >= h ? "landscape" : "portrait";
    if (i === 0) {
      doc = new jsPDF({ orientation, unit: "px", format: [w, h], compress: true });
    } else {
      doc!.addPage([w, h], orientation);
    }
    doc!.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
  });

  doc!.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

/**
 * Rasterize the WHOLE board to a PNG Blob — used by "End Session" to capture a
 * snapshot before closing the books. Shares the clone → inline-images →
 * rasterize pipeline with the PDF export, so the snapshot matches what's drawn.
 */
export async function captureBoardPng(
  svg: SVGSVGElement,
  size: { w: number; h: number },
  bg: string = BG,
): Promise<Blob> {
  if (size.w === 0 || size.h === 0) throw new Error("The board has no size yet.");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(size.w));
  clone.setAttribute("height", String(size.h));
  clone.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
  clone.querySelectorAll("[data-camera]").forEach((n) => n.removeAttribute("transform"));
  clone.querySelectorAll("[data-export-skip]").forEach((n) => n.remove());

  await inlineImages(clone);

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);

  const canvas = await rasterizeRegion(
    svgUrl,
    { x: 0, y: 0, w: 1, h: 1, label: "Board" },
    size.w,
    size.h,
    bg,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode snapshot PNG."))),
      "image/png",
    );
  });
}
