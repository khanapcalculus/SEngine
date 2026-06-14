/**
 * Module 4 — Threaded discussions: service layer.
 *
 * Threads belong to a class (optionally tied to an assignment); posts thread via
 * parent_post_id. Any class member (assertClassAccess) may read and post.
 */
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  discussionThreads,
  discussionPosts,
  users,
} from "../../db/schema";
import type { CreateThreadInput, CreatePostInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import type { AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { assertClassAccess } from "./membership.service";

export interface ThreadRow {
  id: string;
  classId: string;
  assignmentId: string | null;
  title: string;
  authorId: string | null;
  createdAt: Date;
}

/** Create a thread + its first post. Caller must be a member of the class. */
export async function createThread(
  db: DB,
  input: CreateThreadInput,
  ctx: AuthContext,
): Promise<ThreadRow> {
  return db.transaction(async (tx) => {
    const access = await assertClassAccess(tx, ctx, input.classId);

    const [thread] = await tx
      .insert(discussionThreads)
      .values({
        classId: input.classId,
        assignmentId: input.assignmentId ?? null,
        authorId: ctx.userId,
        title: input.title,
      })
      .returning();

    await tx.insert(discussionPosts).values({
      threadId: thread.id,
      authorId: ctx.userId,
      body: input.body,
    });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "discussion.thread.create",
      entityType: "discussion_thread",
      entityId: thread.id,
      summary: `Opened thread "${input.title}" in class ${input.classId}`,
    });

    return {
      id: thread.id,
      classId: thread.classId,
      assignmentId: thread.assignmentId,
      title: thread.title,
      authorId: thread.authorId,
      createdAt: thread.createdAt,
    };
  });
}

/** List a class's threads (members only). */
export async function listThreadsForClass(
  db: DB,
  ctx: AuthContext,
  classId: string,
): Promise<ThreadRow[]> {
  await assertClassAccess(db, ctx, classId);
  const rows = await db
    .select()
    .from(discussionThreads)
    .where(eq(discussionThreads.classId, classId))
    .orderBy(asc(discussionThreads.createdAt));
  return rows.map((t) => ({
    id: t.id,
    classId: t.classId,
    assignmentId: t.assignmentId,
    title: t.title,
    authorId: t.authorId,
    createdAt: t.createdAt,
  }));
}

export interface PostRow {
  id: string;
  threadId: string;
  parentPostId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
}

export interface ThreadWithPosts {
  thread: ThreadRow;
  posts: PostRow[];
}

/** Fetch a thread and its posts (members only). */
export async function getThreadWithPosts(
  db: DB,
  ctx: AuthContext,
  threadId: string,
): Promise<ThreadWithPosts> {
  const [thread] = await db
    .select()
    .from(discussionThreads)
    .where(eq(discussionThreads.id, threadId))
    .limit(1);
  if (!thread) {
    throw new ValidationError("Thread not found", {
      threadId: "no such thread",
    });
  }

  await assertClassAccess(db, ctx, thread.classId);

  const posts = await db
    .select({
      id: discussionPosts.id,
      threadId: discussionPosts.threadId,
      parentPostId: discussionPosts.parentPostId,
      authorId: discussionPosts.authorId,
      authorName: users.fullName,
      body: discussionPosts.body,
      createdAt: discussionPosts.createdAt,
    })
    .from(discussionPosts)
    .leftJoin(users, eq(discussionPosts.authorId, users.id))
    .where(eq(discussionPosts.threadId, threadId))
    .orderBy(asc(discussionPosts.createdAt));

  return {
    thread: {
      id: thread.id,
      classId: thread.classId,
      assignmentId: thread.assignmentId,
      title: thread.title,
      authorId: thread.authorId,
      createdAt: thread.createdAt,
    },
    posts,
  };
}

/** Add a reply to a thread (members only). */
export async function addPost(
  db: DB,
  threadId: string,
  input: CreatePostInput,
  ctx: AuthContext,
): Promise<{ postId: string; threadId: string }> {
  return db.transaction(async (tx) => {
    const [thread] = await tx
      .select({ id: discussionThreads.id, classId: discussionThreads.classId })
      .from(discussionThreads)
      .where(eq(discussionThreads.id, threadId))
      .limit(1);
    if (!thread) {
      throw new ValidationError("Thread not found", {
        threadId: "no such thread",
      });
    }

    const access = await assertClassAccess(tx, ctx, thread.classId);

    const [post] = await tx
      .insert(discussionPosts)
      .values({
        threadId,
        parentPostId: input.parentPostId ?? null,
        authorId: ctx.userId,
        body: input.body,
      })
      .returning({ id: discussionPosts.id });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "discussion.post.create",
      entityType: "discussion_post",
      entityId: post.id,
      summary: `Replied in thread ${threadId}`,
    });

    return { postId: post.id, threadId };
  });
}

/** Title of the single per-class thread that collects AI-generated derivations. */
export const AI_DERIVATIONS_THREAD_TITLE = "AI Derivations (Gemma)";

export interface SaveDerivationInput {
  classId: string;
  /** The problem / whiteboard context the derivation was generated from. */
  problem: string;
  derivation: string;
  model: string;
}

/** Render the persisted post body (kept as text; LaTeX is preserved verbatim). */
export function formatDerivationBody(input: SaveDerivationInput): string {
  return [
    `**AI derivation** (model: ${input.model})`,
    "",
    "**Problem / board context:**",
    input.problem,
    "",
    "**Derivation:**",
    input.derivation,
  ].join("\n");
}

/**
 * Persist an AI derivation into the class discussion so it stays visible to
 * students. Find-or-creates ONE per-class "AI Derivations" thread and appends
 * the derivation as a post. Caller must be a member of the class. Thread + post
 * + audit commit together.
 */
export async function appendAiDerivation(
  db: DB,
  ctx: AuthContext,
  input: SaveDerivationInput,
): Promise<{ threadId: string; postId: string; createdThread: boolean }> {
  return db.transaction(async (tx) => {
    const access = await assertClassAccess(tx, ctx, input.classId);

    let createdThread = false;
    let [thread] = await tx
      .select({ id: discussionThreads.id })
      .from(discussionThreads)
      .where(
        and(
          eq(discussionThreads.classId, input.classId),
          eq(discussionThreads.title, AI_DERIVATIONS_THREAD_TITLE),
        ),
      )
      .limit(1);

    if (!thread) {
      [thread] = await tx
        .insert(discussionThreads)
        .values({
          classId: input.classId,
          assignmentId: null,
          authorId: ctx.userId,
          title: AI_DERIVATIONS_THREAD_TITLE,
        })
        .returning({ id: discussionThreads.id });
      createdThread = true;
    }

    const [post] = await tx
      .insert(discussionPosts)
      .values({
        threadId: thread.id,
        authorId: ctx.userId,
        body: formatDerivationBody(input),
      })
      .returning({ id: discussionPosts.id });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "discussion.derivation.save",
      entityType: "discussion_post",
      entityId: post.id,
      summary: `Saved AI derivation to class ${input.classId}`,
    });

    return { threadId: thread.id, postId: post.id, createdThread };
  });
}
