import { z } from "zod";

/**
 * The incremental digest folded down a loom path: rollup(node) =
 * fold(rollup(parent), facts(node)). Node-keyed, so branches diverge for free.
 * The fold itself lives in the engine's facts module; domain owns the shape.
 */
export const NationSheetSchema = z.object({
  leader: z.string().default(""),
  government: z.string().default(""),
  econTrend: z.string().default(""),
  atWarWith: z.array(z.string()).default([]),
  treaties: z.array(z.string()).default([]),
});
export type NationSheet = z.infer<typeof NationSheetSchema>;

/**
 * A nation's persistent disposition — the "mind" the simulator and diplomacy
 * personas read so nations remember across decades. Maintained by the
 * extractor as part of the rollup fold; node-keyed, so branch-safe for free.
 */
export const PsycheSheetSchema = z.object({
  /** e.g. "cautious and legalistic", "expansionist and prickly about honor" */
  temperament: z.string().default(""),
  ambitions: z.array(z.string().max(120)).max(3).default([]),
  /** Standing grievances with their origin, e.g. "FRA broke the grain pact (T41)" */
  grudges: z.array(z.string().max(120)).max(3).default([]),
  /** Disposition toward the player's nation. */
  opinionOfPlayer: z.number().int().min(-3).max(3).default(0),
  opinionReason: z.string().max(200).default(""),
});
export type PsycheSheet = z.infer<typeof PsycheSheetSchema>;

/** LLM output shape for the psyche pass — array, not record (ladder-safe). */
export const PsycheUpdatesSchema = z.object({
  updates: z
    .array(z.object({ code: z.string().min(1), sheet: PsycheSheetSchema }))
    .max(12)
    .default([]),
});
export type PsycheUpdates = z.infer<typeof PsycheUpdatesSchema>;

export const RollupSchema = z.object({
  nations: z.record(z.string(), NationSheetSchema).default({}),
  /** pairKey -> relation summary; score is a bounded running sum of deltas. */
  relations: z
    .record(z.string(), z.object({ score: z.number().int().min(-10).max(10), lastReason: z.string() }))
    .default({}),
  openArcs: z
    .array(
      z.object({
        arcId: z.string(),
        title: z.string(),
        status: z.string(),
        lastUpdatedDepth: z.number().int(),
      }),
    )
    .default([]),
  openCommitments: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        what: z.string(),
        deadline: z.string().default(""),
      }),
    )
    .default([]),
  /** Leader psyches by polity code; defaulted so pre-feature rollups parse. */
  psyches: z.record(z.string(), PsycheSheetSchema).default({}),
});
export type Rollup = z.infer<typeof RollupSchema>;

export const emptyRollup = (): Rollup => RollupSchema.parse({});
