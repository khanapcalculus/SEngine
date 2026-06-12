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
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
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

/** Fake DO state tracking accepted sockets. */
function makeState() {
  const sockets: FakeWS[] = [];
  return {
    sockets,
    acceptWebSocket(ws: FakeWS) {
      sockets.push(ws);
    },
    getWebSockets() {
      return sockets;
    },
  };
}

function upgradeReq(): Request {
  return new Request("http://do/", { headers: { Upgrade: "websocket" } });
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
