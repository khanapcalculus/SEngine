"use client";

/** Whiteboard — gated placeholder (teacher + student). The realtime backend (a
 * Durable Object room) exists; the live canvas client connects here later. */
import { RoleGuard } from "../_components/RoleGuard";
import { Section, dim } from "../_components/ui";

export default function WhiteboardPage() {
  return (
    <RoleGuard allow={["teacher", "student"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Whiteboard</h1>
      <Section title="Real-time whiteboard">
        <p style={dim}>
          The collaborative whiteboard is coming soon. Its realtime backend (a
          Durable Object room handling WebSocket sessions) is already in place;
          the live canvas client will connect from this page.
        </p>
      </Section>
    </RoleGuard>
  );
}
