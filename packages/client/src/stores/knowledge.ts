import { create } from "zustand";
import { eventPolities, type GameEvent } from "@pax/domain";
import { api } from "../lib/api.ts";

/**
 * The court's known world as of the current node, for the feed filter.
 * `known: null` = knowledge never modeled (uncurated scenario, old save,
 * or simply not yet fetched) and every consumer reads it as omniscient —
 * the feature can only ever subtract from the feed when it is actually on.
 */
interface KnowledgeState {
  known: string[] | null;
  /** The node the set was loaded for; consumers reload on node/facts moves. */
  loadedFor: string | null;
  load: (gameId: string, nodeId: string) => Promise<void>;
}

let loadToken = 0;

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  known: null,
  loadedFor: null,

  load: async (gameId, nodeId) => {
    const token = ++loadToken;
    try {
      const result = await api.knownPolities(gameId, nodeId);
      if (token !== loadToken) return; // a newer load superseded this one
      set({ known: result.known, loadedFor: nodeId });
    } catch {
      if (token !== loadToken) return;
      set({ known: null, loadedFor: nodeId }); // fail open: omniscient
    }
  },
}));

export type FeedVisibility = "shown" | "rumor" | "hidden";

/**
 * The court's-knowledge feed rule. The chronicle keeps everything — this
 * governs only what the feed surfaces show:
 * - player-related events, events naming no polity (world color), and
 *   events whose named polities are all known: shown as themselves;
 * - pivotal events from beyond the known world: a rumor (the court hears
 *   that SOMETHING happened, stripped of standing);
 * - everything else beyond the known world: not in the feed.
 */
export const feedVisibility = (
  event: GameEvent,
  known: string[] | null,
  enabled: boolean,
): FeedVisibility => {
  if (!enabled || known === null || event.playerRelated) return "shown";
  const named = eventPolities(event.impacts);
  if (named.length === 0) return "shown";
  const knownSet = new Set(known);
  if (named.every((code) => knownSet.has(code))) return "shown";
  return event.importance === "pivotal" ? "rumor" : "hidden";
};
