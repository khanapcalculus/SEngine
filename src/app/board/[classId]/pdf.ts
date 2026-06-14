/**
 * Client-only PDF rasterizer for the whiteboard.
 *
 * The whiteboard stores images, not PDFs: when a user inserts a PDF we render
 * each page to a PNG in the browser and place the pages as image ops. This keeps
 * the upload route image-only and the board renderer simple (SVG <image>).
 *
 * pdf.js is heavy (~1MB + a web worker) and is browser-only, so this module is
 * imported DYNAMICALLY from page.tsx inside the file-select handler — never at
 * module top level — so it is code-split out of first paint and never runs during
 * SSR. The worker is configured the first time we load.
 */

/** One rasterized page ready to upload + place. */
export interface RasterPage {
  blob: Blob;
  width: number;
  height: number;
}

/** Safety caps so a huge PDF can't exhaust memory or the Blob size limit. */
const MAX_PAGES = 30;
/** Target longest-edge in px for the rendered page (sharp but bounded). */
const TARGET_LONG_EDGE = 1500;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Load pdf.js once and point it at its bundled worker. */
async function getPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Resolve the worker URL through the bundler so it is served as an asset.
      const workerUrl = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Render every page of `file` to a PNG blob. Pages beyond MAX_PAGES are dropped
 * (the caller should surface that). Throws if the file isn't a readable PDF.
 */
export async function rasterizePdf(file: File): Promise<RasterPage[]> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  // Keep the loading task: in pdf.js v6 destroy() lives on the task, not the doc.
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  const pages: RasterPage[] = [];
  const count = Math.min(doc.numPages, MAX_PAGES);

  try {
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas context for the PDF page.");

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      page.cleanup();
      if (blob) pages.push({ blob, width: canvas.width, height: canvas.height });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

/** Whether the rasterizer would skip pages for this document. */
export function exceedsPageCap(numPages: number): boolean {
  return numPages > MAX_PAGES;
}

export { MAX_PAGES };
