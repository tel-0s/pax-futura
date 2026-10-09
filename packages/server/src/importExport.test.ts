import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScenarioSchema, newId } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { openAppDb } from "./db/appDb.ts";
import { openDb } from "./db/openDb.ts";
import { migrate } from "./db/migrate.ts";
import { SAVE_MIGRATIONS } from "./db/saveSchema.ts";
import { GameManager } from "./gameManager.ts";

const scenario = ScenarioSchema.parse({
  id: "test",
  name: "Test",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { r1: "FRA" },
    polities: { FRA: { code: "FRA", name: "France", color: "#3d6fb4", tags: [], note: "" } },
  },
});

const LATEST_SAVE_VERSION = SAVE_MIGRATIONS.at(-1)!.version;

let dataDir: string;
let scratch: string;
let manager: GameManager;
let stagingBaseline: number;

const makeManager = (dir: string) =>
  new GameManager(
    openAppDb(dir),
    dir,
    new Map([["test", scenario]]),
    new FakeLlmClient(() => ({ deltas: ["x"] })),
    { connectionId: "fake", model: "fake", contextWindow: 1000, maxOutput: 100 },
  );

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pax-io-data-"));
  scratch = mkdtempSync(join(tmpdir(), "pax-io-scratch-"));
  manager = makeManager(dataDir);
  stagingBaseline = stagingDirs().length;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

/** Save files sitting in the data dir (backups live in a subdirectory). */
const saveFiles = () => readdirSync(dataDir).filter((n) => n.endsWith(".pax.sqlite"));

/** Temp staging directories importGame/exportGame create while they work. */
const stagingDirs = () =>
  readdirSync(tmpdir()).filter((n) => n.startsWith("pax-import-") || n.startsWith("pax-export-"));

const seedGame = (title = "Campaign") => {
  const meta = manager.createGame({
    scenarioId: "test",
    title,
    playerPolity: "FRA",
    difficulty: "standard",
  });
  // A second node so "node count preserved" means something.
  manager.get(meta.gameId).port.insertNode({
    id: newId(),
    parentId: meta.activeNodeId,
    depth: 1,
    status: "complete",
    gameDate: "1936-02-01",
    input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
  });
  return meta;
};

