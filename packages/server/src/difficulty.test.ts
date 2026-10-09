import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DIFFICULTIES, ScenarioSchema } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { openAppDb } from "./db/appDb.ts";
import { GameManager } from "./gameManager.ts";

const scenario = ScenarioSchema.parse({
  id: "test",
  name: "Test",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { FRA: "FRA" },
    polities: {
      FRA: { code: "FRA", name: "France", color: "#3d6fb4", tags: ["democratic"], note: "" },
    },
  },
});

const makeManager = (dataDir: string) =>
  new GameManager(
    openAppDb(dataDir),
    dataDir,
    new Map([["test", scenario]]),
    new FakeLlmClient(() => ({ deltas: ["x"] })),
    { connectionId: "fake", model: "fake", contextWindow: 1000, maxOutput: 100 },
  );

let dataDir: string;
let manager: GameManager;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pax-difficulty-"));
  manager = makeManager(dataDir);
});

afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe("difficulty ladder", () => {
  it("exposes five rungs with labels and descriptions", () => {
    expect(DIFFICULTIES.map((level) => level.id)).toEqual([
      "sandbox",
      "permissive",
      "standard",
      "challenging",
      "simulationist",
    ]);
    for (const level of DIFFICULTIES) {
      expect(level.label.length).toBeGreaterThan(0);
      expect(level.description.length).toBeGreaterThan(0);
    }
  });

  it("setDifficulty rewrites the game row and survives a cold reopen", () => {
    const created = manager.createGame({
      scenarioId: "test",
      title: "T",
      playerPolity: "FRA",
      difficulty: "standard",
    });
    expect(created.difficulty).toBe("standard");

    const updated = manager.setDifficulty(created.gameId, "simulationist");
    expect(updated.difficulty).toBe("simulationist");
    expect(manager.gameMeta(created.gameId).difficulty).toBe("simulationist");

    // A second manager opens the save file fresh, so this reads SQLite, not
    // the first manager's in-memory OpenGame cache.
    const reopened = makeManager(dataDir);
    expect(reopened.gameMeta(created.gameId).difficulty).toBe("simulationist");
  });

  it("leaves the rest of the game meta untouched", () => {
    const created = manager.createGame({
      scenarioId: "test",
      title: "T",
      playerPolity: "FRA",
      difficulty: "sandbox",
    });
    const updated = manager.setDifficulty(created.gameId, "challenging");
    expect(updated).toEqual({ ...created, difficulty: "challenging" });
  });
});
