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
  world: WorldStateSchema,
});
export type Scenario = z.infer<typeof ScenarioSchema>;
