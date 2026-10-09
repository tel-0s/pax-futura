import { ImpactsSchema, newId, type EventDraft, type GameEvent } from "@pax/domain";
import type { Db } from "../openDb.ts";

export const insertEvents = (db: Db, nodeId: string, drafts: readonly EventDraft[]): GameEvent[] => {
  const stmt = db.prepare(
    `INSERT INTO events (id, node_id, seq, event_date, title, description, kind, importance, player_related, lng, lat, impacts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return drafts.map((draft, seq) => {
    const id = newId();
    stmt.run(
      id,
      nodeId,
      seq,
      draft.date,
      draft.title,
      draft.description,
      draft.kind,
      draft.importance,
      draft.playerRelated ? 1 : 0,
      draft.lng ?? null,
      draft.lat ?? null,
      JSON.stringify(draft.impacts),
    );
    return { ...draft, id, nodeId, seq };
  });
};

interface RawEventRow {
  id: string;
  node_id: string;
  seq: number;
  event_date: string;
  title: string;
  description: string;
  kind: string;
  importance: GameEvent["importance"];
  player_related: number;
  lng: number | null;
  lat: number | null;
  impacts_json: string;
}

// NULL coordinates must yield an event with NO lng/lat keys, not keys holding
// undefined (exactOptionalPropertyTypes) — the map treats "absent" as "this
// event has no known place" and falls back to walking its impacts.
const toEvent = (raw: RawEventRow): GameEvent => ({
  id: raw.id,
  nodeId: raw.node_id,
  seq: raw.seq,
  date: raw.event_date,
  title: raw.title,
  description: raw.description,
  kind: raw.kind,
  importance: raw.importance,
  playerRelated: raw.player_related === 1,
  ...(raw.lng !== null && raw.lat !== null ? { lng: raw.lng, lat: raw.lat } : {}),
  impacts: ImpactsSchema.parse(JSON.parse(raw.impacts_json)),
});

export const listEventsForNode = (db: Db, nodeId: string): GameEvent[] => {
  const rows = db
    .prepare("SELECT * FROM events WHERE node_id = ? ORDER BY seq")
    .all(nodeId) as RawEventRow[];
  return rows.map(toEvent);
};

export const listEventsForNodes = (db: Db, nodeIds: readonly string[]): GameEvent[] => {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM events WHERE node_id IN (${placeholders}) ORDER BY node_id, seq`)
    .all(...nodeIds) as RawEventRow[];
  return rows.map(toEvent);
};
