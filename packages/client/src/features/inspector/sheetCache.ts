import type { StatSheet } from "@pax/domain";

/**
 * Session memory of stat sheets this client has already seen. Sheets are
 * immutable per (node, polity) unless force-reassessed, so a hit skips the
 * round-trip — and lets the dossier show turn-over-turn deltas against the
 * parent node's sheet WITHOUT requesting it: fetching an uncached parent
 * sheet would cost the server an extra model call, so trends only appear
 * when the parent was already viewed this session.
 *
 * Keyed by game too: imported copies of a save share node ids.
 */
const sheets = new Map<string, StatSheet>();

const key = (gameId: string, nodeId: string, polity: string): string => `${gameId}|${nodeId}|${polity}`;

export const cachedSheet = (gameId: string, nodeId: string, polity: string): StatSheet | undefined =>
  sheets.get(key(gameId, nodeId, polity));

export const rememberSheet = (gameId: string, nodeId: string, polity: string, sheet: StatSheet): void => {
  sheets.set(key(gameId, nodeId, polity), sheet);
};
