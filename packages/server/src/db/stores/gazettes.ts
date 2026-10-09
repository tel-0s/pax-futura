import { GazetteSchema, type Gazette } from "@pax/domain";
import type { Db } from "../openDb.ts";

export const getStoredGazette = (db: Db, nodeId: string): Gazette | null => {
  const row = db
    .prepare("SELECT payload_json FROM gazettes WHERE node_id = ?")
    .get(nodeId) as { payload_json: string } | undefined;
  if (!row) return null;
  // A stale schema OR a malformed value reads as absent and regenerates.
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  const parsed = GazetteSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const putStoredGazette = (db: Db, nodeId: string, gazette: Gazette): void => {
  db.prepare(
    `INSERT INTO gazettes (node_id, payload_json, created_at) VALUES (?, ?, ?)
     ON CONFLICT (node_id) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
  ).run(nodeId, JSON.stringify(gazette), Date.now());
};
