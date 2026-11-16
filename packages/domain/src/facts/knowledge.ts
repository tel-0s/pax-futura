/**
 * THE COURT'S KNOWLEDGE — which polities the player's court has heard of.
 *
 * Pure functions shared by the engine (which grows the set at extraction
 * time and folds it through rollups like psyches) and the client (which
 * filters the dispatch feed by it). `null` everywhere means "knowledge was
 * never modeled": pre-feature saves, uncurated scenarios and old rollups
 * all read as omniscient, which is exactly today's behavior.
 *
 * Growth is deterministic — no model call. Contact is: a player-related
 * event whose impacts name the polity, a diplomacy channel with it, or a
 * leader psyche for it (a psyche only exists once a court has acted toward
 * the player's). Knowledge only ever grows; forgetting is not modeled.
 */
import type { Impacts } from "../turn/impacts.ts";

/** Every polity code an event's impacts name. */
export const eventPolities = (impacts: Impacts): string[] => {
  const codes = new Set<string>();
  for (const transfer of impacts.regionTransfers) {
    if (transfer.fromCode) codes.add(transfer.fromCode);
    if (transfer.toCode) codes.add(transfer.toCode);
  }
  for (const change of impacts.polityChanges) codes.add(change.code);
  for (const chat of impacts.createdChats) for (const code of chat.participants) codes.add(code);
  return [...codes];
};

/**
 * One fold step: the parent's knowledge (or the game's seed on the first
 * fold) plus this node's contacts. Null in, null out — a game without a
 * seed stays omniscient forever rather than half-modeled.
 */
export const growKnownPolities = (params: {
  parent: string[] | null;
  seed: string[] | null;
  playerCode: string;
  contacts: Iterable<string>;
}): string[] | null => {
  const base = params.parent ?? params.seed;
  if (!base) return null;
  const known = new Set(base);
  known.add(params.playerCode);
  for (const code of params.contacts) if (code) known.add(code);
  return [...known].sort();
};
