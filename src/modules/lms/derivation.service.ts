/**
 * Module 4 — Whiteboard Derivation service (Gemma 4).
 *
 * Sibling of the Tutor Copilot, specialised for the live whiteboard: the
 * educator's CANVAS is the primary input (not a typed question), with an
 * optional focus prompt. Reuses TUTOR_SYSTEM_PROMPT so the rigorous
 * derivation/output contract stays defined in exactly one place.
 *
 * Pure + stateless (Guideline #1): the route injects a real GemmaClient, tests
 * inject a fake — no network in the unit tests.
 */
import type { GemmaClient, GemmaResponse } from "./gemma.client";
import { TUTOR_SYSTEM_PROMPT } from "./tutor.service";
import type { DerivationInput } from "../../lib/validation";

export interface DerivationResult {
  derivation: string;
  model: string;
}

/** Assemble the user turn: the board snapshot, then an optional focus. */
export function buildDerivationMessage(input: DerivationInput): string {
  const parts = [
    `CURRENT WHITEBOARD CONTEXT (extracted from the canvas):\n${input.whiteboardContext}`,
  ];
  parts.push(
    input.prompt && input.prompt.length > 0
      ? `\nEDUCATOR FOCUS:\n${input.prompt}`
      : `\nEDUCATOR FOCUS:\nProduce a complete, rigorous derivation of the work shown on the board.`,
  );
  return parts.join("\n");
}

/** Route a whiteboard snapshot (+ optional focus) to Gemma 4 for a derivation. */
export async function runDerivation(
  client: GemmaClient,
  input: DerivationInput,
): Promise<DerivationResult> {
  const res: GemmaResponse = await client.generate({
    system: TUTOR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildDerivationMessage(input) }],
    temperature: 0.2, // derivations must be reproducible, not creative
    maxOutputTokens: 2048,
  });

  return { derivation: res.text, model: res.model };
}
