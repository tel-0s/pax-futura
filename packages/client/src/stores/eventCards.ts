import { create } from "zustand";
import type { GameEvent } from "@pax/domain";
import { api } from "../lib/api.ts";
import { focusEvent } from "../lib/mapController.ts";

interface EventCardsState {
  nodeId: string | null;
  events: GameEvent[];
  index: number;
  open: boolean;
  listOpen: boolean;

  /** Open the card walk for a just-completed turn (oldest event first — the walk runs forward in time). */
  openForNode: (gameId: string, nodeId: string) => Promise<void>;
  /** Open the card walk on an already-loaded event list, starting at `index`. */
  show: (events: GameEvent[], index: number) => void;
  goTo: (index: number) => void;
  next: () => void;
  close: () => void;
  setListOpen: (open: boolean) => void;
}

export const useEventCardsStore = create<EventCardsState>((set, get) => ({
  nodeId: null,
  events: [],
  index: 0,
  open: false,
  listOpen: false,

  openForNode: async (gameId, nodeId) => {
    // A replayed world.changed (SSE reconnect) must not restart an open walk.
    if (get().nodeId === nodeId && get().open) return;
    const events = await api.listNodeEvents(gameId, nodeId);
    if (events.length === 0) return;
    set({ nodeId, events, index: 0, open: true, listOpen: false });
    focusEvent(events[0]!);
  },

  show: (events, index) => {
    const first = events[0];
    if (!first) return;
    // Adopt a nodeId only when the whole list belongs to one node — and clear
    // it otherwise, so the reopen guard above never trusts stale identity.
    const uniform = events.every((event) => event.nodeId === first.nodeId);
    set({ events, nodeId: uniform ? first.nodeId : null });
    get().goTo(index);
  },

  goTo: (index) => {
    const { events } = get();
    const clamped = Math.max(0, Math.min(events.length - 1, index));
    set({ index: clamped, listOpen: false, open: true });
    const event = events[clamped];
    if (event) focusEvent(event);
  },

  next: () => {
    const { index, events } = get();
    if (index + 1 >= events.length) {
      set({ open: false, listOpen: false });
    } else {
      get().goTo(index + 1);
    }
  },

  close: () => set({ open: false, listOpen: false }),
  setListOpen: (listOpen) => set({ listOpen }),
}));
