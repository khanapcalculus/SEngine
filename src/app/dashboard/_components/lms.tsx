"use client";

/**
 * Module 4 LMS frontend components: an Assignments panel (create/publish for
 * staff; submit + Vercel Blob upload for students; view + grade submissions)
 * and a Discussions panel (threads + threaded replies). Prop-driven by classId
 * + role flags; the API enforces class membership, so these degrade to a 403
 * notice for non-members.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import {
  Section,
  StatusBadge,
  btn,
  fmtErr,
  dim,
  errStyle,
  formGrid,
  inp,
  miniBtn,
  tenantCard,
  successStyle,
} from "./ui";

interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  maxPoints: number;
  status: string;
}
interface SubmissionRow {
  submissionId: string;
  studentName: string;
  status: string;
  pointsAwarded: number | null;
}
interface Thread {
  id: string;
  title: string;
  assignmentId: string | null;
  authorId: string | null;
  createdAt: string;
}
interface Post {
  id: string;
  parentPostId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
}

async function getJson(url: string): Promise<any | null> {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

/* ───────────────────────────── Assignments ─────────────────────── */

export function AssignmentsPanel({
  classId,
  canManage,
  isStudent,
}: {
  classId: string;
  canManage: boolean;
  isStudent: boolean;
}) {
  const [items, setItems] = useState<Assignment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch(`/api/assignments/class/${classId}`);
    if (!r.ok) {
      setErr(r.status === 403 ? "You are not a member of this class." : "Failed to load assignments.");
      setItems([]);
    } else {
      const d = await r.json();
      setItems(Array.isArray(d.assignments) ? d.assignments : []);
      setErr(null);
    }
    setLoading(false);
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section title="Assignments">
      {canManage && <CreateAssignment classId={classId} onDone={load} />}
      {loading ? (
        <p style={dim}>Loading…</p>
      ) : err ? (
        <p style={dim}>{err}</p>
      ) : items.length === 0 ? (
        <p style={dim}>No assignments yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: canManage ? 16 : 0 }}>
          {items.map((a) => (
            <AssignmentCard
              key={a.id}
              a={a}
              canManage={canManage}
              isStudent={isStudent}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function CreateAssignment({
  classId,
  onDone,
}: {
  classId: string;
  onDone: () => void;
}) {
  const [f, setF] = useState({ title: "", description: "", dueDate: "", maxPoints: "100" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          title: f.title,
          description: f.description || undefined,
          dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : undefined,
          maxPoints: Number(f.maxPoints),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setF({ title: "", description: "", dueDate: "", maxPoints: "100" });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, maxWidth: 480 }}>
      <input style={inp} placeholder="Assignment title" required value={f.title}
        onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea style={{ ...inp, minHeight: 56, fontFamily: "inherit" }} placeholder="Description (optional)"
        value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label style={{ ...dim, display: "grid", gap: 4 }}>
        Due date (optional)
        <input style={inp} type="datetime-local" value={f.dueDate}
          onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </label>
      <input style={inp} type="number" min={1} max={1000} placeholder="Max points" required value={f.maxPoints}
        onChange={(e) => setF({ ...f, maxPoints: e.target.value })} />
      {err && <p role="alert" style={errStyle}>{err}</p>}
      <button type="submit" disabled={busy} style={btn(busy)}>
        {busy ? "Creating…" : "Create assignment"}
      </button>
    </form>
  );
}

function AssignmentCard({
  a,
  canManage,
  isStudent,
  onChanged,
}: {
  a: Assignment;
  canManage: boolean;
  isStudent: boolean;
  onChanged: () => void;
}) {
  const [showSubs, setShowSubs] = useState(false);
  const due = a.dueDate ? new Date(a.dueDate).toLocaleString() : null;

  async function setStatus(status: string) {
    await fetch(`/api/assignments/${a.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onChanged();
  }

  return (
    <div style={tenantCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{a.title}</strong>
        <StatusBadge status={a.status} />
        <span style={{ ...dim, marginLeft: "auto" }}>{a.maxPoints} pts</span>
      </div>
      {a.description && <p style={{ ...dim, margin: "6px 0" }}>{a.description}</p>}
      {due && <p style={{ ...dim, margin: "4px 0" }}>Due {due}</p>}

      {canManage && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {a.status !== "published" && (
            <button type="button" style={miniBtn} onClick={() => setStatus("published")}>Publish</button>
          )}
          {a.status !== "closed" && (
            <button type="button" style={miniBtn} onClick={() => setStatus("closed")}>Close</button>
          )}
          <button type="button" style={miniBtn} onClick={() => setShowSubs((s) => !s)}>
            {showSubs ? "Hide submissions" : "View submissions"}
          </button>
        </div>
      )}

      {canManage && showSubs && <SubmissionsList assignment={a} />}
      {isStudent && a.status === "published" && <StudentSubmit assignment={a} />}
    </div>
  );
}

function SubmissionsList({ assignment }: { assignment: Assignment }) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const d = await getJson(`/api/submissions/assignment/${assignment.id}`);
    setRows(Array.isArray(d?.submissions) ? d.submissions : []);
    setLoading(false);
  }, [assignment.id]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <p style={dim}>Loading submissions…</p>;
  if (rows.length === 0) return <p style={dim}>No submissions yet.</p>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
      <tbody>
        {rows.map((r) => (
          <GradeSubmissionRow key={r.submissionId} row={r} maxPoints={assignment.maxPoints} onGraded={load} />
        ))}
      </tbody>
    </table>
  );
}

function GradeSubmissionRow({
  row,
  maxPoints,
  onGraded,
}: {
  row: SubmissionRow;
  maxPoints: number;
  onGraded: () => void;
}) {
  const [points, setPoints] = useState(row.pointsAwarded?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (points === "") return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/submissions/${row.submissionId}/grade`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointsAwarded: Number(points) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onGraded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <td style={{ padding: 6 }}>{row.studentName}</td>
      <td style={{ padding: 6 }}><StatusBadge status={row.status} /></td>
      <td style={{ padding: 6 }}>
        <input style={{ ...inp, padding: "3px 6px", width: 70 }} type="number" min={0} max={maxPoints}
          value={points} onChange={(e) => setPoints(e.target.value)} /> / {maxPoints}
      </td>
      <td style={{ padding: 6 }}>
        <button type="button" style={miniBtn} disabled={busy || points === ""} onClick={save}>
          {busy ? "…" : "Save"}
        </button>
        {err && <span style={{ ...errStyle, marginLeft: 6 }}>{err}</span>}
      </td>
    </tr>
  );
}

function StudentSubmit({ assignment }: { assignment: Assignment }) {
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setSubmissionId(d.submissionId);
      setMsg("Submitted. You can attach files below.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !submissionId) return;
    setErr(null);
    setBusy(true);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: `/api/submissions/${submissionId}/upload`,
      });
      setMsg(`Uploaded ${file.name}.`);
      void blob;
    } catch (e2) {
      setErr(
        e2 instanceof Error
          ? `Upload failed: ${e2.message}`
          : "Upload failed (is BLOB_READ_WRITE_TOKEN configured?)",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
      {!submissionId ? (
        <button type="button" style={{ ...btn(busy), maxWidth: 200 }} disabled={busy} onClick={submit}>
          {busy ? "…" : "Submit assignment"}
        </button>
      ) : (
        <label style={{ ...dim, display: "grid", gap: 4 }}>
          Attach a file
          <input type="file" onChange={onFile} disabled={busy} />
        </label>
      )}
      {msg && <p style={{ ...successStyle, margin: 0 }}>{msg}</p>}
      {err && <p role="alert" style={errStyle}>{err}</p>}
    </div>
  );
}

/* ───────────────────────────── Discussions ─────────────────────── */

export function DiscussionsPanel({ classId }: { classId: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch(`/api/discussions/class/${classId}`);
    if (!r.ok) {
      setErr(r.status === 403 ? "You are not a member of this class." : "Failed to load discussions.");
      setThreads([]);
    } else {
      const d = await r.json();
      setThreads(Array.isArray(d.threads) ? d.threads : []);
      setErr(null);
    }
    setLoading(false);
  }, [classId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Section title="Discussions">
      <NewThread classId={classId} onDone={load} />
      {loading ? (
        <p style={dim}>Loading…</p>
      ) : err ? (
        <p style={dim}>{err}</p>
      ) : threads.length === 0 ? (
        <p style={dim}>No threads yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
          {threads.map((t) => (
            <div key={t.id} style={tenantCard}>
              <button type="button" onClick={() => setOpenId(openId === t.id ? null : t.id)}
                style={{ background: "none", border: "none", color: "#e6e9f2", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0, textAlign: "left" }}>
                {t.title}
              </button>
              {openId === t.id && <ThreadView threadId={t.id} />}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function NewThread({ classId, onDone }: { classId: string; onDone: () => void }) {
  const [f, setF] = useState({ title: "", body: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/discussions/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId, title: f.title, body: f.body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setF({ title: "", body: "" });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, maxWidth: 480 }}>
      <input style={inp} placeholder="New thread title" required value={f.title}
        onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea style={{ ...inp, minHeight: 56, fontFamily: "inherit" }} placeholder="Say something…" required
        value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      {err && <p role="alert" style={errStyle}>{err}</p>}
      <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Posting…" : "Start thread"}</button>
    </form>
  );
}

function ThreadView({ threadId }: { threadId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const d = await getJson(`/api/discussions/threads/${threadId}`);
    setPosts(Array.isArray(d?.posts) ? d.posts : []);
    setLoading(false);
  }, [threadId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ marginTop: 8 }}>
      {loading ? (
        <p style={dim}>Loading…</p>
      ) : (
        <ul style={{ margin: "0 0 8px", paddingLeft: 0, listStyle: "none", fontSize: 13 }}>
          {posts.map((p) => (
            <li key={p.id} style={{ padding: "6px 0", borderTop: "1px solid rgba(255,255,255,0.07)", paddingLeft: p.parentPostId ? 16 : 0 }}>
              <span style={{ fontWeight: 600 }}>{p.authorName ?? "Someone"}</span>{" "}
              <span style={{ opacity: 0.4 }}>{new Date(p.createdAt).toLocaleString()}</span>
              <div>{p.body}</div>
            </li>
          ))}
        </ul>
      )}
      <Reply threadId={threadId} onDone={load} />
    </div>
  );
}

function Reply({ threadId, onDone }: { threadId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/discussions/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setBody("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
      <input style={{ ...inp, flex: 1 }} placeholder="Reply…" value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="submit" disabled={busy} style={{ ...miniBtn, padding: "0 12px" }}>{busy ? "…" : "Reply"}</button>
      {err && <span style={{ ...errStyle, marginLeft: 6 }}>{err}</span>}
    </form>
  );
}
