import { StatSheetSchema, type StatSheet } from "@pax/domain";
import type { Db } from "../openDb.ts";

export const getStatSheet = (db: Db, nodeId: string, polity: string): StatSheet | null => {
  const row = db
    .prepare("SELECT payload_json FROM stat_sheets WHERE node_id = ? AND polity = ?")
    .get(nodeId, polity) as { payload_json: string } | undefined;
  if (!row) return null;
  // A stale schema OR a malformed value reads as absent and regenerates.
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  const parsed = StatSheetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const setStatSheet = (db: Db, sheet: StatSheet): void => {
  db.prepare(
    `INSERT INTO stat_sheets (node_id, polity, payload_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (node_id, polity) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
  ).run(sheet.nodeId, sheet.polity, JSON.stringify(sheet), Date.now());
};
