/**
 * GET /api/health — unauthenticated liveness probe.
 * Confirms the app is deployed and serving; used by uptime checks and to
 * verify the Vercel deployment resolves (vs. the prior 404).
 */
import { json } from "../../../lib/http";

export const runtime = "edge";

export async function GET(): Promise<Response> {
  return json({ status: "ok", service: "sengine-erp-lms" });
}
