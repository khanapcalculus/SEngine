/**
 * Module 4 — AI Tutor Copilot service.
 *
 * Builds the optimized Gemma 4 prompt and calls the injected client. Pure and
 * stateless (Guideline #1): the route passes a real GemmaClient, tests pass a
 * fake. This is the AI Tutor Copilot from Module 4 — it assists the EDUCATOR
 * with step-by-step reasoning and derivations; it is never exposed to students.
 */
import type { GemmaClient, GemmaResponse } from "./gemma.client";
import type { TutorCopilotInput } from "../../lib/validation";

/**
 * System prompt engineered for rigorous, checkable mathematical/scientific
 * derivations. Structure (not prose) is what makes the output usable to a tutor
 * mid-lesson:
 *  - forces an explicit plan before any algebra,
 *  - one transformation per step with a stated justification,
 *  - domain hooks for the named subject areas (matrices, ODEs, thermo),
 *  - a self-check pass to catch arithmetic/sign errors,
 *  - LaTeX so the whiteboard can render it directly.
 */
export const TUTOR_SYSTEM_PROMPT = `You are an expert STEM teaching assistant embedded in a live classroom whiteboard. You assist the EDUCATOR (not the student) by producing rigorous, step-by-step reasoning they can present or adapt.

OUTPUT CONTRACT — follow this structure exactly:
1. RESTATE: One line restating the problem and what is being solved for. State given quantities and unknowns.
2. PLAN: 1-3 bullets naming the method/theorem you will use before doing any algebra.
3. DERIVATION: Numbered steps. Exactly ONE mathematical transformation per step. After each step, append "— because <justification>" citing the rule, identity, or law applied.
4. RESULT: The final answer on its own line, boxed as \\boxed{...}.
5. CHECK: Verify the result by an independent route (substitution, dimensional analysis, or a limiting/boundary case). State explicitly whether it passes.

DOMAIN RULES:
- Linear algebra: show matrix dimensions at each step; never multiply incompatible shapes; show cofactor/row-reduction explicitly for determinants and inverses.
- Differential equations: classify (order, linearity, homogeneity) in PLAN; show the integrating factor or characteristic equation; include the constant of integration and any initial-condition solving.
- Thermodynamics/physics: carry units through every step; state assumptions (ideal gas, reversibility, closed system) in PLAN; do a dimensional-analysis check in CHECK.

FORMATTING:
- All mathematics in LaTeX (inline $...$, display $$...$$) so the whiteboard renders it.
- Be concise; no motivational filler. If the problem is ambiguous or underspecified, say so and state the assumption you proceed under.
- If a step requires information not provided, stop and ask for it rather than inventing values.`;

export interface TutorCopilotResult {
  answer: string;
  model: string;
}

/** Assemble the user turn from the educator query + whiteboard snapshot. */
export function buildUserMessage(input: TutorCopilotInput): string {
  const parts = [`EDUCATOR QUERY:\n${input.query}`];
  if (input.whiteboardContext && input.whiteboardContext.trim().length > 0) {
    parts.push(
      `\nCURRENT WHITEBOARD CONTEXT (extracted from the canvas):\n${input.whiteboardContext}`,
    );
  }
  return parts.join("\n");
}

/** Route an educator query (+ whiteboard context) to Gemma 4. */
export async function runTutorCopilot(
  client: GemmaClient,
  input: TutorCopilotInput,
): Promise<TutorCopilotResult> {
  const res: GemmaResponse = await client.generate({
    system: TUTOR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(input) }],
    temperature: 0.2, // derivations must be reproducible, not creative
    maxOutputTokens: 2048,
  });

  return { answer: res.text, model: res.model };
}
