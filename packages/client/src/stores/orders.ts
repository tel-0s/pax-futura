import { create } from "zustand";
import type { Action, CouncilStance } from "@pax/domain";
import { api } from "../lib/api.ts";

/**
 * A regency session in flight. `drafting` while the council sits; `proposed`
 * holds the stances beside the filled draft until the player approves (queue
 * current draft + advance), or dismisses (the draft stays for hand-editing).
 */
export interface CouncilSession {
  status: "drafting" | "proposed" | "failed";
  stances: CouncilStance[];
  /** What the approve button re-runs: the advance the council interrupted. */
  jumpDays: number;
  error?: string;
}

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
  /** Non-null while a regency draft is in flight or awaiting the player. */
  council: CouncilSession | null;
  /** The council sits: fetch a draft into the command line and pause. */
  requestCouncilDraft: (gameId: string, nodeId: string, jumpDays: number) => Promise<void>;
  /** Approve: queue the CURRENT draft (edits included) and advance. */
  approveCouncil: (gameId: string, nodeId: string) => Promise<void>;
  /** Dismiss the pause; the draft stays in the composer for hand-editing. */
  dismissCouncil: () => void;
  load: (gameId: string, nodeId: string) => Promise<void>;
  submit: (gameId: string, nodeId: string, text: string, source?: Action["source"]) => Promise<void>;
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
  council: null,

  requestCouncilDraft: async (gameId, nodeId, jumpDays) => {
    set({ council: { status: "drafting", stances: [], jumpDays } });
    try {
      const result = await api.councilDraft(gameId, nodeId);
      set({
        draft: result.draft,
        council: { status: "proposed", stances: result.stances, jumpDays },
      });
    } catch (error) {
      set({
        council: {
          status: "failed",
          stances: [],
          jumpDays,
          error: error instanceof Error ? error.message : "The council adjourned without a draft.",
        },
      });
    }
  },

  approveCouncil: async (gameId, nodeId) => {
    const { council, draft } = get();
    if (!council || !draft.trim()) return;
    // The player arbitrated (even by assent), so the order is theirs to give;
    // "suggestion" keeps where it came from legible in the record.
    await get().submit(gameId, nodeId, draft.trim(), "suggestion");
    set({ draft: "", council: null });
    void api.executeTurn(gameId, nodeId, { jumpDays: council.jumpDays, stopPolicy: "toDate" }).catch(() => {});
  },

  dismissCouncil: () => set({ council: null }),

  load: async (gameId, nodeId) => {
    const res = await fetch(`/api/games/${gameId}/nodes/${nodeId}/actions`);
    if (!res.ok) return;
    set({ orders: (await res.json()) as Action[] });
  },

  submit: async (gameId, nodeId, text, source = "player") => {
    await api.addAction(gameId, nodeId, {
      kind: "action",
      title: text.slice(0, 80),
      text,
      rawInput: text,
      invitees: [],
      source,
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
