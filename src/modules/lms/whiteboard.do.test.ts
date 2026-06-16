/**
 * Unit tests for the RTC Whiteboard Durable Object.
 *
 * The Workers runtime globals (WebSocketPair, WebSocket, the DO state) are
 * faked here so the coordination logic — upgrade handling, broadcast-to-peers,
 * history replay, server-side stamping — is testable without a live edge
 * runtime.
 *
 * Run: npx vitest run src/modules/lms/whiteboard.do.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/* ── Fake WebSocket + runtime globals ───────────────────────────── */
class FakeWS {
  sent: string[] = [];
  closed = false;
  attachment: unknown = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // Hibernation attachment API used by the DO to persist connection identity.
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

class FakePair {
  0: FakeWS;
  1: FakeWS;
  constructor() {
    this[0] = new FakeWS();
    this[1] = new FakeWS();
  }
}

// Inject Workers globals before importing the DO module.
(globalThis as any).WebSocketPair = FakePair;
(globalThis as any).WebSocket = FakeWS;

// Node's standard Response rejects status 101; the Workers runtime allows it
// for WebSocket upgrades. Polyfill a minimal Response that mirrors Workers so
// the (correct) DO upgrade path is testable.
class WorkersResponse {
  status: number;
  webSocket: unknown;
  body: unknown;
  constructor(body: unknown, init?: { status?: number; webSocket?: unknown }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.webSocket = init?.webSocket;
  }
}
(globalThis as any).Response = WorkersResponse;

// Deterministic timestamp (Date.now is otherwise unavailable/varying).
const NOW = 1_750_000_000_000;
vi.spyOn(Date, "now").mockReturnValue(NOW);

import { WhiteboardRoom, type WhiteboardOp } from "./whiteboard.do";

/** In-memory fake of the DO transactional storage KV surface. */
function makeStorage(backing: Map<string, unknown> = new Map()) {
  return {
    backing,
    async get(key: string) {
      return backing.get(key);
    },
    async put(key: string, value: unknown) {
      backing.set(key, value);
    },
    async delete(key: string) {
      return backing.delete(key);
    },
    async deleteAll() {
      backing.clear();
    },
    async list(options?: { prefix?: string }) {
      const out = new Map<string, unknown>();
      for (const [k, v] of backing) {
        if (!options?.prefix || k.startsWith(options.prefix)) out.set(k, v);
      }
      return out;
    },
  };
}

/**
 * Fake DO state tracking accepted sockets. `storage` is shared/injectable so a
 * test can simulate hibernation: build a fresh WhiteboardRoom over the SAME
 * backing map and assert the op log rehydrates.
 */
function makeState(storage = makeStorage()) {
  const sockets: FakeWS[] = [];
  return {
    sockets,
    storage,
    acceptWebSocket(ws: FakeWS) {
      sockets.push(ws);
    },
    getWebSockets() {
      return sockets;
    },
    // The real runtime defers requests until fn resolves; our tests await
    // construction-driven hydration via flushMicrotasks() before asserting.
    blockConcurrencyWhile(fn: () => Promise<void>) {
      void fn();
    },
  };
}

/** Let queued microtasks (the constructor's blockConcurrencyWhile) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function upgradeReq(userId?: string): Request {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  // Mirrors the verified identity the fronting Worker forwards to the DO.
  if (userId) headers["x-rtc-user-id"] = userId;
  return new Request("http://do/", { headers });
}

let state: ReturnType<typeof makeState>;
let room: WhiteboardRoom;

beforeEach(() => {
  state = makeState();
  room = new WhiteboardRoom(state as any, {});
});

describe("WhiteboardRoom.fetch", () => {
  it("426 when the request is not a WebSocket upgrade", async () => {
    const res = await room.fetch(new Request("http://do/"));
    expect(res.status).toBe(426);
  });

  it("101 and accepts the server socket on upgrade", async () => {
    const res = await room.fetch(upgradeReq());
    expect(res.status).toBe(101);
    expect(state.sockets).toHaveLength(1);
  });

  it("replays history to a late joiner", async () => {
    // First peer joins and draws.
    await room.fetch(upgradeReq());
    const drawer = state.sockets[0];
    await room.webSocketMessage(
      drawer as any,
      JSON.stringify({ type: "stroke", payload: { x: 1 } }),
    );

    // Second peer joins -> should receive a history frame.
    await room.fetch(upgradeReq());
    const joiner = state.sockets[1];
    const historyFrame = joiner.sent.find((m) => m.includes('"history"'));
    expect(historyFrame).toBeDefined();
    expect(historyFrame).toContain("stroke");
  });
});

describe("WhiteboardRoom.webSocketMessage", () => {
  beforeEach(async () => {
    // Two connected peers.
    await room.fetch(upgradeReq());
    await room.fetch(upgradeReq());
  });

  it("broadcasts an op to peers but not the sender", async () => {
    const [a, b] = state.sockets;
    await room.webSocketMessage(
      a as any,
      JSON.stringify({ type: "stroke", payload: { p: 1 } }),
    );
    // a (sender) gets nothing new; b receives the stroke.
    expect(a.sent.filter((m) => m.includes('"stroke"'))).toHaveLength(0);
    const received = b.sent.find((m) => m.includes('"stroke"'));
    expect(received).toBeDefined();
  });

  it("stamps the op with a server-side timestamp", async () => {
    const [a, b] = state.sockets;
    await room.webSocketMessage(
      a as any,
      JSON.stringify({ type: "shape", payload: {}, ts: 123 }),
    );
    const op: WhiteboardOp = JSON.parse(
      b.sent.find((m) => m.includes('"shape"'))!,
    );
    expect(op.ts).toBe(NOW); // client-supplied ts:123 was overwritten
  });

  it("rejects invalid JSON with an error frame", async () => {
    const [a] = state.sockets;
    await room.webSocketMessage(a as any, "{not json");
    expect(a.sent.some((m) => m.includes('"error"'))).toBe(true);
  });

  it("rejects an op with no type", async () => {
    const [a] = state.sockets;
    await room.webSocketMessage(a as any, JSON.stringify({ payload: {} }));
    expect(a.sent.some((m) => m.includes("missing op type"))).toBe(true);
  });

  it("'clear' wipes replay history", async () => {
    const [a] = state.sockets;
    await room.webSocketMessage(
      a as any,
      JSON.stringify({ type: "stroke", payload: {} }),
    );
    await room.webSocketMessage(a as any, JSON.stringify({ type: "clear" }));

    // A new joiner should get empty/au absent history after clear.
    await room.fetch(upgradeReq());
    const joiner = state.sockets[2];
    const historyFrame = joiner.sent.find((m) => m.includes('"history"'));
    // clear emptied history, so no history frame is sent.
    expect(historyFrame).toBeUndefined();
  });

  it("does not replay ephemeral cursor ops", async () => {
    const [a] = state.sockets;
    await room.webSocketMessage(
      a as any,
      JSON.stringify({ type: "cursor", payload: { x: 5 } }),
    );
    await room.fetch(upgradeReq());
    const joiner = state.sockets[2];
    expect(joiner.sent.find((m) => m.includes('"history"'))).toBeUndefined();
  });
});

describe("WhiteboardRoom sender attribution", () => {
  it("stamps senderId from the connection's verified identity", async () => {
    await room.fetch(upgradeReq("user-ada"));
    await room.fetch(upgradeReq("user-grace"));
    const [ada, grace] = state.sockets;

    await room.webSocketMessage(
      ada as any,
      JSON.stringify({ type: "stroke", payload: { x: 1 } }),
    );
    const received: WhiteboardOp = JSON.parse(
      grace.sent.find((m) => m.includes('"stroke"'))!,
    );
    // senderId came from the server-side attachment, not the client payload.
    expect(received.senderId).toBe("user-ada");
  });

  it("attributes cursor ops so peers are distinguishable", async () => {
    await room.fetch(upgradeReq("user-ada"));
    await room.fetch(upgradeReq("user-grace"));
    const [ada, grace] = state.sockets;

    await room.webSocketMessage(
      ada as any,
      JSON.stringify({ type: "cursor", payload: { x: 0.5, y: 0.5 } }),
    );
    const cursor: WhiteboardOp = JSON.parse(
      grace.sent.find((m) => m.includes('"cursor"'))!,
    );
    expect(cursor.senderId).toBe("user-ada");
  });

  it("overrides any client-supplied senderId (never trusts the client)", async () => {
    await room.fetch(upgradeReq("user-ada"));
    await room.fetch(upgradeReq("user-grace"));
    const [ada, grace] = state.sockets;

    await room.webSocketMessage(
      ada as any,
      JSON.stringify({
        type: "stroke",
        payload: {},
        senderId: "user-impersonated",
      }),
    );
    const received: WhiteboardOp = JSON.parse(
      grace.sent.find((m) => m.includes('"stroke"'))!,
    );
    expect(received.senderId).toBe("user-ada");
  });

  it("replays history with senderId intact for late joiners", async () => {
    await room.fetch(upgradeReq("user-ada"));
    const [ada] = state.sockets;
    await room.webSocketMessage(
      ada as any,
      JSON.stringify({ type: "stroke", payload: { x: 1 } }),
    );

    await room.fetch(upgradeReq("user-late"));
    const joiner = state.sockets[1];
    const frame = JSON.parse(
      joiner.sent.find((m) => m.includes('"history"'))!,
    );
    expect(frame.ops[0].senderId).toBe("user-ada");
  });

  it("leaves senderId undefined when no identity header was forwarded", async () => {
    await room.fetch(upgradeReq()); // no x-rtc-user-id
    await room.fetch(upgradeReq());
    const [a, b] = state.sockets;
    await room.webSocketMessage(
      a as any,
      JSON.stringify({ type: "stroke", payload: {} }),
    );
    const received: WhiteboardOp = JSON.parse(
      b.sent.find((m) => m.includes('"stroke"'))!,
    );
    expect(received.senderId).toBeUndefined();
  });
});

describe("WhiteboardRoom durable persistence", () => {
  it("survives hibernation: a fresh room over the same storage replays prior ops", async () => {
    const storage = makeStorage();

    // First lifetime: a peer draws two ops, then everyone leaves (DO evicted).
    const s1 = makeState(storage);
    const r1 = new WhiteboardRoom(s1 as any, {});
    await flush();
    await r1.fetch(upgradeReq("user-ada"));
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "stroke", payload: { id: "a" } }),
    );
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "shape", payload: { id: "b" } }),
    );

    // Second lifetime: a brand-new room instance over the SAME storage. A late
    // joiner must still receive the full board.
    const s2 = makeState(storage);
    const r2 = new WhiteboardRoom(s2 as any, {});
    await flush();
    await r2.fetch(upgradeReq("user-late"));
    const frame = JSON.parse(
      s2.sockets[0].sent.find((m) => m.includes('"history"'))!,
    );
    expect(frame.ops).toHaveLength(2);
    expect(frame.ops[0].payload.id).toBe("a");
    expect(frame.ops[1].payload.id).toBe("b");
  });

  it("persists modify/erase ops so edits survive a rejoin", async () => {
    const storage = makeStorage();
    const s1 = makeState(storage);
    const r1 = new WhiteboardRoom(s1 as any, {});
    await flush();
    await r1.fetch(upgradeReq("user-ada"));
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "stroke", payload: { id: "a" } }),
    );
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "modify", payload: { targetId: "a", m: [1, 0, 0, 1, 0.1, 0] } }),
    );

    const s2 = makeState(storage);
    const r2 = new WhiteboardRoom(s2 as any, {});
    await flush();
    await r2.fetch(upgradeReq("user-late"));
    const frame = JSON.parse(
      s2.sockets[0].sent.find((m) => m.includes('"history"'))!,
    );
    expect(frame.ops).toHaveLength(2);
    expect(frame.ops[1].type).toBe("modify");
  });

  it("serves a text context dump for the AI tutor (x-rtc-op: context)", async () => {
    const storage = makeStorage();
    const s1 = makeState(storage);
    const r1 = new WhiteboardRoom(s1 as any, {});
    await flush();
    await r1.fetch(upgradeReq("user-ada"));
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "equation", payload: { id: "e1", latex: "E=mc^2" } }),
    );
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "shape", payload: { id: "t1", kind: "text", text: "Newton's 2nd law" } }),
    );

    const res = await r1.fetch(
      new Request("http://do/", { headers: { "x-rtc-op": "context" } }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse((res as any).body);
    expect(body.opCount).toBe(2);
    expect(body.text).toContain("E=mc^2");
    expect(body.text).toContain("Newton's 2nd law");
  });

  it("'clear' wipes durable storage, not just memory", async () => {
    const storage = makeStorage();
    const s1 = makeState(storage);
    const r1 = new WhiteboardRoom(s1 as any, {});
    await flush();
    await r1.fetch(upgradeReq());
    await r1.webSocketMessage(
      s1.sockets[0] as any,
      JSON.stringify({ type: "stroke", payload: {} }),
    );
    await r1.webSocketMessage(s1.sockets[0] as any, JSON.stringify({ type: "clear" }));
    expect(storage.backing.size).toBe(0);

    // A new lifetime sees an empty board (no history frame).
    const s2 = makeState(storage);
    const r2 = new WhiteboardRoom(s2 as any, {});
    await flush();
    await r2.fetch(upgradeReq());
    expect(s2.sockets[0].sent.find((m) => m.includes('"history"'))).toBeUndefined();
  });
});
