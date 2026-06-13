/**
 * Small HTTP helpers so routes return consistent JSON shapes and map known
 * errors to the right status codes.
 */
import { AuthError } from "./auth";
import { ValidationError } from "./validation";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * Translate a thrown error into an HTTP Response.
 * Known error types map to their intended status; everything else is a 500
 * with no internal detail leaked.
 */
export function handleError(err: unknown): Response {
  if (err instanceof AuthError) return errorResponse(err.message, err.status);
  if (err instanceof ValidationError) {
    return json({ error: err.message, fields: err.fields }, 400);
  }
  if (isSchemaDriftError(err)) {
    return errorResponse(
      "Database schema is out of date. Apply the latest migrations and redeploy.",
      500,
    );
  }
  return errorResponse("Internal server error", 500);
}

function isSchemaDriftError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "";
  const cause = e?.cause as { code?: unknown; message?: unknown } | undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";

  const codes = new Set([
    "42P01", // undefined_table
    "42703", // undefined_column
    "42704", // undefined_object/type
  ]);

  if (codes.has(code) || codes.has(causeCode)) return true;

  const haystack = `${message}\n${causeMessage}`.toLowerCase();
  return (
    (haystack.includes("relation") && haystack.includes("does not exist")) ||
    (haystack.includes("column") && haystack.includes("does not exist")) ||
    (haystack.includes("type") && haystack.includes("does not exist"))
  );
}
