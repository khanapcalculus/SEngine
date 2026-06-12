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
  return errorResponse("Internal server error", 500);
}
