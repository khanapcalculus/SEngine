/**
 * GET /api/health — unauthenticated liveness probe.
 * Confirms the app is deployed and serving; used by uptime checks and to
 * verify the Vercel deployment resolves (vs. the prior 404).
 *
 * Also reports BOOLEAN config presence (never the secret values) so we can
 * confirm from the browser whether a given deployment actually received its
 * env vars — e.g. whether a connected Vercel Blob store's token reached the
 * running deployment.
 */
import { json } from "../../../lib/http";

export const runtime = "edge";

export async function GET(): Promise<Response> {
  return json({
    status: "ok",
    service: "sengine-erp-lms",
    config: {
      blob: !!process.env.BLOB_READ_WRITE_TOKEN,
      rtc: !!process.env.RTC_JWT_SECRET,
      whiteboardWs: !!process.env.WHITEBOARD_WS_URL,
    },
  });
}
