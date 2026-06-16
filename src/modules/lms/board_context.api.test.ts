/**
 * Unit test for fetchBoardContext — the server-side Durable Object context read
 * behind the AI tutor. The Worker fetch is MOCKED (no network) so the test is
 * fast and isolated; token signing runs for real (WebCrypto) to exercise the
 * actual request shape.
 *
 * Run: npx vitest run src/modules/lms/board_context.api.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchBoardContext } from "./board_context";

const CLASS_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR = { userId: "u-teacher", role: "teacher" as const, canDraw: true };

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.RTC_JWT_SECRET = "test-rtc-secret-at-least-16-chars";
  process.env.WHITEBOARD_WS_URL = "wss://rtc.example.workers.dev";
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RTC_JWT_SECRET;
  delete process.env.WHITEBOARD_WS_URL;
  vi.restoreAllMocks();
});

function ok(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe("fetchBoardContext", () => {
  it("returns the board text and calls the Worker over https with the context header", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: "Equation: E=mc^2", opCount: 3 }));

    const out = await fetchBoardContext(CLASS_ID, ACTOR);

    expect(out).toEqual({ text: "Equation: E=mc^2", opCount: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // wss:// base is coerced to https:// for a plain GET.
    expect(String(url)).toMatch(/^https:\/\/rtc\.example\.workers\.dev\/room\//);
    expect(String(url)).toContain(`/room/${CLASS_ID}?t=`);
    expect((init as RequestInit).method).toBe("GET");
    expect((init as any).headers["x-rtc-op"]).toBe("context");
  });

  it("returns null when RTC_JWT_SECRET is missing (never calls fetch)", async () => {
    delete process.env.RTC_JWT_SECRET;
    const out = await fetchBoardContext(CLASS_ID, ACTOR);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when WHITEBOARD_WS_URL is missing (never calls fetch)", async () => {
    delete process.env.WHITEBOARD_WS_URL;
    const out = await fetchBoardContext(CLASS_ID, ACTOR);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-OK Worker response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as unknown as Response);
    expect(await fetchBoardContext(CLASS_ID, ACTOR)).toBeNull();
  });

  it("returns null when the payload has no text field", async () => {
    fetchMock.mockResolvedValueOnce(ok({ opCount: 2 }));
    expect(await fetchBoardContext(CLASS_ID, ACTOR)).toBeNull();
  });

  it("returns null (never throws) when the fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await fetchBoardContext(CLASS_ID, ACTOR)).toBeNull();
  });

  it("defaults opCount to 0 when the Worker omits it", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: "Text: hello" }));
    expect(await fetchBoardContext(CLASS_ID, ACTOR)).toEqual({ text: "Text: hello", opCount: 0 });
  });
});
