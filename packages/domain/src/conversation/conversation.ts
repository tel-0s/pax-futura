import { z } from "zod";

export const ConversationKindSchema = z.enum(["advisor", "diplomacy"]);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  kind: ConversationKindSchema,
  title: z.string().min(1),
  /** Polity codes of the non-player participants (diplomacy only). */
  participants: z.array(z.string()).default([]),
  originNodeId: z.string().min(1),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/**
 * Messages are immutable rows forming a tree per conversation. Regenerating a
 * reply adds a sibling assistant message; editing a user message forks a
 * sibling user message. Which path is "selected" at a given timeline node is
 * not stored here — that's the node's head pointer.
 */
export const MessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  parentMessageId: z.string().nullable(),
  role: MessageRoleSchema,
  /** Persona name for diplomacy (polity leader); empty for advisor/user. */
  speaker: z.string().default(""),
  content: z.string(),
  /** The timeline node that was active when this message was authored. */
  authoredNodeId: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type Message = z.infer<typeof MessageSchema>;
