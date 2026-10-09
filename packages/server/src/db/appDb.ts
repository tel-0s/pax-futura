import { join } from "node:path";
import { SavedPolitySchema, newId, type SavedPolity } from "@pax/domain";
import { migrate } from "./migrate.ts";
import { openDb, type Db } from "./openDb.ts";
import { APP_MIGRATIONS } from "./appSchema.ts";

export const openAppDb = (dataDir: string): Db => {
  const db = openDb(join(dataDir, "app.sqlite"));
  migrate(db, APP_MIGRATIONS);
  return db;
};

export interface RegistryEntry {
  gameId: string;
  filePath: string;
  title: string;
  scenarioId: string;
  playerPolity: string;
  lastPlayedAt: number | null;
  createdAt: number;
}

export const registerGame = (db: Db, entry: Omit<RegistryEntry, "lastPlayedAt" | "createdAt">): void => {
  db.prepare(
    `INSERT INTO game_registry (game_id, file_path, title, scenario_id, player_polity, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entry.gameId, entry.filePath, entry.title, entry.scenarioId, entry.playerPolity, Date.now());
};

export const listGames = (db: Db): RegistryEntry[] =>
  (
    db
      .prepare(
        `SELECT game_id AS gameId, file_path AS filePath, title, scenario_id AS scenarioId,
                player_polity AS playerPolity, last_played_at AS lastPlayedAt, created_at AS createdAt
         FROM game_registry ORDER BY COALESCE(last_played_at, created_at) DESC`,
      )
      .all() as RegistryEntry[]
  );

export const getRegistryEntry = (db: Db, gameId: string): RegistryEntry | null =>
  (db
    .prepare(
      `SELECT game_id AS gameId, file_path AS filePath, title, scenario_id AS scenarioId,
              player_polity AS playerPolity, last_played_at AS lastPlayedAt, created_at AS createdAt
       FROM game_registry WHERE game_id = ?`,
    )
    .get(gameId) as RegistryEntry | undefined) ?? null;

export const touchGame = (db: Db, gameId: string): void => {
  db.prepare("UPDATE game_registry SET last_played_at = ? WHERE game_id = ?").run(Date.now(), gameId);
};

export const unregisterGame = (db: Db, gameId: string): void => {
  db.prepare("DELETE FROM game_registry WHERE game_id = ?").run(gameId);
};

export interface StoredTheme {
  id: string;
  name: string;
  payload: unknown;
}

export const listThemes = (db: Db): StoredTheme[] =>
  (db.prepare("SELECT id, name, payload_json FROM themes ORDER BY name").all() as Array<{
    id: string;
    name: string;
    payload_json: string;
  }>).map((row) => ({ id: row.id, name: row.name, payload: JSON.parse(row.payload_json) }));

export const saveTheme = (db: Db, id: string, name: string, payload: unknown): void => {
  db.prepare(
    `INSERT INTO themes (id, name, payload_json, builtin, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, payload_json = excluded.payload_json`,
  ).run(id, name, JSON.stringify(payload), Date.now());
};

export const deleteTheme = (db: Db, id: string): boolean =>
  db.prepare("DELETE FROM themes WHERE id = ?").run(id).changes > 0;

export const listSavedPolities = (db: Db): SavedPolity[] =>
  (db.prepare("SELECT payload_json FROM saved_polities ORDER BY name").all() as Array<{
    payload_json: string;
  }>)
    .map((row) => {
      // A malformed or stale-shaped row reads as absent rather than breaking
      // the whole library list.
      try {
        const parsed = SavedPolitySchema.safeParse(JSON.parse(row.payload_json));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    })
    .filter((polity): polity is SavedPolity => polity !== null);

export const saveSavedPolity = (db: Db, polity: SavedPolity): void => {
  db.prepare(
    `INSERT INTO saved_polities (id, name, payload_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, payload_json = excluded.payload_json`,
  ).run(polity.id, polity.name, JSON.stringify(polity), polity.createdAt);
};

export const deleteSavedPolity = (db: Db, id: string): boolean =>
  db.prepare("DELETE FROM saved_polities WHERE id = ?").run(id).changes > 0;

export const getSetting = <T>(db: Db, key: string): T | null => {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  return row ? (JSON.parse(row.value_json) as T) : null;
};

export const setSetting = (db: Db, key: string, value: unknown): void => {
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(value));
};

/** Which structured-output rung last worked for a connection+model, or null if never learned. */
export const getProviderRung = (db: Db, connectionId: string, model: string): string | null => {
  const row = db
    .prepare("SELECT rung FROM provider_rungs WHERE connection_id = ? AND model = ?")
    .get(connectionId, model) as { rung: string } | undefined;
  return row?.rung ?? null;
};

export const setProviderRung = (db: Db, connectionId: string, model: string, rung: string): void => {
  db.prepare(
    `INSERT INTO provider_rungs (connection_id, model, rung, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (connection_id, model) DO UPDATE SET rung = excluded.rung, updated_at = excluded.updated_at`,
  ).run(connectionId, model, rung, Date.now());
};

export interface LlmUsageRecord {
  connectionId: string;
  model: string;
  taskLabel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  stopReason: string;
}

export interface LlmUsageLogRow extends LlmUsageRecord {
  id: string;
  createdAt: number;
}

/**
 * Global usage ledger — see the migration-3 comment in appSchema.ts for why
 * this is app-scoped rather than the per-save `llm_calls` table. Fire-and-
 * forget from the caller's perspective: this function itself never throws
 * (a write failure is swallowed and warned), so logging can never break a turn.
 */
export const recordLlmUsage = (db: Db, record: LlmUsageRecord): void => {
  try {
    db.prepare(
      `INSERT INTO llm_usage_log
         (id, connection_id, model, task_label, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, duration_ms, stop_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      record.connectionId,
      record.model,
      record.taskLabel,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens,
      record.cacheWriteTokens,
      record.durationMs,
      record.stopReason,
      Date.now(),
    );
  } catch (error) {
    console.warn("Failed to record LLM usage (ignored):", error);
  }
};

/** For the smoke script and tests: usage rows written at or after `sinceMs`. */
export const listLlmUsageSince = (db: Db, sinceMs: number): LlmUsageLogRow[] =>
  (
    db
      .prepare(
        `SELECT id, connection_id AS connectionId, model, task_label AS taskLabel,
                input_tokens AS inputTokens, output_tokens AS outputTokens,
                cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
                duration_ms AS durationMs, stop_reason AS stopReason, created_at AS createdAt
         FROM llm_usage_log WHERE created_at >= ? ORDER BY created_at ASC`,
      )
      .all(sinceMs) as LlmUsageLogRow[]
  );
