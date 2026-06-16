/**
 * Client upload helpers for whiteboard image/PDF inserts.
 *
 * The browser POSTs the file (multipart/form-data) to our class-scoped route,
 * which uploads to Vercel Blob server-side and returns the public URL. We do NOT
 * use @vercel/blob/client's direct browser→Blob handshake — that PUT to Vercel's
 * Blob API was rejected (400/CORS) in this deployment, so routing bytes through
 * our own Node function is the robust path.
 */

/** Upload one image blob for a class board; resolves to its public URL. */
export async function uploadBoardImage(
  classId: string,
  blob: Blob,
  filename: string,
): Promise<string> {
  return (await uploadBoardImageDetailed(classId, blob, filename)).url;
}

/** Like uploadBoardImage but also returns the Blob storage key (pathname). */
export async function uploadBoardImageDetailed(
  classId: string,
  blob: Blob,
  filename: string,
): Promise<{ url: string; storageKey: string }> {
  const form = new FormData();
  // Name the part "file" (the route reads form.get("file")). Provide a filename.
  form.append("file", blob, filename);

  const res = await fetch(`/api/me/classroom/${classId}/whiteboard-upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== "string") {
    throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return { url: data.url, storageKey: typeof data.pathname === "string" ? data.pathname : data.url };
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
