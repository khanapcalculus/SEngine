/**
 * API tests for Module 4 — AI Tutor Copilot.
 *
 * Auth + the Gemma client are mocked, so the full route -> RBAC -> validation
 * -> prompt-assembly -> client path runs with NO network. The fake Gemma client
 * captures the request so we can assert the system prompt + whiteboard context
 * are wired correctly.
 *
 * Run: npx vitest run src/modules/lms/tutor.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";
import type { GemmaRequest } from "./gemma.client";
import { TUTOR_SYSTEM_PROMPT } from "./tutor.service";

/* ── Mock auth ──────────────────────────────────────────────────── */
let currentCtx: AuthContext | AuthError;
vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return {
    ...actual,
    getAuthContext: vi.fn(async () => {
      if (currentCtx instanceof actual.AuthError) throw currentCtx;
      return currentCtx;
    }),
  };
});

/* ── Mock the Gemma factory with a capturing fake client ────────── */
let lastRequest: GemmaRequest | null = null;
let fakeAnswer = "1. RESTATE: ...\n\\boxed{x=2}";
vi.mock("./gemma.factory", () => ({
  getGemmaClient: () => ({
    generate: async (reqArg: GemmaRequest) => {
      lastRequest = reqArg;
      return { text: fakeAnswer, model: "gemma-4" };
    },
  }),
}));

const CLASS_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const TEACHER: AuthContext = { userId: "meghan", role: "teacher", orgId: "org" };
const STUDENT: AuthContext = { userId: "raj", role: "student", orgId: "org" };
const PARENT: AuthContext = { userId: "p", role: "parent", orgId: "org" };
const SUPER_ADMIN: AuthContext = { userId: "sa", role: "super_admin", orgId: null };

function req(body: unknown): Request {
  return new Request("http://x/api/ai/tutor-copilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  lastRequest = null;
  fakeAnswer = "1. RESTATE: ...\n\\boxed{x=2}";
});

describe("POST /api/ai/tutor-copilot — RBAC", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    expect((await POST(req({ query: "solve", classId: CLASS_ID }))).status).toBe(
      401,
    );
  });

  it("403 when a STUDENT queries the AI directly (Constraint 2)", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    expect((await POST(req({ query: "solve", classId: CLASS_ID }))).status).toBe(
      403,
    );
  });

  it("403 when a parent queries the AI", async () => {
    currentCtx = PARENT;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    expect((await POST(req({ query: "solve", classId: CLASS_ID }))).status).toBe(
      403,
    );
  });
});

describe("POST /api/ai/tutor-copilot — validation", () => {
  it("400 on empty query", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    const res = await POST(req({ query: "", classId: CLASS_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.query).toBeDefined();
  });

  it("400 on non-UUID classId", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    const res = await POST(req({ query: "solve", classId: "nope" }));
    expect(res.status).toBe(400);
  });

  it("400 on malformed JSON", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    expect((await POST(req("{bad"))).status).toBe(400);
  });
});

describe("POST /api/ai/tutor-copilot — happy path", () => {
  it("200 routes a teacher's matrix query to Gemma with the reasoning prompt", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    const res = await POST(
      req({
        query: "Find the determinant of [[2,1],[1,3]] and explain each step.",
        classId: CLASS_ID,
        whiteboardContext: "Matrix A = [[2,1],[1,3]] drawn on board",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe("gemma-4");
    expect(data.classId).toBe(CLASS_ID);
    expect(data.answer).toContain("\\boxed");

    // The optimized system prompt and whiteboard context reached the client.
    expect(lastRequest?.system).toBe(TUTOR_SYSTEM_PROMPT);
    expect(lastRequest?.system).toContain("DERIVATION");
    expect(lastRequest?.temperature).toBeLessThanOrEqual(0.3);
    expect(lastRequest?.messages[0].content).toContain("Matrix A = [[2,1]");
    expect(lastRequest?.messages[0].content).toContain("determinant");
  });

  it("200 works for super_admin without whiteboard context", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/ai/tutor-copilot/route");
    const res = await POST(
      req({ query: "Solve dy/dx = 3y, y(0)=2.", classId: CLASS_ID }),
    );
    expect(res.status).toBe(200);
    // No whiteboard section appended when context is absent.
    expect(lastRequest?.messages[0].content).not.toContain("WHITEBOARD CONTEXT");
  });
});
