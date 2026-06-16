/**
 * Module 4 — Real-Time Collaboration (RTC) Whiteboard Durable Object.
 *
 * One instance per live class session (the DO id is derived from the classId),
 * giving every participant a single authoritative coordination point at the
 * edge. Responsibilities:
 *  - accept WebSocket upgrades and track connected peers,
 *  - stamp each op with the SERVER-verified sender identity + timestamp,
 *  - broadcast whiteboard ops (strokes, shapes, equations, cursors) to peers,
 *  - keep a bounded in-memory log of recent ops so a late joiner can catch up.
 *
 * Identity: the fronting Worker verifies the RTC handshake token and forwards
 * the caller's user id in the `x-rtc-user-id` header (the socket itself carries
 * no session). We persist that id on the connection via the Hibernation
 * attachment API so it survives the socket hibernating, then stamp every inbound
 * op's `senderId` from it — never from client-supplied fields (Guideline #4).
 * This is what lets the client attribute cursors/strokes to specific peers.
 *
 * Uses the Hibernation WebSocket API (acceptWebSocket) so idle sessions don't
 * bill for wall-clock time. No frontend canvas here (per the constraint) — this
 * is the server-side coordination object only.
 *
 * Persistence: the op log is durable, not just in-memory. Every persistent op
 * (stroke / shape / equation / modify / erase) is write-through to the DO's
 * transactional storage under a monotonic, zero-padded key, and the constructor
 * rehydrates `history` from storage before serving any request. This is what
 * makes the board survive the DO hibernating or being evicted when the last peer
 * leaves: a user who closes the board and rejoins — or a brand-new peer who joins
 * after everyone left — replays the FULL prior state, including every other
 * user's edits, because creates/modifies/erases reduce deterministically on the
 * client (see connection.ts). A `clear` wipes both the buffer and storage.
 */

/** Minimal shapes of the Workers runtime types we depend on. */
interface DOStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: {
    prefix?: string;
    start?: string;
    end?: string;
    limit?: number;
    reverse?: boolean;
  }): Promise<Map<string, T>>;
}
interface DOState {
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
  storage: DOStorage;
  /** Defer request handling until `fn` resolves — used to rehydrate on wake. */
  blockConcurrencyWhile(fn: () => Promise<void>): void;
}
interface Env {
  // Bindings (e.g. AI, DB) injected by wrangler.toml; unused in the skeleton.
  [key: string]: unknown;
}

/**
 * The Hibernation attachment + identity surface we use on a socket. The runtime
 * WebSocket provides serialize/deserializeAttachment; we narrow to what we need.
 */
interface IdentifiedSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** What we persist per connection so it survives hibernation. */
interface SocketAttachment {
  userId: string | null;
}

/** A single whiteboard operation broadcast between peers. */
export interface WhiteboardOp {
  /**
   * `modify`/`erase` are persisted alongside the create ops (`stroke`/`shape`/
   * `equation`) so a rejoin replays edits too; `clear`/`cursor` are control/
   * ephemeral and never stored.
   */
  type: "stroke" | "shape" | "equation" | "modify" | "erase" | "clear" | "cursor";
  /** Opaque payload produced by the client canvas. */
  payload: unknown;
  /** Set server-side from the verified connection, never trusted from the client. */
  senderId?: string;
  ts?: number;
}

/**
 * Replay-buffer cap. Generous because the buffer is now durable and replays the
 * WHOLE board on rejoin — trimming too aggressively would drop creates that
 * later `modify`/`erase` ops still reference. Oldest ops past this are pruned
 * from both memory and storage.
 */
const MAX_HISTORY = 10_000;

/** Persistent ops are stored under `op:<zero-padded seq>` (lexicographic = chronological). */
const OP_KEY_PREFIX = "op:";
const SEQ_WIDTH = 12;
const opKey = (seq: number) => OP_KEY_PREFIX + String(seq).padStart(SEQ_WIDTH, "0");

export class WhiteboardRoom {
  private state: DOState;
  private env: Env;
  /** Bounded replay buffer for late joiners, mirrored to durable storage. */
  private history: WhiteboardOp[] = [];
  /** Next storage sequence number; persisted keys are contiguous [firstSeq, nextSeq). */
  private nextSeq = 0;
  private firstSeq = 0;

  constructor(state: DOState, env: Env) {
    this.state = state;
    this.env = env;
    // Rehydrate the durable op log before any request is served. Without this,
    // a DO that hibernated/was evicted (every peer left) would wake with an
    // empty board and the rejoining user would lose all prior work. Wrapped so a
    // storage hiccup can't reject construction and brick the room.
    this.state.blockConcurrencyWhile(async () => {
      try {
        const stored = await this.state.storage.list<WhiteboardOp>({
          prefix: OP_KEY_PREFIX,
        });
        const keys = [...stored.keys()].sort();
        if (keys.length > 0) {
          this.history = keys.map((k) => stored.get(k)!);
          this.firstSeq = seqOfKey(keys[0]);
          this.nextSeq = seqOfKey(keys[keys.length - 1]) + 1;
        }
        console.log(`[whiteboard.do] hydrated ${this.history.length} ops from storage`);
      } catch (err) {
        console.error("[whiteboard.do] hydrate failed:", err);
      }
    });
  }

