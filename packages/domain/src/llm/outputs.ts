import { z } from "zod";
import { EventDraftSchema, EventImportanceSchema } from "../turn/event.ts";
import { ActionSchema } from "../turn/action.ts";
import { ImpactsSchema, emptyImpacts } from "../turn/impacts.ts";

/** What the simulator must return for a turn. */
export const TurnResultSchema = z.object({
  /** In-game date the simulation stopped at (advances the node's clock). */
  stopDate: z.string().min(1),
  /** One-line summary shown on the node's loom card. */
  summary: z.string().min(1),
  events: z.array(EventDraftSchema).min(1).max(30),
});
export type TurnResult = z.infer<typeof TurnResultSchema>;

/** descriptionToAction: free player text refined into a structured action. */
export const ActionRefinementSchema = ActionSchema.omit({ id: true, source: true });
export type ActionRefinement = z.infer<typeof ActionRefinementSchema>;

export const ActionSuggestionsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        actions: z.array(ActionRefinementSchema).min(1).max(4),
      }),
    )
    .max(6),
});
export type ActionSuggestions = z.infer<typeof ActionSuggestionsSchema>;

export const NextSpeakerSchema = z.object({
  nextSpeaker: z.string().min(1),
});

/**
 * The cartographer's amendments: impacts a turn's own narration clearly
 * implies but the simulator failed to emit, plus the classification/location
 * a drifted simulator stopped setting — keyed to the event they belong to.
 * Everything but `impacts` is optional so older model outputs still parse.
 */
export const ReconciliationSchema = z.object({
  amendments: z
    .array(
      z.object({
        eventIndex: z.number().int().min(0),
        // Defaulted: a classify-only amendment may omit impacts entirely, and
        // one malformed entry must not void the whole reconciliation pass.
        impacts: ImpactsSchema.default(() => emptyImpacts()),
        kind: z.string().optional(),
        importance: EventImportanceSchema.optional(),
        playerRelated: z.boolean().optional(),
        lng: z.number().finite().optional(),
        lat: z.number().finite().optional(),
      }),
    )
    .max(30)
    .default([]),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

/** An on-command audit of the whole map against recent narrated history. */
export const ReassessmentSchema = z.object({
  /** One short line per proposed correction, for player review. */
  notes: z.array(z.string()).max(24).default([]),
  changes: ImpactsSchema,
});
export type Reassessment = z.infer<typeof ReassessmentSchema>;
