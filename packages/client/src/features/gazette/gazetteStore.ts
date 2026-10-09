import { create } from "zustand";
import type { Gazette } from "@pax/domain";
import { api } from "../../lib/api.ts";

interface GazetteState {
  byNode: Record<string, Gazette>;
  loading: Record<string, boolean>;
  error: Record<string, string | undefined>;
  /** Cached per nodeId — reopening the panel on the same node is instant. */
  fetch: (gameId: string, nodeId: string, force?: boolean) => Promise<void>;
}

export const useGazetteStore = create<GazetteState>((set, get) => ({
  byNode: {},
  loading: {},
  error: {},

  fetch: async (gameId, nodeId, force = false) => {
    if (!force && get().byNode[nodeId]) return;
    if (get().loading[nodeId]) return;
    set((state) => ({
      loading: { ...state.loading, [nodeId]: true },
      error: { ...state.error, [nodeId]: undefined },
    }));
    try {
      const gazette = await api.getGazette(gameId, nodeId);
      set((state) => ({
        byNode: { ...state.byNode, [nodeId]: gazette },
        loading: { ...state.loading, [nodeId]: false },
      }));
    } catch (cause) {
      set((state) => ({
        loading: { ...state.loading, [nodeId]: false },
        error: {
          ...state.error,
          [nodeId]: cause instanceof Error ? cause.message : "Could not load the gazette",
        },
      }));
    }
  },
}));
