/**
 * Resolves a GemmaClient from the runtime environment. Isolated in its own
 * module so route handlers import a stable symbol and tests can mock just this
 * factory (no network, no real API key).
 */
import { createGemmaClient, type GemmaClient } from "./gemma.client";

export function getGemmaClient(): GemmaClient {
  const apiKey = process.env.GEMMA_API_KEY;
  if (!apiKey) throw new Error("GEMMA_API_KEY is not set");
  return createGemmaClient({
    apiKey,
    baseUrl: process.env.GEMMA_BASE_URL,
    model: process.env.GEMMA_MODEL,
  });
}
