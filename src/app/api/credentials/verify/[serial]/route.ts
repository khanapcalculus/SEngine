/**
 * GET /api/credentials/verify/[serial] — PUBLIC credential verification.
 *
 * Intentionally unauthenticated: anyone holding a diploma serial can confirm it
 * is genuine. The service returns only the minimum (holder name, title, issue
 * date, issuing branch) and {valid:false} for unknown serials — no other student
 * data is exposed, and an unknown serial leaks nothing.
 */
import { getDb } from "../../../../../db/client";
import { json, handleError } from "../../../../../lib/http";
import { verifyCredential } from "../../../../../modules/sis/graduation.service";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serial: string }> },
): Promise<Response> {
  try {
    const { serial } = await params;
    const clean = decodeURIComponent(serial ?? "").trim();
    if (!clean || clean.length > 40) {
      return json({ valid: false }, 200);
    }
    const result = await verifyCredential(getDb(), clean);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}
