import { z } from "zod";

/**
 * The model-estimated half of a stat sheet. Unlike the reference game (which
 * generated sheets from thin air), estimates must be grounded: the prompt
 * carries the parent sheet's scores, the standing facts, and the turn's own
 * facts, and asks only for justified adjustments.
 */
/** Era-appropriate macro estimates; continuity comes from parent anchoring. */
export const EconomicsEstimateSchema = z.object({
  /** Notional output in `gdpUnit` (e.g. 2900 for "$2.9T" as USD billions). */
  gdp: z.number(),
  /** Unit the gdp figure is denominated in — era-appropriate. */
  gdpUnit: z.string().min(1),
  growthPct: z.number(),
  inflationPct: z.number(),
});
export type EconomicsEstimate = z.infer<typeof EconomicsEstimateSchema>;

export const StatSheetEstimateSchema = z.object({
  stability: z.number().int().min(0).max(100),
  economy: z.number().int().min(0).max(100),
  military: z.number().int().min(0).max(100),
  diplomacy: z.number().int().min(0).max(100),
  /** External security posture: how safe the nation is from coercion/attack. */
  security: z.number().int().min(0).max(100),
  economics: EconomicsEstimateSchema,
  /** 2-3 sentence assessment of the nation's position. */
  assessment: z.string().min(1),
  /** Grounded drivers behind the scores, each traceable to a provided fact. */
  highlights: z.array(z.string()).min(1).max(6),
});
export type StatSheetEstimate = z.infer<typeof StatSheetEstimateSchema>;

/** Hard stats the engine computes exactly — never asked of a model. */
export const StatSheetHardSchema = z.object({
  regionsOwned: z.number().int(),
  unitCount: z.number().int(),
  totalStrength: z.number().int(),
  reputation: z.number().int().nullable(),
  atWarWith: z.array(z.string()),
  treaties: z.array(z.string()),
});

export const StatSheetSchema = StatSheetEstimateSchema.extend({
  polity: z.string().min(1),
  nodeId: z.string().min(1),
  hard: StatSheetHardSchema,
});
export type StatSheet = z.infer<typeof StatSheetSchema>;
