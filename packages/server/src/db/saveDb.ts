import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { WorldStateSchema, newId, type TurnInput, type WorldState } from "@pax/domain";
import { migrate } from "./migrate.ts";
import { openDb, type Db } from "./openDb.ts";
import { SAVE_MIGRATIONS } from "./saveSchema.ts";
import { putJsonBlob } from "./blobStore.ts";
import { insertNode } from "./stores/nodes.ts";

export interface CreateSaveParams {
  gameId: string;
  title: string;
  scenarioId: string;
  playerPolity: string;
  difficulty: string;
  startDate: string;
  world: WorldState;
}

export const openSaveDb = (path: string): Db => {
  const db = openDb(path);
  // The one backup that matters most is the one a migration can't destroy:
  // snapshot BEFORE migrating whenever the save is behind. (The rolling
  // post-open backup can only ever capture the already-migrated file.)
  const version = db.pragma("user_version", { simple: true }) as number;
  const latest = SAVE_MIGRATIONS.at(-1)?.version ?? 0;
  if (version > 0 && version < latest) {
    try {
      snapshotBeforeMigration(db, path, version);
    } catch (error) {
      console.warn(`Pre-migration snapshot failed for ${path} (continuing):`, error);
    }
  }
  migrate(db, SAVE_MIGRATIONS);
  return db;
};

/**
 * Synchronous file-copy snapshot taken while this connection has not yet
 * written anything. Checkpointing first folds the WAL into the main file;
 * if the checkpoint can't complete (another process reading), the -wal/-shm
 * sidecars are copied too so the pair stays a consistent snapshot.
 */
const snapshotBeforeMigration = (db: Db, filePath: string, version: number): void => {
  const dir = join(dirname(filePath), "backups");
  mkdirSync(dir, { recursive: true });
  db.pragma("wal_checkpoint(TRUNCATE)");
  const prefix = basename(filePath, SAVE_SUFFIX);
  const dest = join(dir, `${prefix}-pre-v${version}-${backupStamp()}${SAVE_SUFFIX}`);
  copyFileSync(filePath, dest);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${filePath}${suffix}`)) copyFileSync(`${filePath}${suffix}`, `${dest}${suffix}`);
  }
};

const SAVE_SUFFIX = ".pax.sqlite";

/** Colon/dot-free ISO stamp so the name is safe on every filesystem. */
const backupStamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

/**
 * Snapshot a live save into `<dir>/backups/<game>-<stamp>.pax.sqlite`, then
 * keep only the newest `keep` snapshots of that same game.
 *
 * better-sqlite3's async .backup() is WAL-safe: it copies a consistent view
 * while the game keeps reading and writing. Rejects on any failure — the
 * caller decides whether a backup problem is worth surfacing.
 */
export const backupSave = async (
  db: Db,
  filePath: string,
  keep = 3,
  stamp: string = backupStamp(),
): Promise<void> => {
  const prefix = basename(filePath, SAVE_SUFFIX);
  const dir = join(dirname(filePath), "backups");
  mkdirSync(dir, { recursive: true });
  await db.backup(join(dir, `${prefix}-${stamp}${SAVE_SUFFIX}`));

  // ISO stamps are fixed-width, so lexicographic descending == newest first.
  // Pre-migration snapshots (-pre-vN-) are precious and never pruned.
  const mine = readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(`${prefix}-`) && name.endsWith(SAVE_SUFFIX) && !name.includes("-pre-v"),
    )
    .sort()
    .reverse();
  for (const stale of mine.slice(Math.max(keep, 0))) {
    unlinkSync(join(dir, stale));
  }
};

/** Remove every backup (rolling AND pre-migration) of a deleted game. */
export const deleteSaveBackups = (filePath: string): void => {
  const dir = join(dirname(filePath), "backups");
  const prefix = basename(filePath, SAVE_SUFFIX);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // no backups directory yet
  }
  for (const name of names) {
    if (name.startsWith(`${prefix}-`)) unlinkSync(join(dir, name));
  }
};

/**
 * Create a fresh save: migrated DB, root node (turn 0, the scenario seed)
 * holding the starting world snapshot, and the game singleton pointing at it.
 */
export const createSaveDb = (path: string, params: CreateSaveParams): { db: Db; rootNodeId: string } => {
  const db = openSaveDb(path);
  const rootNodeId = newId();
  const now = Date.now();

  db.transaction(() => {
    const worldHash = putJsonBlob(db, WorldStateSchema.parse(params.world));
    const rootInput: TurnInput = { actions: [], jumpDays: 1, stopPolicy: "toDate" };
    insertNode(db, {
      id: rootNodeId,
      parentId: null,
      depth: 0,
      status: "complete",
      gameDate: params.startDate,
      input: rootInput,
      summary: "Scenario start",
      worldBlobHash: worldHash,
    });
    db.prepare(
      `INSERT INTO game (id, game_id, title, scenario_id, player_polity, difficulty, active_node_id, created_at, updated_at)
       VALUES ('game', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(params.gameId, params.title, params.scenarioId, params.playerPolity, params.difficulty, rootNodeId, now, now);
  })();

  return { db, rootNodeId };
};

