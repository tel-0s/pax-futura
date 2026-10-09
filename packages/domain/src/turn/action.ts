import { z } from "zod";
import { ImpactsSchema } from "./impacts.ts";

export const ActionKindSchema = z.enum(["action", "chat"]);

export const ActionSchema = z.object({
  id: z.string().min(1),
  kind: ActionKindSchema.default("action"),
  title: z.string().min(1),
  text: z.string().default(""),
  /** The player's verbatim input, before LLM refinement. */
  rawInput: z.string().default(""),
  /** Polity codes invited when kind = "chat". */
  invitees: z.array(z.string()).default([]),
  source: z.enum(["player", "suggestion", "ai"]).default("player"),
});
export type Action = z.infer<typeof ActionSchema>;

export const StopPolicySchema = z.enum(["toDate", "nextNotable"]);
export type StopPolicy = z.infer<typeof StopPolicySchema>;

/**
 * Everything a turn execution consumes, frozen onto the node at creation so
 * regeneration never depends on mutable draft state.
 */
export const TurnInputSchema = z.object({
  actions: z.array(ActionSchema).default([]),
  jumpDays: z.number().int().min(1).max(36500),
  stopPolicy: StopPolicySchema.default("toDate"),
  seed: z.number().int().optional(),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

/**
 * A game-master intervention frozen onto a node: the impacts are applied
 * verbatim (no LLM, no time advance). A node input either has `gm: true` or
 * it is a turn — keep GmEditInputSchema first in the union so the literal
 * discriminates before TurnInputSchema's defaults can swallow the object.
 */
export const GmEditInputSchema = z.object({
  gm: z.literal(true),
  note: z.string().max(200).default(""),
  impacts: ImpactsSchema,
});
export type GmEditInput = z.infer<typeof GmEditInputSchema>;

export const NodeInputSchema = z.union([GmEditInputSchema, TurnInputSchema]);
export type NodeInput = z.infer<typeof NodeInputSchema>;

export const isGmInput = (input: NodeInput): input is GmEditInput =>
  "gm" in input && input.gm === true;
