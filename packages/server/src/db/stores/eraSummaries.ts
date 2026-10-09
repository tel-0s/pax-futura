import { EraSummarySchema, type EraSummary } from "@pax/domain";
import type { Db } from "../openDb.ts";

export const getEraSummary = (db: Db, startNodeId: string, endNodeId: string): EraSummary | null => {
  const row = db
    .prepare("SELECT summary FROM era_summaries WHERE start_node_id = ? AND end_node_id = ?")
    .get(startNodeId, endNodeId) as { summary: string } | undefined;
  if (!row) return null;
  // A stale shape OR a malformed/non-JSON value reads as absent and
  // regenerates — this getter runs during every turn assembly, so one
  // corrupted row must never poison the pipeline.
  let raw: unknown;
  try {
    raw = JSON.parse(row.summary);
  } catch {
    return null;
  }
  const parsed = EraSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const putEraSummary = (db: Db, summary: EraSummary): void => {
  db.prepare(
    `INSERT OR REPLACE INTO era_summaries (start_node_id, end_node_id, summary, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(summary.startNodeId, summary.endNodeId, JSON.stringify(summary), Date.now());
};
