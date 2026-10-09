import { ERA_SPAN, type EraSummary } from "@pax/domain";
import type { SavePort } from "../ports.ts";
import { NotFoundError } from "../loom/tree.ts";
import { factDigestLine } from "./digest.ts";

/** One post-chronicle turn as the reader shows it: headline plus fact digest. */
export interface ChronicleTurn {
  depth: number;
  gameDate: string;
  summary: string;
  lines: string[];
}

export interface Chronicle {
  /** Complete eras with a stored summary, oldest first. */
  eras: EraSummary[];
  /** Turns after the last summarized era, oldest first; never the root. */
  recent: ChronicleTurn[];
}

/**
 * Read the timeline's history as the player sees it: stored era summaries plus
 * the still-unsummarized tail. Store reads only — the chronicle never
 * generates, so a span awaiting its summary simply stays in the recent tail
 * (the extraction job fills it in later, and this endpoint picks it up then).
 */
export const collectChronicle = (store: SavePort, nodeId: string): Chronicle => {
  const node = store.getNode(nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${nodeId}`);
  const path = store.pathToRoot(nodeId);

  // Path index equals depth (root at 0), the same indexing the summarizer uses
  // to key each ERA_SPAN-wide span by its start/end node ids.
  const eras: EraSummary[] = [];
  let summarizedThrough = 0;
  for (let end = ERA_SPAN; end <= node.depth; end += ERA_SPAN) {
    const startNode = path[end - ERA_SPAN + 1];
    const endNode = path[end];
    if (!startNode || !endNode) break;
    const era = store.getEraSummary(startNode.id, endNode.id);
    // Stop at the first gap so coverage stays contiguous: turns of a missing
    // span (and everything after) fall to the recent tail instead of vanishing
    // between a dropped era and a later one.
    if (!era) break;
    eras.push(era);
    summarizedThrough = end;
  }

  const recent = path.slice(Math.max(summarizedThrough + 1, 1)).map((turn) => ({
    depth: turn.depth,
    gameDate: turn.gameDate,
    summary: turn.summary,
    lines: store.listFactsForNode(turn.id).map(factDigestLine),
  }));

  return { eras, recent };
};
