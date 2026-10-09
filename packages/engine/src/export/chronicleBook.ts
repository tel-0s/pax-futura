import type { EraSummary, GameEvent, TimelineNodeMeta } from "@pax/domain";
import type { NodeRow, SavePort } from "../ports.ts";
import { NotFoundError } from "../loom/tree.ts";
import { collectChronicle, type ChronicleTurn } from "../facts/chronicle.ts";
import {
  escapeHtml,
  renderApocrypha,
  renderDocument,
  renderEraChapter,
  renderPresentAge,
  renderTitlePage,
  type Apocryphon,
  type Passage,
  type Waypoint,
} from "./chronicleBookHtml.ts";

export { escapeHtml };

/** Player bookmarks on the exported path, as margin marks for one turn span. */
const waypointsIn = (
  path: readonly NodeRow[],
  metas: ReadonlyMap<string, TimelineNodeMeta>,
  fromDepth: number,
  toDepth: number,
): Waypoint[] =>
  path
    .filter((node) => node.depth >= fromDepth && node.depth <= toDepth)
    .flatMap((node) => {
      const anchor = metas.get(node.id)?.anchor ?? "";
      return anchor ? [{ date: node.gameDate, anchor }] : [];
    });

/** The unsummarized tail as dated passages: emphasis by event importance. */
const buildPassages = (
  store: SavePort,
  path: readonly NodeRow[],
  metas: ReadonlyMap<string, TimelineNodeMeta>,
  recent: readonly ChronicleTurn[],
): Passage[] => {
  const nodes = recent.flatMap((turn) => {
    const node = path[turn.depth];
    return node ? [{ turn, node }] : [];
  });
  const byNode = new Map<string, GameEvent[]>();
  for (const event of store.listEventsForNodes(nodes.map((entry) => entry.node.id))) {
    const bucket = byNode.get(event.nodeId);
    if (bucket) bucket.push(event);
    else byNode.set(event.nodeId, [event]);
  }

  return nodes.map(({ turn, node }) => {
    const events = byNode.get(node.id) ?? [];
    return {
      date: turn.gameDate,
      summary: turn.summary,
      anchor: metas.get(node.id)?.anchor ?? "",
      major: events.filter((event) => event.importance !== "minor"),
      minor: events.filter((event) => event.importance === "minor"),
      lines: turn.lines,
    };
  });
};

/** Siblings hanging off the exported path — every branch this book did not walk. */
const buildApocrypha = (
  metas: readonly TimelineNodeMeta[],
  path: readonly NodeRow[],
): Apocryphon[] => {
  const onPath = new Set(path.map((node) => node.id));
  return metas
    .filter((meta) => meta.parentId !== null && onPath.has(meta.parentId) && !onPath.has(meta.id))
    .sort((a, b) => a.depth - b.depth || a.createdAt - b.createdAt)
    .map((meta) => ({ date: meta.gameDate, summary: meta.summary, anchor: meta.anchor }));
};

const nationLabel = (store: SavePort, node: NodeRow, code: string): string => {
  const name = node.worldBlobHash ? store.getWorld(node.worldBlobHash).polities[code]?.name : "";
  return name ? `${name} (${code})` : code;
};

const contentsOf = (eras: readonly EraSummary[]): string[] => [
  ...eras.map((era, index) => `${index + 1}. ${era.title}`),
  "Coda · The Present Age",
  "Appendix · Apocrypha",
];

/**
 * Bind the campaign along one loom path into a single self-contained HTML
 * volume: era summaries as chapters, open-threads ledgers as codas, the
 * unsummarized tail as dated passages, unwalked siblings as apocrypha.
 * Deterministic store reads only — no LLM calls.
 */
export const buildChronicleBook = (store: SavePort, nodeId: string): string => {
  const node = store.getNode(nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${nodeId}`);
  const game = store.getGame();
  const chronicle = collectChronicle(store, nodeId);
  const path = store.pathToRoot(nodeId);
  const root = path[0] ?? node;
  const allMetas = store.listNodeMetas();
  const metas = new Map(allMetas.map((meta) => [meta.id, meta]));

  const body = [
    renderTitlePage(
      {
        title: game.title,
        nation: nationLabel(store, node, game.playerPolity),
        difficulty: game.difficulty,
        startDate: root.gameDate,
        endDate: node.gameDate,
        turns: node.depth,
      },
      contentsOf(chronicle.eras),
    ),
    ...chronicle.eras.map((era, index) =>
      renderEraChapter(era, waypointsIn(path, metas, era.startDepth, era.endDepth), index + 1),
    ),
    renderPresentAge(buildPassages(store, path, metas, chronicle.recent)),
    renderApocrypha(buildApocrypha(allMetas, path)),
  ].join("\n");

  return renderDocument(game.title, body);
};
