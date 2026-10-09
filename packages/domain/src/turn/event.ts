import { z } from "zod";
import { emptyImpacts, ImpactsSchema } from "./impacts.ts";

export const EventImportanceSchema = z.enum(["minor", "major", "pivotal"]);
export type EventImportance = z.infer<typeof EventImportanceSchema>;

/** An event as the simulator emits it — no identity yet. */
export const EventDraftSchema = z.object({
  date: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  kind: z.string().default("world"),
  importance: EventImportanceSchema.default("minor"),
  playerRelated: z.boolean().default(false),
  // Optional (never defaulted): an event without an identifiable place must
  // parse to an object with NO lng/lat keys, so stored rows predating the
  // column and older model outputs keep round-tripping unchanged.
  lng: z.number().finite().optional(),
  lat: z.number().finite().optional(),
  impacts: ImpactsSchema.default(() => emptyImpacts()),
});
export type EventDraft = z.infer<typeof EventDraftSchema>;

/** An event persisted on a timeline node. */
export const GameEventSchema = EventDraftSchema.extend({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  seq: z.number().int().min(0),
});
export type GameEvent = z.infer<typeof GameEventSchema>;
