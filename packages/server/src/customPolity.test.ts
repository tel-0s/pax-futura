import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScenarioSchema } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { openAppDb } from "./db/appDb.ts";
import { GameManager } from "./gameManager.ts";

const scenario = ScenarioSchema.parse({
  id: "test",
  name: "Test",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { r1: "FRA" },
    polities: {
      FRA: { code: "FRA", name: "France", color: "#3d6fb4", tags: ["democratic"], note: "The Republic." },
    },
  },
});

let dataDir: string;
let manager: GameManager;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pax-custom-"));
  manager = new GameManager(
    openAppDb(dataDir),
    dataDir,
    new Map([["test", scenario]]),
    new FakeLlmClient(() => ({ deltas: ["x"] })),
    { connectionId: "fake", model: "fake", contextWindow: 1000, maxOutput: 100 },
  );
});

afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe("custom polity creation", () => {
  it("basing on a nation replaces its identity but keeps its map presence", () => {
    const meta = manager.createGame({
      scenarioId: "test",
      title: "T",
      playerPolity: "custom",
      difficulty: "standard",
      customPolity: {
        name: "Nouvelle Commune",
        baseCode: "FRA",
        color: "#cc2244",
        flag: "🔥",
        tags: ["revolutionary"],
        note: "A syndicalist uprising has seized the state.",
      },
    });
    const game = manager.get(meta.gameId);
    expect(meta.playerPolity).toBe("FRA"); // code (and map paint) preserved
    const root = game.port.getNode(meta.activeNodeId)!;
    const world = game.port.getWorld(root.worldBlobHash!);
    const polity = world.polities.FRA!;
    expect(polity.name).toBe("Nouvelle Commune");
    expect(polity.flag).toBe("🔥");
    expect(polity.tags).toEqual(["revolutionary"]);
    expect(polity.aliases).toContain("France"); // succession is legible to the sim
    expect(polity.note).toContain("syndicalist");
    expect(world.regionOwnership.r1).toBe("FRA");
  });

  it("landless organizations get a fresh code and no territory", () => {
    const meta = manager.createGame({
      scenarioId: "test",
      title: "T",
      playerPolity: "custom",
      difficulty: "standard",
      customPolity: {
        name: "Order of the Silver Dawn",
        code: "SILVDAWN",
        color: "",
        flag: "✦",
        tags: ["secretive"],
        note: "A transnational order.",
      },
    });
    const game = manager.get(meta.gameId);
    expect(meta.playerPolity).toBe("SILVDAWN");
    const root = game.port.getNode(meta.activeNodeId)!;
    const world = game.port.getWorld(root.worldBlobHash!);
    expect(world.polities.SILVDAWN?.name).toBe("Order of the Silver Dawn");
    expect(world.polities.FRA?.name).toBe("France"); // untouched
    expect(Object.values(world.regionOwnership)).not.toContain("SILVDAWN");
  });

  it("rejects duplicate codes and unknown bases", () => {
    const base = { name: "X", color: "", flag: "", tags: [], note: "" };
    expect(() =>
      manager.createGame({
        scenarioId: "test",
        title: "T",
        playerPolity: "custom",
        difficulty: "standard",
        customPolity: { ...base, code: "FRA" },
      }),
    ).toThrow(/already exists/);
    expect(() =>
      manager.createGame({
        scenarioId: "test",
        title: "T",
        playerPolity: "custom",
        difficulty: "standard",
        customPolity: { ...base, baseCode: "XYZ" },
      }),
    ).toThrow(/Unknown base/);
  });
});
