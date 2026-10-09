import { ActionSchema, newId, type Action } from "@pax/domain";
import type { Db } from "../openDb.ts";

export const addPendingAction = (db: Db, nodeId: string, action: Omit<Action, "id">): Action => {
  const full = ActionSchema.parse({ ...action, id: newId() });
  db.prepare(
    "INSERT INTO pending_actions (id, node_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
  ).run(full.id, nodeId, JSON.stringify(full), Date.now());
  return full;
};

export const listPendingActions = (db: Db, nodeId: string): Action[] => {
  const rows = db
    .prepare("SELECT payload_json FROM pending_actions WHERE node_id = ? ORDER BY id")
    .all(nodeId) as Array<{ payload_json: string }>;
  return rows.map((row) => ActionSchema.parse(JSON.parse(row.payload_json)));
};

export const removePendingAction = (db: Db, nodeId: string, actionId: string): boolean => {
  const result = db
    .prepare("DELETE FROM pending_actions WHERE node_id = ? AND id = ?")
    .run(nodeId, actionId);
  return result.changes > 0;
};

export const clearPendingActions = (db: Db, nodeId: string): void => {
  db.prepare("DELETE FROM pending_actions WHERE node_id = ?").run(nodeId);
};
