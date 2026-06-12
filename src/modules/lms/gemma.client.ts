/**
 * Module 4 — Gemma 4 AI client (tutor copilot).
 *
 * Thin, edge-compatible wrapper around the Gemma 4 inference API. Defined as an
 * interface so route handlers inject the real client and tests inject a fake —
 * no network in unit tests (Guideline #3), no leaking the API key into logic.
 *
 * NOTE: "Gemma 4" is the model name from system_architecture.md. The endpoint
 * URL / payload below follow Google's generative-language REST shape; swap the
 * model id / transport here without touching the service layer.
 */

export interface GemmaMessage {
  role: "system" | "user" | "model";
  content: string;
}

export interface GemmaRequest {
  system: string;
  messages: GemmaMessage[];
  /** Low temperature: derivations must be deterministic, not creative. */
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GemmaResponse {
  text: string;
  model: string;
}

export interface GemmaClient {
  generate(req: GemmaRequest): Promise<GemmaResponse>;
}

/** Config resolved from Worker env bindings. */
export interface GemmaConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Production client. Stateless; one fetch per call. Never logs the prompt body
 * or the API key.
 */
export function createGemmaClient(cfg: GemmaConfig): GemmaClient {
  const model = cfg.model ?? "gemma-4";
  const baseUrl = cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1";

  return {
    async generate(req: GemmaRequest): Promise<GemmaResponse> {
      const res = await fetch(`${baseUrl}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({
            role: m.role === "model" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: req.temperature ?? 0.2,
            maxOutputTokens: req.maxOutputTokens ?? 2048,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemma upstream error: ${res.status}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      return { text, model };
    },
  };
}
