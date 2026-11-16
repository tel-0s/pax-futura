import { create } from "zustand";
import type { ConversationAtNode, Message, SseEvent } from "@pax/domain";
import { api } from "../lib/api.ts";

interface ConversationsState {
  /** Conversations visible at the current node, with their head pointers. */
  list: ConversationAtNode[];
  /** Full message tree per conversation. */
  trees: Record<string, Message[]>;
  /** In-flight streamed reply text per conversation. */
  streaming: Record<string, string>;
  /** Optimistic user message shown before the server round-trip lands. */
  pendingUser: Record<string, string>;
  /** True from send until first token: renders the thinking indicator. */
  awaiting: Record<string, boolean>;
  activeConversationId: string | null;
  /**
   * A head moved while the drawer was closed — a nation opened a channel, or a
   * reply landed unseen. Set by the session's SSE handler (the only place that
   * knows whether the drawer is open), cleared when the drawer is looked at.
   */
  unread: boolean;
  /**
   * The game's court-name pool; null until fetched (or when the server could
   * only offer the fallback, in which case the static era lists apply and the
   * next game open retries). Fetched once per game.
   */
  namePool: string[] | null;
  namePoolFor: string | null;
  loadNamePool: (gameId: string) => Promise<void>;

  load: (gameId: string, nodeId: string) => Promise<void>;
  /** List + head pointers only — no tree refetches (per-reply refresh path). */
  refreshList: (gameId: string, nodeId: string) => Promise<void>;
  loadTree: (gameId: string, conversationId: string) => Promise<void>;
  setActive: (conversationId: string | null) => void;
  /** Mark a send/regenerate in flight (optimistic UI). */
  markSending: (conversationId: string, userText?: string) => void;
  clearSending: (conversationId: string) => void;
  setUnread: (unread: boolean) => void;
  applySse: (event: SseEvent, gameId: string, nodeId: string | null) => void;
}

/**
 * Monotonic guard against out-of-order list responses: rapid node checkouts
 * (or a reply completing mid-checkout) must not let an older node's
 * conversation list land on top of the newer one.
 */
let listToken = 0;

