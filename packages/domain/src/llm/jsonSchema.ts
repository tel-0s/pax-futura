import { z } from "zod";

export interface LlmToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the provider wire; the Zod schema stays the validator. */
  schema: Record<string, unknown>;
}

/**
 * Derive the provider-facing JSON Schema from the Zod source of truth.
 * Providers guarantee shape, not semantics — the full Zod schema (with
 * cross-field rules) always re-validates the payload after parsing.
 */
export const toLlmToolSchema = (
  name: string,
  description: string,
  zodSchema: z.ZodType,
): LlmToolSchema => ({
  name,
  description,
  schema: z.toJSONSchema(zodSchema, { io: "input", target: "draft-2020-12" }) as Record<
    string,
    unknown
  >,
});
