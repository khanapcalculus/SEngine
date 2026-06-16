/**
 * RTC Whiteboard Worker — the edge entry point in front of the Durable Object.
 *
 * Responsibilities (everything the DO is allowed to trust happens HERE):
 *   1. Route  GET /room/:classId  (WebSocket upgrade) to the room's DO.
 *   2. Verify the ?t=<rtc-token> handshake BEFORE upgrading — reusing the exact
 *      sign/verify code the Vercel app used to mint it (../../src/lib/rtc-token),
 *      so the two halves can never drift.
 *   3. Bind the token to the room: the token's classId MUST equal the path's
 *      classId, else a valid token for room A can't be replayed against room B.
 *   4. Forward the caller's identity/permissions to the DO via internal headers
 *      (x-rtc-*), so the DO never re-parses the token or trusts client input.
 *
 * The WhiteboardRoom DO itself lives in the Next app's source tree
 * (src/modules/lms/whiteboard.do.ts) and is unit-tested there; we re-export it
 * so wrangler can bind it as this Worker's Durable Object class.
 */
import { verifyRtcToken, RtcTokenVerifyError } from "../../src/lib/rtc-token";
import { WhiteboardRoom } from "../../src/modules/lms/whiteboard.do";

export { WhiteboardRoom };

export interface Env {
  WHITEBOARD_ROOM: DurableObjectNamespace;
  /** MUST match the Vercel app's RTC_JWT_SECRET. */
  RTC_JWT_SECRET: string;
}

/** Matches GET /room/:classId */
const ROOM_RE = /^\/room\/([^/]+)\/?$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    const match = ROOM_RE.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    const classId = decodeURIComponent(match[1]);

    // Two request kinds share the /room/:classId route, both token-verified:
    //  - a WebSocket upgrade (live board), or
    //  - a server-side context dump for the AI tutor (header `x-rtc-op: context`,
    //    sent by the Vercel route — no browser, so no Upgrade header).
    const isContextFetch = req.headers.get("x-rtc-op") === "context";
    if (!isContextFetch && req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    if (!env.RTC_JWT_SECRET) {
      // Fail closed: a missing secret must never allow an unverified connect.
      return new Response("RTC not configured", { status: 503 });
    }

    // Token may arrive as ?t= or in the Sec-WebSocket-Protocol header (browsers
    // can't set Authorization on WebSocket). We accept the query param here.
    const token = url.searchParams.get("t");
    if (!token) return new Response("Missing handshake token", { status: 401 });

    let claims;
    try {
      claims = await verifyRtcToken(token, env.RTC_JWT_SECRET, {
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      const reason =
        err instanceof RtcTokenVerifyError ? err.reason : "invalid";
      return new Response(`Invalid handshake token: ${reason}`, {
        status: 401,
      });
    }

    // A token is valid for exactly the room it was minted for.
    if (claims.classId !== classId) {
      return new Response("Token does not match room", { status: 403 });
    }

    // One DO instance per class — every participant in a class converges on the
    // same single-threaded actor (idFromName is deterministic per classId).
    const id = env.WHITEBOARD_ROOM.idFromName(classId);
    const stub = env.WHITEBOARD_ROOM.get(id);

    // Hand the DO the already-verified identity via trusted internal headers.
    // The DO must read these, NEVER the raw token or any client-sent field.
    const forwarded = new Request(req.url, req);
    forwarded.headers.set("x-rtc-user-id", claims.sub);
    forwarded.headers.set("x-rtc-role", claims.role);
    forwarded.headers.set("x-rtc-can-draw", claims.canDraw ? "1" : "0");

    return stub.fetch(forwarded);
  },
};
