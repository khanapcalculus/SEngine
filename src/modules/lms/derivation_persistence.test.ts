/**
 * Unit tests for appendAiDerivation — the find-or-create-thread + append-post
 * persistence used to save AI derivations into the class discussion.
 *
 * The class-membership guard is mocked (unit-tested in membership) and the db is
 * an in-memory fake of the Drizzle slice the function touches.
 *
 * Run: npx vitest run src/modules/lms/derivation_persistence.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";

/* ── Mock the membership guard ──────────────────────────────────── */
const assertClassAccess = vi.fn(async () => ({
  classId: "c1",
  branchId: "branch-1",
  memberRole: "teacher" as const,
}));
vi.mock("./membership.service", () => ({ assertClassAccess }));

/* ── In-memory fake db ──────────────────────────────────────────── */
interface ThreadRow {
  id: string;
  classId: string;
  title: string;
  authorId: string | null;
}
interface PostRow {
  id: string;
  threadId: string;
  authorId: string | null;
  body: string;
}
interface FakeState {
  threads: ThreadRow[];
  posts: PostRow[];
  audit: Array<Record<string, unknown>>;
}
let state: FakeState;

type Clause =
  | { __op: "eq"; col: string; val: unknown }
  | { __op: "and"; clauses: Clause[] }
  | undefined;

/** Look up a column on a row, tolerating snake_case (DB) vs camelCase (JS) keys. */
function get(row: Record<string, unknown>, col: string): unknown {
  if (col in row) return row[col];
  const camel = col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return row[camel];
}

function matches(row: Record<string, unknown>, clause: Clause): boolean {
  if (!clause) return true;
  if (clause.__op === "and") return clause.clauses.every((c) => matches(row, c));
  if (clause.__op === "eq") return get(row, clause.col) === clause.val;
  return true;
}

function fakeTableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
}

function makeFakeDb() {
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = fakeTableName(table);
        let clause: Clause;
        const rows = () =>
          name === "discussion_threads"
            ? state.threads
                .filter((r) =>
                  matches(r as unknown as Record<string, unknown>, clause),
                )
                .map((r) => ({ ...r }))
            : [];
        const chain = {
          where: (c: Clause) => ((clause = c), chain),
          limit: () => rows(),
          then: (res: (v: unknown[]) => void) => res(rows()),
        };
        return chain;
      },
    }),
    // Single insert path: threads/posts return ids; audit just records (writeAudit
    // calls .values() without .returning(), so returning() is simply never read).
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = fakeTableName(table);
        if (name === "audit_logs") state.audit.push(vals);
        return {
          returning: () => {
            if (name === "discussion_threads") {
              const row = {
                id: `thread-${state.threads.length + 1}`,
                ...vals,
              } as ThreadRow;
              state.threads.push(row);
              return [{ id: row.id }];
            }
            if (name === "discussion_posts") {
              const row = {
                id: `post-${state.posts.length + 1}`,
                ...vals,
              } as PostRow;
              state.posts.push(row);
              return [{ id: row.id }];
            }
            return [{ id: "x" }];
          },
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({
      __op: "eq",
      col: col?.name,
      val,
    }),
    and: (...clauses: unknown[]) => ({ __op: "and", clauses }),
  };
});

const CTX: AuthContext = {
  userId: "teacher-1",
  role: "teacher",
  orgId: "org-1",
  branchId: "branch-1",
};
const INPUT = {
  classId: "c1",
  problem: "Board snapshot: 2 strokes.\n\nFind det [[2,1],[1,3]]",
  derivation: "1. RESTATE...\n\\boxed{5}",
  model: "gemma-4",
};

beforeEach(() => {
  state = { threads: [], posts: [], audit: [] };
  assertClassAccess.mockClear();
  vi.resetModules();
});

describe("appendAiDerivation", () => {
  it("creates the AI thread on the first save and appends a post", async () => {
    const { appendAiDerivation, AI_DERIVATIONS_THREAD_TITLE } = await import(
      "./discussion.service"
    );
    const { getDb } = await import("../../db/client");

    const r = await appendAiDerivation(getDb() as never, CTX, INPUT);
    expect(r.createdThread).toBe(true);
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].title).toBe(AI_DERIVATIONS_THREAD_TITLE);
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0].threadId).toBe(r.threadId);
    // Audit row recorded.
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe("discussion.derivation.save");
  });

  it("reuses the existing thread on subsequent saves", async () => {
    const { appendAiDerivation } = await import("./discussion.service");
    const { getDb } = await import("../../db/client");

    const first = await appendAiDerivation(getDb() as never, CTX, INPUT);
    const second = await appendAiDerivation(getDb() as never, CTX, {
      ...INPUT,
      derivation: "another derivation",
    });

    expect(second.createdThread).toBe(false);
    expect(second.threadId).toBe(first.threadId);
    expect(state.threads).toHaveLength(1); // not duplicated
    expect(state.posts).toHaveLength(2); // both derivations saved
  });

  it("formats the post body with the problem, derivation, and model", async () => {
    const { appendAiDerivation } = await import("./discussion.service");
    const { getDb } = await import("../../db/client");

    await appendAiDerivation(getDb() as never, CTX, INPUT);
    const body = state.posts[0].body;
    expect(body).toContain("gemma-4");
    expect(body).toContain("Find det [[2,1],[1,3]]");
    expect(body).toContain("\\boxed{5}");
  });

  it("enforces class membership before writing", async () => {
    assertClassAccess.mockRejectedValueOnce(new Error("not a member"));
    const { appendAiDerivation } = await import("./discussion.service");
    const { getDb } = await import("../../db/client");

    await expect(
      appendAiDerivation(getDb() as never, CTX, INPUT),
    ).rejects.toThrow("not a member");
    expect(state.posts).toHaveLength(0);
  });
});
