/**
 * API tests for POST /api/me/ai/derivation.
 *
 * Auth, the class-membership guard, and the Gemma client are mocked, so the
 * full route -> RBAC -> validation -> membership -> prompt-assembly -> client
 * path runs with NO network or DB. The fake client captures the request so we
 * can assert the system prompt + whiteboard context are wired correctly.
 *
 * Run: npx vitest run src/modules/lms/derivation.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";
import { ValidationError } from "../../lib/validation";
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

/* ── Mock the class-membership guard (unit-tested separately) ────── */
const CLASS_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let membershipError: Error | null = null;
const assertClassAccess = vi.fn(async () => {
  if (membershipError) throw membershipError;
  return { classId: CLASS_ID, branchId: "branch-1", memberRole: "teacher" };
});
vi.mock("./membership.service", () => ({ assertClassAccess }));

/* ── Mock the discussion persistence (unit-tested separately) ────── */
let saveError: Error | null = null;
const appendAiDerivation = vi.fn(
  async (_db: unknown, _ctx: unknown, _input: unknown) => {
    if (saveError) throw saveError;
    return { threadId: "thread-1", postId: "post-1", createdThread: true };
  },
);
vi.mock("./discussion.service", () => ({ appendAiDerivation }));

// The route passes getDb() to the (mocked) services, so a stub is fine.
vi.mock("../../db/client", () => ({ getDb: () => ({}) }));

/* ── Mock the Gemma factory with a capturing fake client ────────── */
let lastRequest: GemmaRequest | null = null;
const fakeAnswer = "1. RESTATE: ...\n\\boxed{x=2}";
vi.mock("./gemma.factory", () => ({
  getGemmaClient: () => ({
    generate: async (reqArg: GemmaRequest) => {
      lastRequest = reqArg;
      return { text: fakeAnswer, model: "gemma-4" };
    },
  }),
}));

const TEACHER: AuthContext = {
  userId: "meghan",
  role: "teacher",
  orgId: "org",
  branchId: "branch-1",
};
const STUDENT: AuthContext = {
  userId: "raj",
  role: "student",
  orgId: "org",
  branchId: null,
};

function req(body: unknown): Request {
  return new Request("http://x/api/me/ai/derivation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  classId: CLASS_ID,
  whiteboardContext: "$$\\int_0^1 x^2\\,dx$$",
  prompt: "focus on the integration step",
};

async function post(r: Request) {
  const { POST } = await import("../../app/api/me/ai/derivation/route");
  return POST(r);
}

beforeEach(() => {
  currentCtx = TEACHER;
  membershipError = null;
  saveError = null;
  lastRequest = null;
  assertClassAccess.mockClear();
  appendAiDerivation.mockClear();
});

describe("POST /api/me/ai/derivation", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    expect((await post(req(VALID))).status).toBe(401);
  });

  it("403 for a student (RBAC — AI is educator-only)", async () => {
    currentCtx = STUDENT;
    expect((await post(req(VALID))).status).toBe(403);
  });

  it("400 on malformed JSON", async () => {
    expect((await post(req("{not json"))).status).toBe(400);
  });

  it("400 when whiteboardContext is missing", async () => {
    const res = await post(req({ classId: CLASS_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.whiteboardContext).toBeDefined();
  });

  it("400 when classId is not a UUID", async () => {
    const res = await post(req({ ...VALID, classId: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBeDefined();
  });

  it("403 when the caller is not a member of the class", async () => {
    membershipError = new AuthError(403, "You are not a member of this class");
    expect((await post(req(VALID))).status).toBe(403);
  });

  it("404-style 400 when the class does not exist", async () => {
    membershipError = new ValidationError("Class not found", {
      classId: "no such class",
    });
    expect((await post(req(VALID))).status).toBe(400);
  });

  it("200 returns the derivation and wires the system prompt + context", async () => {
    const res = await post(req(VALID));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.classId).toBe(CLASS_ID);
    expect(data.model).toBe("gemma-4");
    expect(data.derivation).toBe(fakeAnswer);

    // Membership was checked against the requested class.
    expect(assertClassAccess).toHaveBeenCalledTimes(1);
    // The educator-grade derivation contract + the board snapshot were sent.
    expect(lastRequest?.system).toBe(TUTOR_SYSTEM_PROMPT);
    const userMsg = lastRequest?.messages[0].content ?? "";
    expect(userMsg).toContain("WHITEBOARD CONTEXT");
    expect(userMsg).toContain("\\int_0^1 x^2");
    expect(userMsg).toContain("focus on the integration step");
    expect(lastRequest?.temperature).toBe(0.2);
  });

  it("saves the derivation to the class discussion", async () => {
    const res = await post(req(VALID));
    const data = await res.json();
    expect(data.saved).toBe(true);
    expect(data.threadId).toBe("thread-1");
    expect(appendAiDerivation).toHaveBeenCalledTimes(1);
    const arg = appendAiDerivation.mock.calls[0]?.[2] as {
      classId: string;
      problem: string;
      derivation: string;
      model: string;
    };
    expect(arg.classId).toBe(CLASS_ID);
    expect(arg.derivation).toBe(fakeAnswer);
    expect(arg.problem).toContain("\\int_0^1 x^2");
  });

  it("still returns the derivation if saving fails (non-fatal)", async () => {
    saveError = new Error("db down");
    const res = await post(req(VALID));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.derivation).toBe(fakeAnswer); // not lost
    expect(data.saved).toBe(false);
    expect(data.threadId).toBeNull();
  });

  it("200 with no prompt falls back to a default focus", async () => {
    const res = await post(req({ classId: CLASS_ID, whiteboardContext: "E=mc^2" }));
    expect(res.status).toBe(200);
    expect(lastRequest?.messages[0].content).toContain(
      "Produce a complete, rigorous derivation",
    );
  });
});
