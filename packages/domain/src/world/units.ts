import { z } from "zod";
import { PolityCodeSchema } from "./polity.ts";

export const UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"] as const;
export const UnitTypeSchema = z.enum(UNIT_TYPES);
export type UnitType = z.infer<typeof UnitTypeSchema>;

/** "pending" = a player deployment awaiting simulation resolution. */
export const UnitStatusSchema = z.enum(["idle", "moving", "engaged", "defeated", "pending"]);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

export const UnitSourceSchema = z.enum(["player", "ai", "scenario"]);

export const UNIT_STRENGTH_MAX = 1000;

export const clampUnitStrength = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(UNIT_STRENGTH_MAX, Math.round(value))) : 100;

export const UnitSchema = z.object({
  id: z.string().min(1),
  name: z.string().default("Unit"),
  type: UnitTypeSchema.default("infantry"),
  ownerCode: PolityCodeSchema,
  strength: z.number().int().min(0).max(UNIT_STRENGTH_MAX).default(100),
  lng: z.number().finite(),
  lat: z.number().finite(),
  regionId: z.string().default(""),
  status: UnitStatusSchema.default("idle"),
  note: z.string().default(""),
  source: UnitSourceSchema.default("scenario"),
});
export type Unit = z.infer<typeof UnitSchema>;

/** Unit as the LLM may spawn it: no id yet (the engine assigns one). */
export const UnitSpawnSchema = UnitSchema.omit({ id: true, source: true }).extend({
  id: z.string().optional(),
});
export type UnitSpawn = z.infer<typeof UnitSpawnSchema>;
