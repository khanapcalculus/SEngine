/**
 * Whiteboard RTC connection — framework-agnostic core.
 *
 * Owns the full client lifecycle for one class's live whiteboard:
 *   1. POST /api/me/classroom/token   → short-lived handshake token + ws url
 *   2. open a WebSocket to the Cloudflare Worker (token as ?t=)
 *   3. apply inbound frames (history / ops / cursors / clear / error) to state
 *   4. send local ops (gated by the server-decided canDraw capability)
 *   5. auto-reconnect with backoff, re-minting a fresh token each attempt
 *      (tokens are ~60s; only valid at connect time)
 *
 * All side-effecting dependencies (fetch, WebSocket, timers, clock) are injected
 * so the logic is unit-testable with fakes — the React hook in
 * useWhiteboardSocket.ts supplies the real browser implementations. This mirrors
 * how the services take an injected db handle.
 */

export type WhiteboardOpType =
  | "stroke"
  | "shape"
  | "equation"
  | "clear"
  | "cursor"
  | "erase"
  | "modify";

/** Style overrides a `modify` op can re-apply to an existing object. */
export interface ObjStyle {
  color?: string;
  width?: number;
  fontSize?: number;
  fill?: boolean;
  fillColor?: string;
}

/**
 * The live mutation layered on top of an object's immutable create op:
 * a normalized affine `m` (move/resize/rotate), `style` overrides, and a
 * `deleted` tombstone. Reduced from `modify` ops exactly like `erased` — a
 * create always precedes its modifies, so replay re-derives the same state.
 */
export interface ObjMutation {
  m?: number[];
  style?: ObjStyle;
  deleted?: boolean;
  /** Paint-order override; higher draws later (front). Default 0. */
  z?: number;
}

export interface WhiteboardOp {
  type: WhiteboardOpType;
  /** Opaque canvas payload (coords, path, text, …). */
  payload?: unknown;
  /** Stamped by the server from the verified connection (best-effort today). */
  senderId?: string;
  ts?: number;
}

