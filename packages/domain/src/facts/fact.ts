import { z } from "zod";

const Polity = z.string().min(1);

/** Sorted pair key so A↔B relations always land under one key. */
export const pairKey = (a: string, b: string): string => [a, b].sort().join("|");

/**
 * How well the player's court actually knows a fact: the first fog layer over
 * the ledger. `confirmed` is what we witnessed or took part in, `reported` is
 * what reached us secondhand, `rumored` is hearsay that may be false.
 */
export const FactConfidenceSchema = z.enum(["confirmed", "reported", "rumored"]);
export type FactConfidence = z.infer<typeof FactConfidenceSchema>;

/**
 * Deliberately optional: an absent grade reads as "confirmed", so every fact
 * ever stored (and every extractor that never heard of intel) parses unchanged.
 */
const confidence = FactConfidenceSchema.optional().describe(
  "How reliable this fact is from the player's vantage: 'confirmed' when the player's nation took part or it happened next door, 'reported' for distant dealings known secondhand, 'rumored' for hearsay. Omit when confirmed.",
);

/** Every fact carries the same optional intel grade — one shared shape. */
const graded = <Shape extends z.ZodRawShape>(shape: Shape) => z.object({ ...shape, confidence });

/**
 * Structured facts extracted from turn narratives by the (configurable) small
 * model, plus facts derived deterministically from applied impacts. These are
 * the durable record that lets hundreds of turns compress into bounded context.
 */
export const FactSchema = z.discriminatedUnion("type", [
  // ---- extracted by the small model from event narratives ----
  graded({ type: z.literal("war_started"), attacker: Polity, defender: Polity, cause: z.string() }),
  graded({
    type: z.literal("war_ended"),
    parties: z.array(Polity).min(2),
    outcome: z.enum(["victory", "stalemate", "ceasefire", "collapse"]),
    victor: Polity.optional(),
  }),
  graded({
    type: z.literal("treaty_signed"),
    parties: z.array(Polity).min(2),
    kind: z.enum(["alliance", "trade", "nonaggression", "peace", "union", "other"]),
    name: z.string(),
    terms: z.string(),
  }),
  graded({
    type: z.literal("treaty_broken"),
    parties: z.array(Polity).min(2),
    name: z.string(),
    byWhom: Polity,
  }),
  graded({
    type: z.literal("leader_changed"),
    polity: Polity,
    newLeader: z.string(),
    how: z.enum(["election", "succession", "coup", "revolution", "death", "appointment", "other"]),
  }),
  graded({
    type: z.literal("government_changed"),
    polity: Polity,
    newSystem: z.string(),
    note: z.string(),
  }),
  graded({
    type: z.literal("economic_shift"),
    polity: Polity,
    direction: z.enum(["boom", "growth", "stagnation", "decline", "crisis"]),
    driver: z.string(),
  }),
  graded({
    type: z.literal("relationship_shift"),
    pair: z.tuple([Polity, Polity]),
    /** Coarse, small-model-friendly delta. */
    delta: z.number().int().min(-3).max(3),
    reason: z.string(),
  }),
  graded({
    type: z.literal("arc_update"),
    /** Reuse an open arc's id, or "" to open a new arc. */
    arcId: z.string(),
    title: z.string(),
    status: z.enum(["opened", "escalated", "deescalated", "resolved"]),
    note: z.string(),
  }),
  graded({
    type: z.literal("commitment"),
    from: Polity,
    to: Polity,
    what: z.string(),
    status: z.enum(["made", "fulfilled", "broken", "withdrawn"]),
    deadline: z.string().optional(),
  }),
  graded({
    type: z.literal("notable_event"),
    headline: z.string(),
    polities: z.array(Polity),
  }),
  // ---- derived deterministically by the engine from applied impacts ----
  graded({
    type: z.literal("territory_change"),
    regionId: z.string(),
    regionName: z.string(),
    from: z.string(),
    to: Polity,
  }),
  graded({
    type: z.literal("polity_change"),
    polity: Polity,
    changes: z.record(z.string(), z.unknown()),
  }),
]);
export type Fact = z.infer<typeof FactSchema>;
export type FactType = Fact["type"];

/** What the extractor model returns for one turn. */
export const FactBatchSchema = z.object({
  facts: z.array(FactSchema).max(40),
});
export type FactBatch = z.infer<typeof FactBatchSchema>;

/** Fact types only the engine may produce — never accepted from the extractor. */
export const DERIVED_FACT_TYPES: ReadonlySet<FactType> = new Set([
  "territory_change",
  "polity_change",
]);
