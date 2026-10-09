import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScenarioSchema, newId, type Scenario } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { openAppDb } from "../db/appDb.ts";
import { GameManager } from "../gameManager.ts";
import { mountPublishScenario } from "./publishScenario.ts";

const seed = ScenarioSchema.parse({
  id: "seed",
  name: "Seed",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { FRA: "FRA", "FRA.11_1": "FRA", DEU: "DEU" },
    polities: {
      FRA: { code: "FRA", name: "France", color: "#3d6fb4" },
      DEU: { code: "DEU", name: "Germany", color: "#8a7d5a" },
      // Landless by design: no territory, no units — still playable.
      SILVDAWN: { code: "SILVDAWN", name: "Order of the Silver Dawn" },
    },
    units: [
      { id: "u1", name: "1st Army", ownerCode: "DEU", lng: 13.4, lat: 52.5 },
    ],
    simulationRules: "Rail movement is limited to owned track.",
  },
});

let dataDir: string;
let scenariosDir: string;
let manager: GameManager;
let app: Hono;
let gameId: string;
let leafNodeId: string;

/** Ten complete turns past the root, with a stored era summary over the span. */
const buildTimeline = (game: ReturnType<GameManager["get"]>, rootId: string): string[] => {
  const worldHash = game.port.getNode(rootId)!.worldBlobHash!;
  const ids: string[] = [];
  let parentId = rootId;
  for (let depth = 1; depth <= 10; depth += 1) {
    const id = newId();
    game.port.insertNode({
      id,
      parentId,
      depth,
      status: "complete",
      gameDate: `19${36 + depth}-01-01`,
      input: { actions: [], jumpDays: 365, stopPolicy: "toDate" },
      summary: `Turn ${depth}`,
      worldBlobHash: worldHash,
    });
    ids.push(id);
    parentId = id;
  }
  game.port.putEraSummary({
    title: "The Long Rearmament",
    summary: "Europe rearmed under a brittle peace. Every chancellery drew up war plans.",
    openThreads: ["The Rhine question is unsettled", "Silver Dawn courts the general staff"],
    degraded: false,
    startNodeId: ids[0]!,
    endNodeId: ids[9]!,
    startDepth: 1,
    endDepth: 10,
    startDate: "1937-01-01",
    endDate: "1946-01-01",
  });
  return ids;
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pax-publish-"));
  scenariosDir = mkdtempSync(join(tmpdir(), "pax-publish-scen-"));
  manager = new GameManager(
    openAppDb(dataDir),
    dataDir,
    new Map([["seed", seed]]),
    new FakeLlmClient(() => ({ deltas: ["x"] })),
    { connectionId: "fake", model: "fake", contextWindow: 1000, maxOutput: 100 },
  );
  const meta = manager.createGame({
    scenarioId: "seed",
    title: "Republic Ascendant",
    playerPolity: "FRA",
    difficulty: "standard",
  });
  gameId = meta.gameId;
  const game = manager.get(gameId);
  leafNodeId = buildTimeline(game, meta.activeNodeId).at(-1)!;

  app = new Hono();
  mountPublishScenario(app, manager, scenariosDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scenariosDir, { recursive: true, force: true });
});

const publish = (body: unknown, query = "", nodeId = leafNodeId) =>
  app.request(`/api/games/${gameId}/nodes/${nodeId}/publish-scenario${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("branch -> scenario publishing", () => {
  it("writes a loadable pack carrying its inherited history", async () => {
    const res = await publish({ id: "republic-1946", name: "Republic 1946" });
    expect(res.status).toBe(201);
    const published = (await res.json()) as Scenario;

    const filePath = join(scenariosDir, "republic-1946.json");
    expect(existsSync(filePath)).toBe(true);
    const onDisk = ScenarioSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    expect(onDisk).toEqual(published);

    expect(onDisk.startDate).toBe("1946-01-01");
    // No description given: one is generated from the game title and date.
    expect(onDisk.description).toBe("The world of Republic Ascendant as of 1946-01-01");

    expect(onDisk.playablePolities.map((p) => p.code)).toEqual(["FRA", "DEU", "SILVDAWN"]);
    expect(onDisk.playablePolities.map((p) => p.name)).toEqual([
      "France",
      "Germany",
      "Order of the Silver Dawn",
    ]);

    expect(onDisk.world.simulationRules).toContain("Inherited history:");
    expect(onDisk.world.simulationRules).toContain("The Long Rearmament");
    expect(onDisk.world.simulationRules).toContain("Unresolved threads: The Rhine question");
    // Authored rules survive underneath the inherited block.
    expect(onDisk.world.simulationRules).toContain("Rail movement is limited");
    expect(onDisk.world.simulationRules.length).toBeLessThan(1500 + 200);
  });

  it("refuses to overwrite an existing pack", async () => {
    expect((await publish({ id: "taken", name: "First" })).status).toBe(201);
    const second = await publish({ id: "taken", name: "Second" });
    expect(second.status).toBe(409);
    expect(await second.text()).toContain("already exists");
    // The original pack is untouched.
    const onDisk = ScenarioSchema.parse(JSON.parse(readFileSync(join(scenariosDir, "taken.json"), "utf8")));
    expect(onDisk.name).toBe("First");
  });

  it("offers the pack as a download on publish and afterwards", async () => {
    const res = await publish({ id: "downloadable", name: "Pack" }, "?download=1");
    expect(res.status).toBe(201);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="downloadable.json"');

    const again = await app.request(
      `/api/games/${gameId}/nodes/${leafNodeId}/publish-scenario?id=downloadable&download=1`,
    );
    expect(again.status).toBe(200);
    expect(again.headers.get("content-disposition")).toBe('attachment; filename="downloadable.json"');
    expect(ScenarioSchema.parse(JSON.parse(await again.text())).id).toBe("downloadable");

    expect((await app.request(`/api/games/${gameId}/nodes/${leafNodeId}/publish-scenario?id=ghost`)).status).toBe(404);
  });

  it("omits inherited history on request and refuses unpublishable nodes", async () => {
    const bare = await publish({
      id: "bare-world",
      name: "Bare",
      description: "Just the map.",
      includeChronicle: false,
    });
    expect(bare.status).toBe(201);
    const scenario = (await bare.json()) as Scenario;
    expect(scenario.description).toBe("Just the map.");
    expect(scenario.world.simulationRules).toBe("Rail movement is limited to owned track.");

    const game = manager.get(gameId);
    const pending = newId();
    game.port.insertNode({
      id: pending,
      parentId: leafNodeId,
      depth: 11,
      status: "generating",
      gameDate: "1947-01-01",
      input: { actions: [], jumpDays: 365, stopPolicy: "toDate" },
    });
    const res = await publish({ id: "half-baked", name: "Half" }, "", pending);
    expect(res.status).toBe(409);
    expect(existsSync(join(scenariosDir, "half-baked.json"))).toBe(false);

    expect((await publish({ id: "no-such-node", name: "X" }, "", "missing")).status).toBe(404);
    expect((await publish({ id: "Bad Id", name: "X" })).status).toBe(400);
  });
});
