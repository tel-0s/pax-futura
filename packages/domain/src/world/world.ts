import { z } from "zod";
import { PolityCodeSchema, PolitySchema } from "./polity.ts";
import { UnitSchema } from "./units.ts";
import { MarkerSchema } from "./markers.ts";

export const LabelStyleSchema = z.object({
  font: z.string().default(""),
  textColor: z.string().default(""),
  haloColor: z.string().default(""),
});

export const CatalystSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
});

/**
 * The complete mutable world at one timeline node. Deliberately excludes
 * everything the reference stuffed into its world god-object that is really
 * per-node or derived data: history lives in events/facts, suggestions are
 * ephemeral, dates live on the node.
 */
export const WorldStateSchema = z.object({
  /** regionId -> owning polity code; the map truth. */
  regionOwnership: z.record(z.string(), PolityCodeSchema).default({}),
  /** regionId -> claimant polity codes (disputed striping), max 4. */
  regionClaimants: z.record(z.string(), z.array(z.string()).max(4)).default({}),
  /** Canonical polity registry, keyed by code. */
  polities: z.record(z.string(), PolitySchema).default({}),
  units: z.array(UnitSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  activeCatalyst: CatalystSchema.nullable().default(null),
  labelStyle: LabelStyleSchema.default({ font: "", textColor: "", haloColor: "" }),
  /** Scenario-author extra simulation rules, appended to the prompt. */
  simulationRules: z.string().default(""),
  notes: z.string().default(""),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const emptyWorld = (): WorldState => WorldStateSchema.parse({});
