import { NodeInputSchema, type NodeStatus, type TimelineNodeMeta, type NodeInput } from "@pax/domain";
import type { Db } from "../openDb.ts";

export interface InsertNodeParams {
  id: string;
  parentId: string | null;
  depth: number;
  status: NodeStatus;
  gameDate: string;
  input: NodeInput;
  summary?: string;
  worldBlobHash?: string | null;
}

export const insertNode = (db: Db, params: InsertNodeParams): void => {
  db.prepare(
    `INSERT INTO timeline_nodes (id, parent_id, depth, status, game_date, input_json, summary, world_blob_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id,
    params.parentId,
    params.depth,
    params.status,
    params.gameDate,
    JSON.stringify(params.input),
    params.summary ?? "",
    params.worldBlobHash ?? null,
    Date.now(),
  );
};

export interface NodeRow {
  id: string;
  parentId: string | null;
  depth: number;
  status: NodeStatus;
  gameDate: string;
  input: NodeInput;
  summary: string;
  worldBlobHash: string | null;
  preferredChildId: string | null;
  extractionStatus: "none" | "pending" | "done" | "failed";
  errorJson: string | null;
  createdAt: number;
}

interface RawNodeRow {
  id: string;
  parent_id: string | null;
  depth: number;
  status: NodeStatus;
  game_date: string;
  input_json: string;
  summary: string;
  world_blob_hash: string | null;
  preferred_child_id: string | null;
  extraction_status: NodeRow["extractionStatus"];
  error_json: string | null;
  created_at: number;
}

const toNodeRow = (raw: RawNodeRow): NodeRow => ({
  id: raw.id,
  parentId: raw.parent_id,
  depth: raw.depth,
  status: raw.status,
  gameDate: raw.game_date,
  input: NodeInputSchema.parse(JSON.parse(raw.input_json)),
  summary: raw.summary,
  worldBlobHash: raw.world_blob_hash,
  preferredChildId: raw.preferred_child_id,
  extractionStatus: raw.extraction_status,
  errorJson: raw.error_json,
  createdAt: raw.created_at,
});

export const getNode = (db: Db, id: string): NodeRow | null => {
  const raw = db.prepare("SELECT * FROM timeline_nodes WHERE id = ?").get(id) as RawNodeRow | undefined;
  return raw ? toNodeRow(raw) : null;
};

const META_SELECT = `
  SELECT n.id, n.parent_id, n.depth, n.status, n.game_date, n.summary, n.anchor, n.preferred_child_id, n.created_at,
         (SELECT COUNT(*) FROM events e WHERE e.node_id = n.id) AS event_count,
         (SELECT COUNT(*) FROM node_conversation_state s WHERE s.node_id = n.id) AS conversation_count
  FROM timeline_nodes n`;

type RawMetaRow = Pick<
  RawNodeRow,
  "id" | "parent_id" | "depth" | "status" | "game_date" | "summary" | "preferred_child_id" | "created_at"
> & { event_count: number; conversation_count: number; anchor: string | null };

const toMeta = (raw: RawMetaRow): TimelineNodeMeta => ({
  id: raw.id,
  parentId: raw.parent_id,
  depth: raw.depth,
  status: raw.status,
  gameDate: raw.game_date,
  summary: raw.summary,
  anchor: raw.anchor ?? "",
  preferredChildId: raw.preferred_child_id,
  eventCount: raw.event_count,
  conversationCount: raw.conversation_count,
  createdAt: raw.created_at,
});

/** Set or clear ("" clears) a node's player-named bookmark. */
export const setNodeAnchor = (db: Db, id: string, anchor: string): boolean =>
  db
    .prepare("UPDATE timeline_nodes SET anchor = ? WHERE id = ?")
    .run(anchor.trim() || null, id).changes > 0;

export const getNodeMeta = (db: Db, id: string): TimelineNodeMeta | null => {
  const raw = db.prepare(`${META_SELECT} WHERE n.id = ?`).get(id) as RawMetaRow | undefined;
  return raw ? toMeta(raw) : null;
};

/** All nodes with the counts the loom UI renders; one query, small rows. */
export const listNodeMetas = (db: Db): TimelineNodeMeta[] => {
  const rows = db.prepare(`${META_SELECT} ORDER BY n.id`).all() as RawMetaRow[];
  return rows.map(toMeta);
};

export const completeNode = (
  db: Db,
  params: { id: string; gameDate: string; summary: string; worldBlobHash: string },
): void => {
  db.prepare(
    `UPDATE timeline_nodes SET status = 'complete', game_date = ?, summary = ?, world_blob_hash = ?
     WHERE id = ?`,
  ).run(params.gameDate, params.summary, params.worldBlobHash, params.id);
};

export const failNode = (db: Db, id: string, error: unknown): void => {
  db.prepare("UPDATE timeline_nodes SET status = 'failed', error_json = ? WHERE id = ?").run(
    JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
    id,
  );
};

export const setExtractionStatus = (
  db: Db,
  id: string,
  status: NodeRow["extractionStatus"],
): void => {
  db.prepare("UPDATE timeline_nodes SET extraction_status = ? WHERE id = ?").run(status, id);
};

export const setPreferredChild = (db: Db, parentId: string, childId: string | null): void => {
  db.prepare("UPDATE timeline_nodes SET preferred_child_id = ? WHERE id = ?").run(childId, parentId);
};

/** Node ids from the root down to (and including) nodeId. */
export const pathToRoot = (db: Db, nodeId: string): NodeRow[] => {
  const rows = db
    .prepare(
      `WITH RECURSIVE path(idx, node_id) AS (
         SELECT 0, ?
         UNION ALL
         SELECT path.idx + 1, n.parent_id FROM timeline_nodes n
         JOIN path ON n.id = path.node_id WHERE n.parent_id IS NOT NULL
       )
       SELECT n.* FROM path JOIN timeline_nodes n ON n.id = path.node_id
       ORDER BY path.idx DESC`,
    )
    .all(nodeId) as RawNodeRow[];
  return rows.map(toNodeRow);
};

/** All node ids in the subtree rooted at nodeId (inclusive). */
export const subtreeIds = (db: Db, nodeId: string): string[] => {
  const rows = db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ?
         UNION ALL
         SELECT n.id FROM timeline_nodes n JOIN sub ON n.parent_id = sub.id
       )
       SELECT id FROM sub`,
    )
    .all(nodeId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

/** Delete a subtree; FK cascade removes events/messages/pointers beneath it. */
export const deleteSubtree = (db: Db, nodeId: string): void => {
  db.prepare("DELETE FROM timeline_nodes WHERE id = ?").run(nodeId);
};
