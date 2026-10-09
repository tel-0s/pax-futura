import { create } from "zustand";
import type { Action } from "@pax/domain";
import { api } from "../lib/api.ts";

interface OrdersState {
  /** Pending orders queued on the current node, consumed by the next turn. */
  orders: Action[];
  load: (gameId: string, nodeId: string) => Promise<void>;
  submit: (gameId: string, nodeId: string, text: string) => Promise<void>;
  remove: (gameId: string, nodeId: string, actionId: string) => Promise<void>;
  /** Edit = replace: immutable rows server-side, so remove + re-add. */
  update: (gameId: string, nodeId: string, actionId: string, text: string) => Promise<void>;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],

  load: async (gameId, nodeId) => {
    const res = await fetch(`/api/games/${gameId}/nodes/${nodeId}/actions`);
    if (!res.ok) return;
    set({ orders: (await res.json()) as Action[] });
  },

  submit: async (gameId, nodeId, text) => {
    await api.addAction(gameId, nodeId, {
      kind: "action",
      title: text.slice(0, 80),
      text,
      rawInput: text,
      invitees: [],
      source: "player",
    });
    await get().load(gameId, nodeId);
  },

  remove: async (gameId, nodeId, actionId) => {
    await api.removeAction(gameId, nodeId, actionId);
    await get().load(gameId, nodeId);
  },

  update: async (gameId, nodeId, actionId, text) => {
    await api.removeAction(gameId, nodeId, actionId);
    await get().submit(gameId, nodeId, text);
  },
}));
