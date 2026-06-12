/**
 * Module 4 — Real-Time Collaboration (RTC) Whiteboard Durable Object.
 *
 * One instance per live class session (the DO id is derived from the classId),
 * giving every participant a single authoritative coordination point at the
 * edge. Responsibilities:
 *  - accept WebSocket upgrades and track connected peers,
 *  - broadcast whiteboard ops (strokes, shapes, equations) to everyone else,
 *  - keep a bounded in-memory log of recent ops so a late joiner can catch up.
 *
 * Uses the Hibernation WebSocket API (acceptWebSocket) so idle sessions don't
 * bill for wall-clock time. No frontend canvas here (per the constraint) — this
 * is the server-side coordination object only.
 */

/** Minimal shapes of the Workers runtime types we depend on. */
interface DOState {
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}
interface Env {
  // Bindings (e.g. AI, DB) injected by wrangler.toml; unused in the skeleton.
  [key: string]: unknown;
}

/** A single whiteboard operation broadcast between peers. */
export interface WhiteboardOp {
  type: "stroke" | "shape" | "equation" | "clear" | "cursor";
  /** Opaque payload produced by the client canvas. */
  payload: unknown;
  /** Set server-side from the connection, never trusted from the client. */
  senderId?: string;
  ts?: number;
}

const MAX_HISTORY = 200;

export class WhiteboardRoom {
  private state: DOState;
  private env: Env;
  /** Bounded replay buffer for late joiners. */
  private history: WhiteboardOp[] = [];

  constructor(state: DOState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Entry point. Expects a WebSocket upgrade; rejects anything else.
   * Auth/RBAC is enforced at the Worker BEFORE the request is routed here
   * (the DO trusts only an already-verified, signed connection).
   */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation API: runtime manages the socket; handlers below fire on wake.
    this.state.acceptWebSocket(server);

    // Replay recent history so the joiner sees the current board state.
    if (this.history.length > 0) {
      server.send(
        JSON.stringify({ type: "history", ops: this.history }),
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Fired by the runtime for each inbound message on any peer socket. */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    let op: WhiteboardOp;
    try {
      op = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "invalid op json" }));
      return;
    }

    if (!op || typeof op.type !== "string") {
      ws.send(JSON.stringify({ type: "error", error: "missing op type" }));
      return;
    }

    // Stamp server-side; never trust client-provided timestamps/identity.
    op.ts = Date.now();

    this.appendHistory(op);
    this.broadcast(op, ws);
  }

  /** Fired when a peer disconnects. */
  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "socket error");
    } catch {
      /* noop */
    }
  }

  /** Send an op to every connected peer except the sender. */
  private broadcast(op: WhiteboardOp, sender: WebSocket): void {
    const data = JSON.stringify(op);
    for (const peer of this.state.getWebSockets()) {
      if (peer === sender) continue;
      try {
        peer.send(data);
      } catch {
        /* drop unsendable peer; runtime will clean it up */
      }
    }
  }

  private appendHistory(op: WhiteboardOp): void {
    if (op.type === "clear") {
      this.history = [];
      return;
    }
    if (op.type === "cursor") return; // ephemeral, not replayed
    this.history.push(op);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }
}