/** Build a save file by hand at an arbitrary schema version. */
const legacySaveBytes = (params: { version: number; withRows: boolean; title?: string }) => {
  const path = join(scratch, `legacy-${params.version}-${Date.now()}.pax.sqlite`);
  const db = openDb(path);
  migrate(
    db,
    SAVE_MIGRATIONS.filter((m) => m.version <= params.version),
  );
  if (params.withRows) {
    db.prepare(
      `INSERT INTO timeline_nodes (id, parent_id, depth, status, game_date, input_json, created_at)
       VALUES ('n1', NULL, 0, 'complete', '1936-01-01', '{"actions":[],"jumpDays":1,"stopPolicy":"toDate"}', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO game (id, game_id, title, scenario_id, player_polity, difficulty, active_node_id, created_at, updated_at)
       VALUES ('game', 'legacy-game', ?, 'test', 'FRA', 'standard', 'n1', 0, 0)`,
    ).run(params.title ?? "Legacy Campaign");
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  return readFileSync(path);
};

describe("export → import round trip", () => {
  it("re-keys a save whose id is still registered, preserving title and nodes", async () => {
    const original = seedGame("The Long Peace");
    const bytes = await manager.exportGame(original.gameId);

    const imported = manager.importGame(bytes);
    expect(imported.gameId).not.toBe(original.gameId);
    expect(imported.title).toBe("The Long Peace");
    expect(imported.playerPolity).toBe("FRA");
    expect(imported.activeNodeId).toBe(original.activeNodeId);

    // Both are registered, both open, both carry the same tree.
    const ids = manager.listGames().map((g) => g.gameId);
    expect(ids).toContain(original.gameId);
    expect(ids).toContain(imported.gameId);
    expect(manager.get(imported.gameId).port.listNodeMetas()).toHaveLength(2);
    expect(manager.get(original.gameId).port.listNodeMetas()).toHaveLength(2);
    // The copy's own game row was re-keyed, not just the registry entry.
    expect(manager.get(imported.gameId).port.getGame().gameId).toBe(imported.gameId);
  });

  it("keeps its original id when nothing has claimed it", async () => {
    const original = seedGame();
    const bytes = await manager.exportGame(original.gameId);
    manager.deleteGame(original.gameId);

    expect(manager.importGame(bytes).gameId).toBe(original.gameId);
  });

  it("imports the same save twice into two independently playable games", async () => {
    const original = seedGame("Twice Told");
    const bytes = await manager.exportGame(original.gameId);

    const first = manager.importGame(bytes);
    const second = manager.importGame(bytes);
    expect(new Set([original.gameId, first.gameId, second.gameId]).size).toBe(3);
    for (const meta of [first, second]) {
      expect(meta.title).toBe("Twice Told");
      expect(manager.get(meta.gameId).port.listNodeMetas()).toHaveLength(2);
    }
    // Distinct files — writing to one must never touch the other.
    expect(saveFiles()).toHaveLength(3);
    manager.setDifficulty(first.gameId, "simulationist");
    expect(manager.gameMeta(second.gameId).difficulty).toBe("standard");
  });

  it("exports a game that a later turn keeps writing to (WAL-safe snapshot)", async () => {
    const original = seedGame();
    const bytes = await manager.exportGame(original.gameId);
    manager.get(original.gameId).port.insertNode({
      id: newId(),
      parentId: original.activeNodeId,
      depth: 1,
      status: "complete",
      gameDate: "1936-03-01",
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    // The exported bytes are a snapshot: the post-export node is not in them.
    expect(manager.get(manager.importGame(bytes).gameId).port.listNodeMetas()).toHaveLength(2);
    expect(manager.get(original.gameId).port.listNodeMetas()).toHaveLength(3);
  });
});

describe("import rejection", () => {
  /** Nothing registered, nothing written to the data dir, no staging left over. */
  const expectNothingLandedOrLeaked = () => {
    expect(saveFiles()).toHaveLength(0);
    expect(manager.listGames()).toHaveLength(0);
    expect(stagingDirs()).toHaveLength(stagingBaseline);
  };

  it("rejects bytes that are not a SQLite database at all", () => {
    expect(() => manager.importGame(Buffer.from("this is a screenshot, not a save"))).toThrow(
      /not a SQLite database/,
    );
    expectNothingLandedOrLeaked();
  });

  it("rejects a SQLite database that carries no game row", () => {
    const bytes = legacySaveBytes({ version: LATEST_SAVE_VERSION, withRows: false });
    expect(() => manager.importGame(bytes)).toThrow(/Not a Pax Futura save/);
    expectNothingLandedOrLeaked();
  });

  it("rejects a file that opens but fails migration, cleaning up the staging copy", () => {
    // Stamped mid-history with none of the tables migration 4 wants to alter.
    const path = join(scratch, "half-baked.pax.sqlite");
    const db = openDb(path);
    db.pragma("user_version = 3");
    db.exec("CREATE TABLE unrelated (x TEXT)");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();

    expect(() => manager.importGame(readFileSync(path))).toThrow(/Cannot open this save/);
    expectNothingLandedOrLeaked();
  });

  it("refuses a save from a newer build instead of corrupting it", async () => {
    const original = seedGame();
    const bytes = await manager.exportGame(original.gameId);
    manager.deleteGame(original.gameId); // free the id, so only the version can refuse it

    const path = join(scratch, "from-future.pax.sqlite");
    writeFileSync(path, bytes);
    const db = openDb(path);
    db.pragma(`user_version = ${LATEST_SAVE_VERSION + 10}`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();

    expect(() => manager.importGame(readFileSync(path))).toThrow(/newer than this build supports/);
    expectNothingLandedOrLeaked();
  });
});

describe("legacy saves", () => {
  it("migrates a v1-era save on import and keeps its tree", () => {
    const bytes = legacySaveBytes({ version: 1, withRows: true, title: "Old Campaign" });

    const meta = manager.importGame(bytes);
    expect(meta.title).toBe("Old Campaign");
    expect(meta.activeNodeId).toBe("n1");

    const game = manager.get(meta.gameId);
    expect(game.db.pragma("user_version", { simple: true })).toBe(LATEST_SAVE_VERSION);
    expect(game.port.getNode("n1")).not.toBeNull();
    expect(existsSync(join(dataDir, `${meta.gameId}.pax.sqlite`))).toBe(true);
  });
});

describe("imported saves join the normal lifecycle", () => {
  it("rolls a backup on the first get() of the imported file", async () => {
    const original = seedGame();
    const bytes = await manager.exportGame(original.gameId);
    const imported = manager.importGame(bytes); // routes through get()

    const backupDir = join(dataDir, "backups");
    const landed = await waitFor(() =>
      existsSync(backupDir)
        ? readdirSync(backupDir).some((n) => n.startsWith(`${imported.gameId}-`))
        : false,
    );
    expect(landed).toBe(true);
  });

  it("can be deleted like any other game", async () => {
    const original = seedGame();
    const imported = manager.importGame(await manager.exportGame(original.gameId));
    manager.deleteGame(imported.gameId);
    expect(manager.listGames().map((g) => g.gameId)).toEqual([original.gameId]);
    expect(existsSync(join(dataDir, `${imported.gameId}.pax.sqlite`))).toBe(false);
  });
});

/** Poll a fire-and-forget side effect for up to ~2s. */
const waitFor = async (predicate: () => boolean): Promise<boolean> => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};
