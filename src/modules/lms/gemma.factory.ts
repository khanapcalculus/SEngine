/**
 * Resolves the AI client from the runtime environment. Isolated in its own
 * module so route handlers import a stable symbol and tests can mock just this
 * factory (no network, no real API key).
 *
 * ── Provider / model switch ───────────────────────────────────────────────
 * The architecture names **Gemma 4**, but the same Google generative-language
 * REST endpoint (used by gemma.client) serves BOTH Gemma and Gemini models —
 * only the model id changes. So the "provider" is purely configuration:
 *
 *   AI_PROVIDER   "gemma" (default, per architecture) | "gemini"
 *   AI_MODEL      explicit model id; overrides the provider default
 *                 (e.g. "gemma-4", "gemini-2.0-flash", "gemini-1.5-flash")
 *   AI_API_KEY    API key (falls back to legacy GEMMA_API_KEY)
 *   AI_BASE_URL   override base URL (falls back to legacy GEMMA_BASE_URL)
 *
 * Legacy GEMMA_* vars still work, so existing deployments need no change. To run
 * Gemini in practice while keeping Gemma as the documented default, set
 * AI_PROVIDER=gemini (or just AI_MODEL=gemini-...).
 */
import { createGemmaClient, type GemmaClient } from "./gemma.client";

export type AiProvider = "gemma" | "gemini";

/** Default model id per provider. Gemma is the architecture's named model. */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  gemma: "gemma-4",
  gemini: "gemini-1.5-flash",
};

/** The configured provider (defaults to gemma; anything else falls back to gemma). */
export function resolveAiProvider(): AiProvider {
  return (process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "gemini"
    ? "gemini"
    : "gemma";
}

/** The active model id: explicit AI_MODEL/GEMMA_MODEL wins, else the provider default. */
export function resolveAiModel(): string {
  const explicit = (process.env.AI_MODEL ?? process.env.GEMMA_MODEL ?? "").trim();
  return explicit || DEFAULT_MODEL[resolveAiProvider()];
}

export function getGemmaClient(): GemmaClient {
  // Accept the new AI_* names and the legacy GEMMA_* names interchangeably.
  const apiKey = process.env.AI_API_KEY ?? process.env.GEMMA_API_KEY;
  if (!apiKey) {
    throw new Error("No AI API key set (AI_API_KEY or GEMMA_API_KEY)");
  }
  return createGemmaClient({
    apiKey,
    baseUrl: process.env.AI_BASE_URL ?? process.env.GEMMA_BASE_URL,
    model: resolveAiModel(),
  });
}
