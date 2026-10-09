import { z } from "zod";

/**
 * A structure built during play: any named point on the map — military base,
 * bunker, missile silo, embassy, port. `kind` is deliberately free-form
 * (lowercased for stable styling/grouping); unknown kinds are first-class.
 */
export const MarkerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().toLowerCase().default("landmark"),
  ownerCode: z.string().default(""),
  lng: z.number().finite(),
  lat: z.number().finite(),
  note: z.string().default(""),
  foundedAt: z.string().default(""),
});
export type Marker = z.infer<typeof MarkerSchema>;

export const MarkerSpawnSchema = MarkerSchema.omit({ id: true }).extend({
  id: z.string().optional(),
});
export type MarkerSpawn = z.infer<typeof MarkerSpawnSchema>;
