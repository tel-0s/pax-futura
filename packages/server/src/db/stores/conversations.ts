import {
  ConversationSchema,
  MessageSchema,
  newId,
  type Conversation,
  type Message,
} from "@pax/domain";
import type { Db } from "../openDb.ts";

export const createConversation = (
  db: Db,
  params: Omit<Conversation, "id"> & { nodeId: string },
): Conversation => {
  const conversation = ConversationSchema.parse({ ...params, id: newId() });
  db.prepare(
    `INSERT INTO conversations (id, kind, title, participants_json, origin_node_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    conversation.id,
    conversation.kind,
    conversation.title,
    JSON.stringify(conversation.participants),
    conversation.originNodeId,
    Date.now(),
  );
  // The conversation exists at its origin node from birth.
  db.prepare(
    "INSERT INTO node_conversation_state (node_id, conversation_id, head_message_id) VALUES (?, ?, NULL)",
  ).run(params.nodeId, conversation.id);
  return conversation;
};

export const getConversation = (db: Db, id: string): Conversation | null => {
  const raw = db
    .prepare(
      "SELECT id, kind, title, participants_json, origin_node_id FROM conversations WHERE id = ?",
    )
    .get(id) as
    | { id: string; kind: Conversation["kind"]; title: string; participants_json: string; origin_node_id: string }
    | undefined;
  if (!raw) return null;
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    participants: JSON.parse(raw.participants_json) as string[],
    originNodeId: raw.origin_node_id,
  };
};

export const insertMessage = (db: Db, message: Omit<Message, "id"> & { id?: string }): Message => {
  const full = MessageSchema.parse({ ...message, id: message.id ?? newId() });
  db.prepare(
    `INSERT INTO messages (id, conversation_id, parent_message_id, role, speaker, content, authored_node_id, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    full.id,
    full.conversationId,
    full.parentMessageId,
    full.role,
    full.speaker,
    full.content,
    full.authoredNodeId,
    JSON.stringify(full.meta),
    Date.now(),
  );
  return full;
};

interface RawMessageRow {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: Message["role"];
  speaker: string;
  content: string;
  authored_node_id: string;
  meta_json: string;
}

const toMessage = (raw: RawMessageRow): Message => ({
  id: raw.id,
  conversationId: raw.conversation_id,
  parentMessageId: raw.parent_message_id,
  role: raw.role,
  speaker: raw.speaker,
  content: raw.content,
  authoredNodeId: raw.authored_node_id,
  meta: JSON.parse(raw.meta_json) as Record<string, unknown>,
});

/** The full message tree for a conversation (loom UI + branch navigation). */
export const listMessages = (db: Db, conversationId: string): Message[] => {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as RawMessageRow[];
  return rows.map(toMessage);
};

/** Root -> head path selected by a head pointer; a head id fully determines it. */
export const messagePath = (db: Db, headMessageId: string): Message[] => {
  const rows = db
    .prepare(
      `WITH RECURSIVE path(idx, msg_id) AS (
         SELECT 0, ?
         UNION ALL
         SELECT path.idx + 1, m.parent_message_id FROM messages m
         JOIN path ON m.id = path.msg_id WHERE m.parent_message_id IS NOT NULL
       )
       SELECT m.* FROM path JOIN messages m ON m.id = path.msg_id
       ORDER BY path.idx DESC`,
    )
    .all(headMessageId) as RawMessageRow[];
  return rows.map(toMessage);
};

export interface NodeConversationState {
  conversationId: string;
  headMessageId: string | null;
}

/** Conversations visible at a node = exactly the rows in the pivot table. */
export const conversationsAtNode = (
  db: Db,
  nodeId: string,
): Array<Conversation & { headMessageId: string | null }> => {
  const rows = db
    .prepare(
      `SELECT c.id, c.kind, c.title, c.participants_json, c.origin_node_id, s.head_message_id
       FROM node_conversation_state s JOIN conversations c ON c.id = s.conversation_id
       WHERE s.node_id = ? ORDER BY c.id`,
    )
    .all(nodeId) as Array<{
    id: string;
    kind: Conversation["kind"];
    title: string;
    participants_json: string;
    origin_node_id: string;
    head_message_id: string | null;
  }>;
  return rows.map((raw) => ({
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    participants: JSON.parse(raw.participants_json) as string[],
    originNodeId: raw.origin_node_id,
    headMessageId: raw.head_message_id,
  }));
};

export const setHead = (
  db: Db,
  nodeId: string,
  conversationId: string,
  headMessageId: string | null,
): void => {
  db.prepare(
    `INSERT INTO node_conversation_state (node_id, conversation_id, head_message_id) VALUES (?, ?, ?)
     ON CONFLICT (node_id, conversation_id) DO UPDATE SET head_message_id = excluded.head_message_id`,
  ).run(nodeId, conversationId, headMessageId);
};

/**
 * The canonicalization step: copy every head pointer from parent to child at
 * turn execution. The copy freezes "what was said" for the child; the parent's
 * pointers stay live for further exploration.
 */
export const copyHeads = (db: Db, fromNodeId: string, toNodeId: string): void => {
  db.prepare(
    `INSERT INTO node_conversation_state (node_id, conversation_id, head_message_id)
     SELECT ?, conversation_id, head_message_id FROM node_conversation_state WHERE node_id = ?`,
  ).run(toNodeId, fromNodeId);
};