  /**
   * Entry point. Two kinds of request reach the DO:
   *  - a WebSocket upgrade (live collaboration), or
   *  - a server-side **context dump** (header `x-rtc-op: context`) used by the AI
   *    tutor route to read the current board WITHOUT a browser. Both are already
   *    token-verified by the fronting Worker before they get here.
   */
  async fetch(req: Request): Promise<Response> {
    // Server-side AI context fetch: return a text extraction of the live board.
    if (req.headers.get("x-rtc-op") === "context") {
      return this.contextResponse();
    }

    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Identity comes from the Worker's trusted internal header, not the client.
    const userId = req.headers.get("x-rtc-user-id");

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation API: runtime manages the socket; handlers below fire on wake.
    this.state.acceptWebSocket(server);

    // Persist the identity on the connection so webSocketMessage can stamp
    // senderId even after the socket has hibernated and woken.
    const attachment: SocketAttachment = { userId: userId ?? null };
    (server as IdentifiedSocket).serializeAttachment(attachment);

    // Replay recent history so the joiner sees the current board state.
    console.log(`[whiteboard.do] connect; replaying ${this.history.length} ops`);
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

    // Stamp identity + time server-side; never trust client-provided values.
    op.senderId = this.senderIdOf(ws);
    op.ts = Date.now();

    // Update the in-memory replay buffer and broadcast to peers FIRST so live
    // collaboration never depends on a storage round-trip; then persist. A
    // storage failure degrades durability for that op, not the live session.
    this.recordInMemory(op);
    this.broadcast(op, ws);
    await this.persist(op);
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

  /** Read the verified user id persisted on the connection (undefined if none). */
  private senderIdOf(ws: WebSocket): string | undefined {
    try {
      const att = (ws as IdentifiedSocket).deserializeAttachment() as
        | SocketAttachment
        | null;
      return att?.userId ?? undefined;
    } catch {
      return undefined;
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

  /**
   * Update the in-memory replay buffer for an op (or wipe it on `clear`). This
   * is the source of truth for live replay and never touches storage, so it
   * can't fail. `cursor` ops are ephemeral and ignored.
   */
  private recordInMemory(op: WhiteboardOp): void {
    if (op.type === "clear") {
      this.history = [];
      this.firstSeq = 0;
      this.nextSeq = 0;
      return;
    }
    if (op.type === "cursor") return;
    this.history.push(op);
  }

  /**
   * Mirror the op to durable storage so the board survives hibernation/eviction.
   * Best-effort + logged: a storage failure degrades durability for one op but
   * never breaks the live session (the op is already in memory + broadcast).
   */
  private async persist(op: WhiteboardOp): Promise<void> {
    try {
      if (op.type === "clear") {
        await this.state.storage.deleteAll();
        return;
      }
      if (op.type === "cursor") return;

      const seq = this.nextSeq++;
      await this.state.storage.put(opKey(seq), op);

      // Prune the oldest ops from both memory and storage past the cap.
      if (this.history.length > MAX_HISTORY) {
        const drop = this.history.length - MAX_HISTORY;
        this.history = this.history.slice(drop);
        const dropKeys: string[] = [];
        for (let i = 0; i < drop; i++) dropKeys.push(opKey(this.firstSeq + i));
        this.firstSeq += drop;
        await Promise.all(dropKeys.map((k) => this.state.storage.delete(k)));
      }
    } catch (err) {
      console.error("[whiteboard.do] persist failed:", err);
    }
  }

  /**
   * Build a plain-text extraction of the current board for the AI tutor. Pulls
   * the human-readable content out of each persistent op (text labels, LaTeX
   * equations, shape kinds) so Gemma receives the actual lesson context — what's
   * written on the board — rather than raw coordinate JSON. Bounded so the prompt
   * stays predictable. Returned as JSON `{ classId?, text, opCount }`.
   */
  private contextResponse(): Response {
    const lines: string[] = [];
    let shapes = 0;
    for (const op of this.history) {
      const p = (op.payload ?? {}) as Record<string, unknown>;
      if (op.type === "equation" && typeof p.latex === "string") {
        lines.push(`Equation: ${p.latex}`);
      } else if (op.type === "shape" && p.kind === "text" && typeof p.text === "string") {
        lines.push(`Text: ${p.text}`);
      } else if (op.type === "shape" && typeof p.kind === "string") {
        shapes++;
      } else if (op.type === "stroke") {
        shapes++;
      }
    }
    if (shapes > 0) {
      lines.push(`(plus ${shapes} freehand/shape marks without extractable text)`);
    }
    // Cap to keep the downstream prompt bounded (mirrors MAX_CONTEXT server-side).
    let text = lines.join("\n");
    if (text.length > 8000) text = text.slice(0, 8000) + "\n…(truncated)";

    return new Response(
      JSON.stringify({ text, opCount: this.history.length }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
}

/** Parse the numeric sequence out of an `op:<seq>` storage key. */
function seqOfKey(key: string): number {
  return Number(key.slice(OP_KEY_PREFIX.length));
}
