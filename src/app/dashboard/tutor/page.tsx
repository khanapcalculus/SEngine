"use client";

/**
 * AI Tutor — Gemma copilot (managers + teachers). Managers scope the question
 * by a branch class; teachers scope by a class they're assigned to (/api/me/classes).
 */
import { useEffect, useState } from "react";
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import { TutorPanel } from "../_components/forms";
import { isManager, type ClassRow } from "../_components/ui";

interface MyClass {
  classId: string;
  subject: string;
  term: string;
  credits: number;
}

export default function TutorPage() {
  const { me, classes: branchClasses } = useDashboard();
  const [teacherClasses, setTeacherClasses] = useState<ClassRow[]>([]);

  useEffect(() => {
    if (me.role !== "teacher") return;
    (async () => {
      const r = await fetch("/api/me/classes");
      if (!r.ok) return;
      const d = await r.json();
      const list: MyClass[] = Array.isArray(d.classes) ? d.classes : [];
      setTeacherClasses(
        list.map((c) => ({
          id: c.classId,
          subject: c.subject,
          term: c.term,
          credits: c.credits,
        })),
      );
    })();
  }, [me.role]);

  const classes = isManager(me.role) ? branchClasses : teacherClasses;

  return (
    <RoleGuard allow={["super_admin", "branch_manager", "teacher"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>AI Tutor</h1>
      <TutorPanel classes={classes} />
    </RoleGuard>
  );
}
