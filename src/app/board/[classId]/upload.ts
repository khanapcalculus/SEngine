/**
 * Client upload helpers for whiteboard image/PDF inserts.
 *
 * Thin wrapper over @vercel/blob/client's `upload()` (the same client-upload
 * handshake the submissions feature uses), pointed at the class-scoped board
 * route. The route mints a short-lived, access-checked token; the file goes
 * straight to Blob storage and we get back a public URL to put in an image op.
 */
import { upload } from "@vercel/blob/client";

/** Upload one image blob for a class board; resolves to its public URL. */
export async function uploadBoardImage(
  classId: string,
  blob: Blob,
  filename: string,
): Promise<string> {
  const result = await upload(filename, blob, {
    access: "public",
    handleUploadUrl: `/api/me/classroom/${classId}/whiteboard-upload`,
  });
  return result.url;
}

/** Natural pixel dimensions of an image blob (for aspect-correct placement). */
export async function imageNaturalSize(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  // createImageBitmap is the simplest reliable decode in modern browsers.
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return dims;
  }
  // Fallback: decode via an <img> element.
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Given a natural pixel aspect and the surface size, compute a normalized
 * {w,h} box that fits within `maxFrac` of the viewport while preserving aspect.
 */
export function fitNormalized(
  naturalW: number,
  naturalH: number,
  size: { w: number; h: number },
  maxFrac = 0.4,
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0 || size.w === 0 || size.h === 0) {
    return { w: maxFrac, h: maxFrac };
  }
  const aspect = naturalW / naturalH;
  // Start from the max box (in normalized units) and shrink to keep aspect.
  let w = maxFrac;
  let h = (w * size.w) / aspect / size.h; // normalized height for that width
  if (h > maxFrac) {
    h = maxFrac;
    w = (h * size.h * aspect) / size.w;
  }
  return { w, h };
}