export interface GameRow {
  gameId: string;
  title: string;
  scenarioId: string;
  playerPolity: string;
  difficulty: string;
  /** What Advance Time does with an empty orders field. */
  regency: "off" | "draft" | "auto";
  /** How the council deliberates when regency drafts. */
  councilDepth: "joint" | "chamber";
  /** The game's generated court-name pool; null = the static era lists. */
  councilNamePool: string[] | null;
  /** The court's starting knowledge; null = knowledge never modeled. */
  knownPolitiesSeed: string[] | null;
  /** Whether the dispatch feed shows only the court's known world. */
  courtKnowledge: boolean;
  activeNodeId: string;
  createdAt: number;
}

/**
 * Regency lives in the game row's settings_json (a day-one column nobody had
 * used yet): no migration, and any save that predates the feature — or holds
 * junk — reads as today's behavior.
 */
const parseGameSettings = (
  raw: string,
): Pick<GameRow, "regency" | "councilDepth" | "councilNamePool" | "knownPolitiesSeed" | "courtKnowledge"> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const settings = (parsed ?? {}) as Record<string, unknown>;
  const regency =
    settings.regency === "draft" || settings.regency === "auto" ? settings.regency : "off";
  const councilDepth = settings.councilDepth === "chamber" ? "chamber" : "joint";
  const pool = Array.isArray(settings.councilNamePool)
    ? settings.councilNamePool.filter((name): name is string => typeof name === "string" && name.length > 0)
    : null;
  // Three ministers need three distinct names; anything less is the floor.
  const councilNamePool = pool && pool.length >= 3 ? pool : null;
  const seed = Array.isArray(settings.knownPolitiesSeed)
    ? settings.knownPolitiesSeed.filter(
        (code): code is string => typeof code === "string" && code.length > 0,
      )
    : null;
  const knownPolitiesSeed = seed && seed.length > 0 ? seed : null;
  const courtKnowledge = settings.courtKnowledge === true;
  return { regency, councilDepth, councilNamePool, knownPolitiesSeed, courtKnowledge };
};

/** Merge keys into the game row's settings_json, keeping unknown neighbours. */
const mergeGameSettings = (db: Db, patch: Record<string, unknown>): void => {
  const row = db.prepare("SELECT settings_json AS raw FROM game WHERE id = 'game'").get() as
    | { raw: string }
    | undefined;
  let existing: Record<string, unknown>;
  try {
    existing = (JSON.parse(row?.raw ?? "{}") ?? {}) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  db.prepare("UPDATE game SET settings_json = ?, updated_at = ? WHERE id = 'game'").run(
    JSON.stringify({ ...existing, ...patch }),
    Date.now(),
  );
};

export const getGame = (db: Db): GameRow => {
  const row = db
    .prepare(
      `SELECT game_id AS gameId, title, scenario_id AS scenarioId, player_polity AS playerPolity,
              difficulty, active_node_id AS activeNodeId, created_at AS createdAt,
              settings_json AS settingsJson
       FROM game WHERE id = 'game'`,
    )
    .get() as (Omit<GameRow, "regency" | "councilDepth"> & { settingsJson: string }) | undefined;
  if (!row) throw new Error("Corrupt save: missing game row");
  const { settingsJson, ...game } = row;
  return { ...game, ...parseGameSettings(settingsJson) };
};

export const setActiveNode = (db: Db, nodeId: string): void => {
  db.prepare("UPDATE game SET active_node_id = ?, updated_at = ? WHERE id = 'game'").run(
    nodeId,
    Date.now(),
  );
};

/** Live game setting — the simulation-strictness rung, not a loom node. */
export const updateDifficulty = (db: Db, difficulty: string): void => {
  db.prepare("UPDATE game SET difficulty = ?, updated_at = ? WHERE id = 'game'").run(
    difficulty,
    Date.now(),
  );
};

/** Live game setting — regency, merged into settings_json beside future keys. */
export const updateRegency = (
  db: Db,
  settings: { regency: GameRow["regency"]; councilDepth: GameRow["councilDepth"] },
): void => {
  mergeGameSettings(db, { regency: settings.regency, councilDepth: settings.councilDepth });
};

/** Persist the generated court-name pool (a one-time billed artifact). */
export const updateCouncilNamePool = (db: Db, names: readonly string[]): void => {
  mergeGameSettings(db, { councilNamePool: [...names] });
};

/** The court's starting knowledge, resolved from the scenario at creation. */
export const updateKnownPolitiesSeed = (db: Db, codes: readonly string[]): void => {
  mergeGameSettings(db, { knownPolitiesSeed: [...codes] });
};

/** Live game setting — whether the feed shows only the known world. */
export const updateCourtKnowledge = (db: Db, enabled: boolean): void => {
  mergeGameSettings(db, { courtKnowledge: enabled });
};
