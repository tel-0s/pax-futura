import { z } from "zod";
import { WorldStateSchema } from "./world.ts";

/** An authored starting point: seed world + metadata. Lives in scenarios/. */
export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  startDate: z.string().min(1),
  /** Codes the player may pick; empty = any polity present in the world. */
  playablePolities: z.array(z.object({ code: z.string().min(1), name: z.string() })).default([]),
  /**
   * The court's starting knowledge, keyed by player polity: which polities
   * that court has heard of at game start (its own code is always implied).
   * A missing map, or a missing key, means omniscience — today's behavior —
   * so no scenario is obliged to curate it.
   */
  knownPolities: z.record(z.string(), z.array(z.string())).optional(),
  world: WorldStateSchema,
});
export type Scenario = z.infer<typeof ScenarioSchema>;
