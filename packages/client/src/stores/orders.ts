import { create } from "zustand";
import type { Action } from "@pax/domain";
import { api } from "../lib/api.ts";

interface OrdersState {
  /** Pending orders queued on the current node, consumed by the next turn. */
  orders: Action[];
  /**
   * The command line's unsent text. Lives here (not in the Dock) so an
   * advisor's adopted proposal can land in it from the correspondence
   * drawer — adoption drafts; only the player submits.
   */
  draft: string;
  setDraft: (text: string) => void;
  /** Append a block to the draft, separated by a blank line when non-empty. */
  appendToDraft: (text: string) => void;
  load: (gameId: string, nodeId: string) => Promise<void>;
  submit: (gameId: string, nodeId: string, text: string) => Promise<void>;
  remove: (gameId: string, nodeId: string, actionId: string) => Promise<void>;
  /** Edit = replace: immutable rows server-side, so remove + re-add. */
  update: (gameId: string, nodeId: string, actionId: string, text: string) => Promise<void>;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  draft: "",
  setDraft: (text) => set({ draft: text }),
  appendToDraft: (text) => {
    const current = get().draft.replace(/\s+$/, "");
    set({ draft: current ? `${current}\n\n${text}` : text });
  },

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