/** Response shape of POST /api/me/classroom/token. */
export interface ClassroomToken {
  token: string;
  wsUrl: string;
  role: string;
  canDraw: boolean;
  expiresAt: number;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export interface WhiteboardState {
  status: ConnectionStatus;
  /** Whether this peer may emit mutating ops (decided server-side). */
  canDraw: boolean;
  role: string | null;
  error: string | null;
  /** Persistent drawing ops in receive order (cursors/clears excluded). */
  ops: WhiteboardOp[];
  /** Latest cursor op per sender (ephemeral presence). */
  cursors: Record<string, WhiteboardOp>;
  /**
   * Ids tombstoned by an `erase` op (or a `modify` with deleted:true). Kept as a
   * set rather than splicing `ops` so erasing is idempotent and survives history
   * replay: a create always precedes its erase in the op log, so re-seeding
   * re-derives the same state. Renderers skip any op whose id is in this set.
   */
  erased: Set<string>;
  /**
   * Per-object mutation (transform + style) reduced from `modify` ops. Kept in
   * lockstep with `erased`. Renderers read it to layer move/resize/rotate and
   * restyle over the object's original create.
   */
  mutations: Map<string, ObjMutation>;
}

/** Minimal structural WebSocket so tests can inject a fake. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionDeps {
  fetchToken: (classId: string) => Promise<ClassroomToken>;
  createSocket: (url: string) => SocketLike;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

// Safety cap on the local op log. Matches the server DO's MAX_HISTORY so a full
// board replayed on (re)join isn't truncated below what was persisted.
const MAX_OPS = 10_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

const PERSISTENT: ReadonlySet<string> = new Set<WhiteboardOpType>([
  "stroke",
  "shape",
  "equation",
]);

/** A frame received from the server — op frames plus control frames. */
interface InboundFrame {
  type: string;
  payload?: unknown;
  senderId?: string;
  ts?: number;
  ops?: WhiteboardOp[];
  error?: string;
}

/**
 * Coerce a server-provided ws URL to an absolute WebSocket scheme. Defensive:
 * if the token route returns a scheme-less host (a stale deploy, or a
 * WHITEBOARD_WS_URL set without "wss://"), the browser would otherwise resolve
 * it RELATIVE to the page origin and dial the wrong host
 * (e.g. wss://app.vercel.app/dashboard/<host>/room/...). Mirrors the
 * normalization the token route does server-side, so the client works even if
 * the two are briefly out of sync.
 */
export function toAbsoluteWsUrl(wsUrl: string): string {
  const u = wsUrl.trim();
  if (/^wss?:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return u.replace(/^https:\/\//i, "wss://");
  if (/^http:\/\//i.test(u)) return u.replace(/^http:\/\//i, "ws://");
  return `wss://${u.replace(/^\/+/, "")}`;
}

function initialState(): WhiteboardState {
  return {
    status: "idle",
    canDraw: false,
    role: null,
    error: null,
    ops: [],
    cursors: {},
    erased: new Set<string>(),
    mutations: new Map<string, ObjMutation>(),
  };
}

/** Read the `targetId` an `erase` op points at (payload-light; null if absent). */
function eraseTargetId(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const t = (payload as { targetId?: unknown }).targetId;
    if (typeof t === "string") return t;
  }
  return null;
}

/** Narrow a `modify` payload to its target + the fields it actually carries. */
function readModify(
  payload: unknown,
): { targetId: string; patch: ObjMutation } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.targetId !== "string") return null;
  const patch: ObjMutation = {};
  if (
    Array.isArray(p.m) &&
    p.m.length === 6 &&
    p.m.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    patch.m = p.m as number[];
  }
  if (p.style && typeof p.style === "object") patch.style = p.style as ObjStyle;
  if (typeof p.deleted === "boolean") patch.deleted = p.deleted;
  if (typeof p.z === "number" && Number.isFinite(p.z)) patch.z = p.z;
  return { targetId: p.targetId, patch };
}

/**
 * Merge a mutation patch into the map, keeping `erased` in lockstep. Partial
 * patches are supported (a restyle won't drop a prior transform); a complete
 * snapshot replaces. Returns fresh copies so React sees new references.
 */
function mergeMutation(
  mutations: Map<string, ObjMutation>,
  erased: Set<string>,
  targetId: string,
  patch: ObjMutation,
): { mutations: Map<string, ObjMutation>; erased: Set<string> } {
  const nextMut = new Map(mutations);
  const prev = nextMut.get(targetId) ?? {};
  const merged: ObjMutation = { ...prev };
  if (patch.m) merged.m = patch.m;
  if (patch.style) merged.style = { ...prev.style, ...patch.style };
  if (typeof patch.deleted === "boolean") merged.deleted = patch.deleted;
  if (typeof patch.z === "number") merged.z = patch.z;
  nextMut.set(targetId, merged);

  const nextErased = new Set(erased);
  if (merged.deleted) nextErased.add(targetId);
  else nextErased.delete(targetId);
  return { mutations: nextMut, erased: nextErased };
}

export class WhiteboardConnection {
  private state: WhiteboardState = initialState();
  private socket: SocketLike | null = null;
  private listeners = new Set<(s: WhiteboardState) => void>();
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly classId: string,
    private readonly deps: ConnectionDeps,
  ) {}

