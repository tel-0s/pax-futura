import { create } from "zustand";
import type { WorldState } from "@pax/domain";
import { api } from "../lib/api.ts";

interface WorldStoreState {
  /** Which node this snapshot belongs to (preview ?? current). */
  forNodeId: string | null;
  world: WorldState | null;
  loading: boolean;

  load: (gameId: string, nodeId: string) => Promise<void>;
  invalidate: () => void;
}

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  forNodeId: null,
  world: null,
  loading: false,

  load: async (gameId, nodeId) => {
    if (get().forNodeId === nodeId && get().world) return;
    set({ loading: true });
    try {
      const world = await api.getWorld(gameId, nodeId);
      // Ignore stale responses that lost the race to a newer load.
      set((state) => (state.loading ? { forNodeId: nodeId, world, loading: false } : state));
    } catch {
      set({ loading: false });
    }
  },

  invalidate: () => set({ forNodeId: null, world: null }),
}));
