/**
 * Unit tests for the framework-agnostic WhiteboardConnection.
 * All I/O is injected, so no real fetch / WebSocket / timers are touched.
 *
 * Run: npx vitest run src/app/dashboard/whiteboard/connection.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WhiteboardConnection,
  type ClassroomToken,
  type ConnectionDeps,
  type SocketLike,
  type WhiteboardState,
} from "./connection";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.onclose?.({});
  }
  // ── test helpers ──
  emitOpen() {
    this.onopen?.({});
  }
  emitMessage(obj: unknown) {
    this.onmessage?.({
      data: typeof obj === "string" ? obj : JSON.stringify(obj),
    });
  }
}

const TOKEN: ClassroomToken = {
  token: "handshake-tok",
  wsUrl: "wss://rtc.test/room/c1",
  role: "teacher",
  canDraw: true,
  expiresAt: 0,
};

let socket: FakeSocket;
let timers: Array<{ fn: () => void; ms: number }>;
let lastUrl: string;

function makeDeps(over: Partial<ConnectionDeps> = {}): ConnectionDeps {
  return {
    fetchToken: vi.fn(async () => TOKEN),
    createSocket: vi.fn((url: string) => {
      lastUrl = url;
      return socket;
    }),
    now: () => 12345,
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length; // 1-based id
    },
    clearTimer: vi.fn(),
    ...over,
  };
}

let states: WhiteboardState[];
function track(conn: WhiteboardConnection) {
  conn.subscribe((s) => states.push(s));
}

beforeEach(() => {
  socket = new FakeSocket();
  timers = [];
  states = [];
  lastUrl = "";
});

describe("WhiteboardConnection.connect", () => {
  it("fetches a token, opens the socket with ?t=, and reports open", async () => {
    const deps = makeDeps();
    const conn = new WhiteboardConnection("c1", deps);
    track(conn);

    await conn.connect();
    expect(deps.fetchToken).toHaveBeenCalledWith("c1");
    expect(lastUrl).toBe("wss://rtc.test/room/c1?t=handshake-tok");
    expect(conn.getState().status).toBe("connecting");
    expect(conn.getState().canDraw).toBe(true);
    expect(conn.getState().role).toBe("teacher");

    socket.emitOpen();
    expect(conn.getState().status).toBe("open");
  });

  it("goes to error + schedules a reconnect when the token fetch fails", async () => {
    const deps = makeDeps({
      fetchToken: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const conn = new WhiteboardConnection("c1", deps);
    await conn.connect();
    expect(conn.getState().status).toBe("error");
    expect(conn.getState().error).toBe("boom");
    expect(timers).toHaveLength(1); // reconnect scheduled
  });
});

describe("inbound frames", () => {
  async function openConn(over?: Partial<ConnectionDeps>) {
    const conn = new WhiteboardConnection("c1", makeDeps(over));
    await conn.connect();
    socket.emitOpen();
    return conn;
  }

  it("appends a stroke op", async () => {
    const conn = await openConn();
    socket.emitMessage({ type: "stroke", payload: { x: 1 }, ts: 9 });
    expect(conn.getState().ops).toHaveLength(1);
    expect(conn.getState().ops[0].type).toBe("stroke");
  });

  it("seeds from a history frame, dropping non-persistent ops", async () => {
    const conn = await openConn();
    socket.emitMessage({
      type: "history",
      ops: [
        { type: "stroke", payload: {} },
        { type: "cursor", payload: {} },
        { type: "shape", payload: {} },
      ],
    });
    expect(conn.getState().ops.map((o) => o.type)).toEqual(["stroke", "shape"]);
  });

  it("tracks cursors by sender without polluting ops", async () => {
    const conn = await openConn();
    socket.emitMessage({ type: "cursor", payload: { x: 3 }, senderId: "u9" });
    expect(conn.getState().ops).toHaveLength(0);
    expect(conn.getState().cursors.u9.payload).toEqual({ x: 3 });
  });

  it("clears ops + cursors on a clear frame", async () => {
    const conn = await openConn();
    socket.emitMessage({ type: "stroke", payload: {} });
    socket.emitMessage({ type: "cursor", payload: {}, senderId: "u1" });
    socket.emitMessage({ type: "clear" });
    expect(conn.getState().ops).toHaveLength(0);
    expect(conn.getState().cursors).toEqual({});
  });

  it("ignores unparseable frames", async () => {
    const conn = await openConn();
    socket.emitMessage("{not json");
    expect(conn.getState().ops).toHaveLength(0);
    expect(conn.getState().error).toBeNull();
  });
});

describe("sendOp", () => {
  async function openConn(over?: Partial<ConnectionDeps>) {
    const conn = new WhiteboardConnection("c1", makeDeps(over));
    await conn.connect();
    socket.emitOpen();
    return conn;
  }

  it("sends + locally echoes a stroke when canDraw", async () => {
    const conn = await openConn();
    const ok = conn.sendOp({ type: "stroke", payload: { x: 2 } });
    expect(ok).toBe(true);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: "stroke" });
    // Local echo because the server never echoes to the sender.
    expect(conn.getState().ops).toHaveLength(1);
    expect(conn.getState().ops[0].ts).toBe(12345);
  });

  it("blocks mutating ops for a view-only peer but allows cursor", async () => {
    const conn = await openConn({
      fetchToken: vi.fn(async () => ({ ...TOKEN, canDraw: false })),
    });
    expect(conn.sendOp({ type: "stroke", payload: {} })).toBe(false);
    expect(conn.getState().ops).toHaveLength(0);
    expect(conn.sendOp({ type: "cursor", payload: { x: 1 } })).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });

  it("returns false when not open", async () => {
    const conn = new WhiteboardConnection("c1", makeDeps());
    await conn.connect(); // connecting, not open
    expect(conn.sendOp({ type: "stroke", payload: {} })).toBe(false);
  });
});

describe("reconnect + close", () => {
  it("schedules a reconnect on an unexpected close", async () => {
    const conn = new WhiteboardConnection("c1", makeDeps());
    await conn.connect();
    socket.emitOpen();
    socket.onclose?.({}); // server-side drop
    expect(conn.getState().status).toBe("reconnecting");
    expect(timers).toHaveLength(1);
  });

  it("does NOT reconnect after an explicit close()", async () => {
    const conn = new WhiteboardConnection("c1", makeDeps());
    await conn.connect();
    socket.emitOpen();
    conn.close();
    expect(conn.getState().status).toBe("closed");
    expect(timers).toHaveLength(0);
  });
});