  getState(): WhiteboardState {
    return this.state;
  }

  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(fn: (s: WhiteboardState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<WhiteboardState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Mint a token and open the socket. Safe to call again to reconnect. */
  async connect(): Promise<void> {
    this.closedByUser = false;
    this.cancelReconnect();
    this.setState({
      status: this.attempt === 0 ? "connecting" : "reconnecting",
      error: null,
    });

    let tok: ClassroomToken;
    try {
      tok = await this.deps.fetchToken(this.classId);
    } catch (err) {
      this.setState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to get token",
      });
      this.scheduleReconnect();
      return;
    }
    if (this.closedByUser) return; // closed while awaiting the token

    this.setState({ canDraw: tok.canDraw, role: tok.role });

    const url = `${toAbsoluteWsUrl(tok.wsUrl)}?t=${encodeURIComponent(tok.token)}`;
    let sock: SocketLike;
    try {
      sock = this.deps.createSocket(url);
    } catch (err) {
      this.setState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to open socket",
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = sock;

    sock.onopen = () => {
      this.attempt = 0;
      this.setState({ status: "open", error: null });
    };
    sock.onmessage = (ev) => this.handleMessage(ev.data);
    sock.onerror = () => {
      // onclose follows and drives reconnect; just surface the error.
      this.setState({ error: "WebSocket error" });
    };
    sock.onclose = () => {
      this.socket = null;
      if (this.closedByUser) {
        this.setState({ status: "closed" });
      } else {
        this.setState({ status: "reconnecting" });
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let msg: InboundFrame;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // ignore unparseable frames
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "history" && Array.isArray(msg.ops)) {
      // Reduce the log in receive order: creates seed `ops`, erases tombstone
      // their target. A create always precedes its erase, so this re-derives the
      // exact live state on every (re)connect.
      const seeded: WhiteboardOp[] = [];
      let erased = new Set<string>();
      let mutations = new Map<string, ObjMutation>();
      for (const o of msg.ops) {
        if (PERSISTENT.has(o.type)) seeded.push(o);
        else if (o.type === "erase") {
          const t = eraseTargetId(o.payload);
          if (t) erased.add(t);
        } else if (o.type === "modify") {
          const r = readModify(o.payload);
          if (r) ({ mutations, erased } = mergeMutation(mutations, erased, r.targetId, r.patch));
        }
      }
      this.setState({ ops: seeded.slice(-MAX_OPS), erased, mutations });
      return;
    }
    if (msg.type === "error") {
      this.setState({ error: msg.error ?? "Server error" });
      return;
    }
    if (msg.type === "clear") {
      this.setState({
        ops: [],
        cursors: {},
        erased: new Set<string>(),
        mutations: new Map<string, ObjMutation>(),
      });
      return;
    }
    if (msg.type === "erase") {
      const t = eraseTargetId(msg.payload);
      if (t) this.setState({ erased: new Set([...this.state.erased, t]) });
      return;
    }
    if (msg.type === "modify") {
      const r = readModify(msg.payload);
      if (r) {
        this.setState(
          mergeMutation(this.state.mutations, this.state.erased, r.targetId, r.patch),
        );
      }
      return;
    }
    if (msg.type === "cursor") {
      const key = msg.senderId ?? "peer";
      const cursor: WhiteboardOp = {
        type: "cursor",
        payload: msg.payload,
        senderId: msg.senderId,
        ts: msg.ts,
      };
      this.setState({ cursors: { ...this.state.cursors, [key]: cursor } });
      return;
    }
    if (PERSISTENT.has(msg.type)) {
      this.appendOp({
        type: msg.type as WhiteboardOpType,
        payload: msg.payload,
        senderId: msg.senderId,
        ts: msg.ts,
      });
    }
  }

  private appendOp(op: WhiteboardOp): void {
    const next = [...this.state.ops, op];
    if (next.length > MAX_OPS) next.splice(0, next.length - MAX_OPS);
    this.setState({ ops: next });
  }

  /**
   * Send an op. Cursor presence is always allowed when connected; mutating ops
   * require the server-granted canDraw. Returns false if the op was not sent.
   * The server does NOT echo to the sender, so we apply our own op locally.
   */
  sendOp(op: { type: WhiteboardOpType; payload?: unknown }): boolean {
    if (this.state.status !== "open" || !this.socket) return false;
    if (op.type !== "cursor" && !this.state.canDraw) return false;

    try {
      this.socket.send(JSON.stringify({ type: op.type, payload: op.payload }));
    } catch {
      return false;
    }

    // Local echo (the DO broadcasts only to OTHER peers).
    const stamped: WhiteboardOp = { ...op, ts: this.deps.now() };
    if (op.type === "clear") {
      this.setState({
        ops: [],
        cursors: {},
        erased: new Set<string>(),
        mutations: new Map<string, ObjMutation>(),
      });
    } else if (op.type === "erase") {
      const t = eraseTargetId(op.payload);
      if (t) this.setState({ erased: new Set([...this.state.erased, t]) });
    } else if (op.type === "modify") {
      const r = readModify(op.payload);
      if (r) {
        this.setState(
          mergeMutation(this.state.mutations, this.state.erased, r.targetId, r.patch),
        );
      }
    } else if (PERSISTENT.has(op.type)) {
      this.appendOp(stamped);
    }
    return true;
  }

  /** Permanently close; stops reconnect attempts. */
  close(): void {
    this.closedByUser = true;
    this.cancelReconnect();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
    this.setState({ status: "closed" });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const backoff = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** this.attempt,
    );
    // Jitter avoids a thundering-herd reconnect when a room drops for everyone.
    const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = this.deps.setTimer(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, backoff + jitter);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.deps.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export { initialState as initialWhiteboardState };
