import { z } from "zod";
import { HexColorSchema, PolityCodeSchema } from "../world/polity.ts";
import { UnitSpawnSchema, UNIT_STRENGTH_MAX } from "../world/units.ts";
import { MarkerSpawnSchema } from "../world/markers.ts";

export const RegionTransferSchema = z.object({
  regionId: z.string().min(1),
  regionName: z.string().default(""),
  fromCode: z.string().default(""),
  /** null = the region becomes unowned (collapse, depopulation, abandonment). */
  toCode: PolityCodeSchema.nullable(),
  note: z.string().default(""),
});
export type RegionTransfer = z.infer<typeof RegionTransferSchema>;

export const PolityChangeSchema = z.object({
  code: PolityCodeSchema,
  name: z.string().default(""),
  color: HexColorSchema.or(z.literal("")).default(""),
  aliases: z.array(z.string()).default([]),
  note: z.string().default(""),
  /** null = unchanged; a number becomes the polity's authoritative reputation. */
  reputation: z.number().int().min(0).max(100).nullable().default(null),
  /**
   * The simulation sends the COMPLETE new tag list, so [] is meaningful
   * ("no defining tags anymore") while null means "unchanged".
   */
  tags: z.array(z.string().max(32)).max(8).nullable().default(null),
});
export type PolityChange = z.infer<typeof PolityChangeSchema>;

export const UnitOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("spawn"), unit: UnitSpawnSchema }),
  z.object({
    op: z.literal("move"),
    unitId: z.string().min(1),
    toLng: z.number().finite(),
    toLat: z.number().finite(),
    regionId: z.string().default(""),
    note: z.string().default(""),
  }),
  z.object({
    op: z.literal("strength"),
    unitId: z.string().min(1),
    strength: z.number().int().min(0).max(UNIT_STRENGTH_MAX),
    note: z.string().default(""),
  }),
  z.object({ op: z.literal("remove"), unitId: z.string().min(1), note: z.string().default("") }),
]);
export type UnitOp = z.infer<typeof UnitOpSchema>;

export const MarkerOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("build"), marker: MarkerSpawnSchema }),
  z.object({
    op: z.literal("remove"),
    markerId: z.string().default(""),
    name: z.string().default(""),
    note: z.string().default(""),
  }),
]);
export type MarkerOp = z.infer<typeof MarkerOpSchema>;

/** A diplomacy chat the simulation opens toward the player. */
export const CreatedChatSchema = z.object({
  title: z.string().min(1),
  participants: z.array(PolityCodeSchema).min(1),
  openingMessage: z.object({
    speaker: z.string().min(1),
    text: z.string().min(1),
  }),
});
export type CreatedChat = z.infer<typeof CreatedChatSchema>;

/** How the simulation mutates the world: every change rides on an event. */
export const ImpactsSchema = z.object({
  /** Planned-action ids this event resolves. */
  actionIds: z.array(z.string()).default([]),
  regionTransfers: z.array(RegionTransferSchema).default([]),
  polityChanges: z.array(PolityChangeSchema).default([]),
  unitOps: z.array(UnitOpSchema).default([]),
  markerOps: z.array(MarkerOpSchema).default([]),
  createdChats: z.array(CreatedChatSchema).default([]),
});
export type Impacts = z.infer<typeof ImpactsSchema>;

export const emptyImpacts = (): Impacts => ImpactsSchema.parse({});