const applyList = (
  set: (fn: (state: ConversationsState) => Partial<ConversationsState>) => void,
  list: ConversationAtNode[],
): void =>
  set((state) => ({
    list,
    // A deliberately null active id means the desk is open; refreshList runs
    // on every message.completed, so falling back to list[0] here would yank
    // the drawer into the first letter whenever a reply lands. Only a STALE
    // id (its conversation gone from this node) falls back.
    activeConversationId:
      state.activeConversationId === null
        ? null
        : list.some((c) => c.id === state.activeConversationId)
          ? state.activeConversationId
          : (list[0]?.id ?? null),
  }));

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  list: [],
  trees: {},
  streaming: {},
  pendingUser: {},
  awaiting: {},
  activeConversationId: null,
  unread: false,
  namePool: null,
  namePoolFor: null,

  loadNamePool: async (gameId) => {
    if (get().namePoolFor === gameId) return;
    set({ namePool: null, namePoolFor: gameId });
    try {
      const result = await api.councilNames(gameId);
      if (get().namePoolFor !== gameId) return; // the game changed underneath
      set({ namePool: result.source === "generated" ? result.names : null });
    } catch {
      // The static era lists are the floor; nothing to surface.
    }
  },

  load: async (gameId, nodeId) => {
    const token = ++listToken;
    const list = await api.listConversations(gameId, nodeId);
    if (token !== listToken) return; // a newer load superseded this one
    applyList(set, list);
    await Promise.all(list.map((conversation) => get().loadTree(gameId, conversation.id)));
  },

  refreshList: async (gameId, nodeId) => {
    const token = ++listToken;
    const list = await api.listConversations(gameId, nodeId);
    if (token !== listToken) return;
    applyList(set, list);
  },

  loadTree: async (gameId, conversationId) => {
    const tree = await api.getConversationTree(gameId, conversationId);
    set((state) => ({ trees: { ...state.trees, [conversationId]: tree.messages } }));
  },

  setActive: (conversationId) => set({ activeConversationId: conversationId }),

  markSending: (conversationId, userText) =>
    set((state) => ({
      awaiting: { ...state.awaiting, [conversationId]: true },
      ...(userText !== undefined
        ? { pendingUser: { ...state.pendingUser, [conversationId]: userText } }
        : {}),
    })),

  // Clears ALL transient lanes, streaming included: a reply that streamed
  // partial text and then failed has no message.completed coming — without
  // this, the ghost stream text stays on screen forever.
  clearSending: (conversationId) =>
    set((state) => {
      const streaming = { ...state.streaming };
      const awaiting = { ...state.awaiting };
      const pendingUser = { ...state.pendingUser };
      delete streaming[conversationId];
      delete awaiting[conversationId];
      delete pendingUser[conversationId];
      return { streaming, awaiting, pendingUser };
    }),

  setUnread: (unread) => set({ unread }),

  applySse: (event, gameId, nodeId) => {
    if (event.type === "message.delta") {
      set((state) => ({
        streaming: {
          ...state.streaming,
          [event.conversationId]: (state.streaming[event.conversationId] ?? "") + event.delta,
        },
      }));
    } else if (event.type === "message.completed") {
      // Refetch FIRST, clear the transient lanes after: clearing eagerly made
      // every exchange flash (both bubbles vanished for one HTTP round-trip
      // before the authoritative tree landed). Only the completed
      // conversation's tree is refetched — heads move via the cheap list call.
      void (async () => {
        try {
          await get().loadTree(gameId, event.conversationId);
          if (nodeId) await get().refreshList(gameId, nodeId);
        } finally {
          get().clearSending(event.conversationId);
        }
      })();
    }
  },
}));

/** Root -> head path within a message tree. */
export const selectMessagePath = (
  messages: readonly Message[],
  headMessageId: string | null,
): Message[] => {
  if (!headMessageId) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const path: Message[] = [];
  let cursor = byId.get(headMessageId);
  while (cursor) {
    path.push(cursor);
    cursor = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : undefined;
  }
  return path.reverse();
};

/** Sibling group for a message (same parent), in creation (ulid) order. */
export const selectMessageSiblings = (
  messages: readonly Message[],
  messageId: string,
): Message[] => {
  const target = messages.find((message) => message.id === messageId);
  if (!target) return [];
  return messages
    .filter((message) => message.parentMessageId === target.parentMessageId && message.role === target.role)
    .sort((a, b) => a.id.localeCompare(b.id));
};

export interface SiblingPosition {
  /** 0-based position within the sibling group. */
  index: number;
  count: number;
}

/**
 * Sibling index/count for every message in one pass. Calling
 * `selectMessageSiblings` per rendered message is quadratic, which shows up in
 * long advisor threads; this is the same grouping (same parent, same role,
 * ulid order) computed once per tree.
 */
export const selectSiblingPositions = (
  messages: readonly Message[],
): Map<string, SiblingPosition> => {
  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const key = `${message.parentMessageId ?? ""}\u0000${message.role}`;
    const group = groups.get(key);
    if (group) group.push(message);
    else groups.set(key, [message]);
  }
  const positions = new Map<string, SiblingPosition>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((message, index) => {
      positions.set(message.id, { index, count: group.length });
    });
  }
  return positions;
};

/** Deepest descendant along the newest-child chain — the leaf a sibling flip lands on. */
export const selectDeepestDescendant = (
  messages: readonly Message[],
  messageId: string,
): string => {
  let current = messageId;
  for (;;) {
    const children = messages
      .filter((message) => message.parentMessageId === current)
      .sort((a, b) => b.id.localeCompare(a.id));
    if (children.length === 0) return current;
    current = children[0]!.id;
  }
};
