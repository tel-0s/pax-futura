import { z } from "zod";
import { TimelineNodeMetaSchema } from "./contracts.ts";

/**
 * Everything the server pushes over a game's SSE channel. The stream is the
 * client's single write path into its stores — REST reads happen only on
 * navigation and initial load.
 */
export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.progress"),
    nodeId: z.string(),
    phase: z.enum(["assembling", "generating", "repairing", "reconciling", "applying"]),
  }),
  /** Raw streamed simulator output (JSON tail) — drives token counters. */
  z.object({ type: z.literal("llm.delta"), nodeId: z.string(), text: z.string() }),
  /** A parsed event title surfaced mid-generation. */
  z.object({ type: z.literal("turn.event"), nodeId: z.string(), title: z.string() }),
  z.object({ type: z.literal("node.created"), node: TimelineNodeMetaSchema }),
  z.object({ type: z.literal("node.updated"), node: TimelineNodeMetaSchema }),
  z.object({ type: z.literal("node.failed"), nodeId: z.string(), error: z.string() }),
  /** Node(s) removed: subtree deletion, or a cancelled generation. */
  z.object({ type: z.literal("node.deleted"), nodeIds: z.array(z.string()) }),
  z.object({ type: z.literal("world.changed"), nodeId: z.string() }),
  z.object({
    type: z.literal("message.delta"),
    conversationId: z.string(),
    messageId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("message.completed"),
    conversationId: z.string(),
    messageId: z.string(),
  }),
  z.object({ type: z.literal("facts.updated"), nodeId: z.string() }),
  z.object({ type: z.literal("game.meta"), activeNodeId: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
