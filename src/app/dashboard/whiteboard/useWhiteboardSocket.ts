"use client";

/**
 * React binding for WhiteboardConnection. Supplies the browser implementations
 * of the injected deps (fetch, WebSocket, timers, clock), mirrors the
 * connection's state into React state, and tears the socket down on unmount or
 * when the classId changes. All the lifecycle/reconnect logic lives in the
 * (unit-tested) connection core; this stays a thin adapter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WhiteboardConnection,
  initialWhiteboardState,
  type ClassroomToken,
  type ConnectionDeps,
  type SocketLike,
  type WhiteboardOpType,
  type WhiteboardState,
} from "./connection";

/** Canonical 8-4-4-4-12 hex UUID shape (mirrors the server's validation). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function browserDeps(): ConnectionDeps {
  return {
    fetchToken: async (classId: string): Promise<ClassroomToken> => {
      // Guard at the source: a non-UUID classId (e.g. an empty selection) would
      // otherwise hit the server only to come back as a 400. Fail fast with a
      // clear message instead of a generic "Could not join" from the route.
      if (!UUID_RE.test(classId)) {
        throw new Error("Select a class before joining the whiteboard.");
      }
      const res = await fetch("/api/me/classroom/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(d.error ?? "Could not join the whiteboard room");
      }
      return d as ClassroomToken;
    },
    createSocket: (url: string): SocketLike =>
      new WebSocket(url) as unknown as SocketLike,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
    clearTimer: (id) => window.clearTimeout(id),
  };
}

export interface UseWhiteboardSocket extends WhiteboardState {
  /** Send an op; returns false if not sent (view-only / not connected). */
  sendOp: (op: { type: WhiteboardOpType; payload?: unknown }) => boolean;
  /** Force a fresh token + reconnect (e.g. after a manual retry). */
  reconnect: () => void;
}

export function useWhiteboardSocket(
  classId: string | null,
): UseWhiteboardSocket {
  const [state, setState] = useState<WhiteboardState>(initialWhiteboardState);
  const connRef = useRef<WhiteboardConnection | null>(null);

  useEffect(() => {
    if (!classId) {
      setState(initialWhiteboardState());
      return;
    }
    const conn = new WhiteboardConnection(classId, browserDeps());
    connRef.current = conn;
    const unsub = conn.subscribe(setState);
    setState(conn.getState());
    void conn.connect();
    return () => {
      unsub();
      conn.close();
      connRef.current = null;
    };
  }, [classId]);

  const sendOp = useCallback(
    (op: { type: WhiteboardOpType; payload?: unknown }) =>
      connRef.current?.sendOp(op) ?? false,
    [],
  );
  const reconnect = useCallback(() => {
    void connRef.current?.connect();
  }, []);

  return { ...state, sendOp, reconnect };
}
