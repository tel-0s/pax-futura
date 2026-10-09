import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, newId } from "@pax/domain";
import { executeTurn } from "../turn/orchestrator.ts";
import { compareSiblings } from "./compare.ts";
import { ConflictError } from "./tree.ts";
import type { NodeRow, SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;
/** Simulator payloads consumed in order, one per `simulateTurn` call. */
let simPlans: unknown[] = [];
let simCall = 0;
let narrativeMode: "ok" | "garbage" = "ok";

/** A valid but consequence-free turn: the default when a test sets no plan. */
const quietTurn = (stopDate: string) => ({
  stopDate,
  summary: `Quiet to ${stopDate}`,
  events: [
    {
      date: stopDate,
      title: "A routine month",
      description: "Nothing of consequence disturbed the chancelleries.",
      impacts: {},
    },
  ],
});

const llm = new FakeLlmClient((req) => {
  if (req.taskLabel === "reconcileImpacts") return { structured: { amendments: [] } };
  if (req.taskLabel === "compareBranches") {
    if (narrativeMode === "garbage") return { structured: { title: "", nonsense: true } };
    return {
      structured: {
        title: "The Rhine, Twice Told",
        narrative: "In A the bridges were taken; in B the diplomats got there first.",
        keyDifferences: ["A occupies the Rhineland", "B keeps Berlin's reputation intact"],
      },
    };
  }
  if (req.taskLabel === "simulateTurn") {
    return { structured: simPlans[simCall++] ?? quietTurn("1936-12-01") };
  }
  return { structured: {} };
});

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: () => {} });

const compareDeps = () => ({ store, llm, binding });

const narrativeCalls = (): number =>
  llm.calls.filter((call) => call.taskLabel === "compareBranches").length;

const versionA = {
  stopDate: "1936-02-01",
  summary: "Version A: the Rhine is crossed",
  events: [
    {
      date: "1936-01-20",
      title: "Rhineland occupied",
      description: "French columns cross the river and take the demilitarized zone outright.",
      impacts: {
        regionTransfers: [{ regionId: "DEU", toCode: "FRA" }],
        polityChanges: [{ code: "DEU", reputation: 35, tags: ["revanchist"] }],
        unitOps: [
          {
            op: "spawn",
            unit: { id: "u-a1", name: "1st Army", ownerCode: "FRA", strength: 120, lng: 6, lat: 50 },
          },
          { op: "strength", unitId: "u-garde", strength: 60 },
        ],
        markerOps: [
          {
            op: "build",
            marker: { id: "m-a", name: "Maginot Fort", kind: "fort", ownerCode: "FRA", lng: 5.5, lat: 49 },
          },
          { op: "remove", markerId: "m-old" },
        ],
      },
    },
  ],
};

const versionB = {
  stopDate: "1936-02-01",
  summary: "Version B: the talks hold",
  events: [
    {
      date: "1936-01-20",
      title: "Conference at Locarno",
      description: "The powers talk the crisis down and a breakaway republic is recognized.",
      impacts: {
        polityChanges: [
          { code: "DEU", reputation: 70 },
          { code: "NOUV", name: "Nouvelle République" },
        ],
        unitOps: [{ op: "move", unitId: "u-garde", toLng: 7.1, toLat: 49.5 }],
        markerOps: [
          {
            op: "build",
            marker: { id: "m-b", name: "Rhine Bunker", kind: "bunker", ownerCode: "DEU", lng: 7, lat: 50 },
          },
        ],
      },
    },
  ],
};

const turn = (parentId: string): Promise<NodeRow> =>
  executeTurn(deps(), { parentId, input: { actions: [], jumpDays: 30, stopPolicy: "toDate" } });

/** A complete, eventless child carrying the parent's world unchanged. */
const bareSibling = (parentId: string, summary: string): string => {
  const parent = store.getNode(parentId);
  if (!parent?.worldBlobHash) throw new Error("parent must be complete");
  const id = newId();
  store.transaction(() => {
    store.insertNode({
      id,
      parentId,
      depth: parent.depth + 1,
      status: "generating",
      gameDate: parent.gameDate,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    const worldBlobHash = store.putWorld(store.getWorld(parent.worldBlobHash!));
    store.completeNode({ id, gameDate: parent.gameDate, summary, worldBlobHash });
  });
  return id;
};

/** The two re-rolls every deterministic assertion below is written against. */
const rollSiblings = async (): Promise<[NodeRow, NodeRow]> => {
  simPlans = [versionA, versionB];
  simCall = 0;
  const a = await turn(rootId);
  const b = await turn(rootId);
  return [a, b];
};

beforeEach(() => {
  narrativeMode = "ok";
  simPlans = [];
  simCall = 0;
  llm.calls.length = 0;
  dir = mkdtempSync(join(tmpdir(), "pax-compare-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: ScenarioSchema.parse({
      id: "t",
      name: "T",
      startDate: "1936-01-01",
      world: {
        regionOwnership: { FRA: "FRA", DEU: "DEU" },
        polities: {
          FRA: { code: "FRA", name: "France" },
          DEU: { code: "DEU", name: "Germany" },
        },
        units: [
          { id: "u-garde", name: "Garde Républicaine", ownerCode: "FRA", strength: 100, lng: 2.3, lat: 48.8 },
        ],
        markers: [{ id: "m-old", name: "Old Citadel", kind: "fort", ownerCode: "FRA", lng: 4, lat: 45 }],
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sibling diff", () => {
  it("reports region, polity, unit and marker deltas between two re-rolls", async () => {
    const [a, b] = await rollSiblings();
    const report = await compareSiblings(compareDeps(), { aId: a.id, bId: b.id });

    expect(report.aNodeId).toBe(a.id);
    expect(report.bNodeId).toBe(b.id);
    expect(report.regionChanges).toEqual([
      { regionId: "DEU", regionName: expect.any(String), a: "FRA", b: "DEU" },
    ]);

    expect(report.polityDiffs).toContain("DEU reputation 35 -> 70");
    expect(report.polityDiffs).toContain("DEU tags [revanchist] -> [none]");
    expect(report.polityDiffs).toContain("NOUV (Nouvelle République) registered in B only");

    // Fresh spawn (id only in A) vs the inherited unit both branches touched.
    expect(report.unitDiffs).toContain("1st Army (FRA) raised in A only, strength 120");
    expect(report.unitDiffs).toContain("Garde Républicaine (FRA) strength 60 -> 100");
    expect(report.unitDiffs.some((line) => line.includes("positioned at 2.30, 48.80 in A"))).toBe(true);

    // Structures match by name: built one side only, or razed relative to the
    // shared parent world.
    expect(report.markerDiffs).toContain('fort "Maginot Fort" (FRA) built in A only');
    expect(report.markerDiffs).toContain('bunker "Rhine Bunker" (DEU) built in B only');
    expect(report.markerDiffs).toContain('fort "Old Citadel" (FRA) stands in B, razed in A');
  });

  it("orients every delta by argument order, so swapping A and B mirrors the report", async () => {
    const [a, b] = await rollSiblings();
    const report = await compareSiblings(compareDeps(), { aId: b.id, bId: a.id });

    expect(report.regionChanges).toEqual([
      { regionId: "DEU", regionName: expect.any(String), a: "DEU", b: "FRA" },
    ]);
    expect(report.polityDiffs).toContain("DEU reputation 70 -> 35");
    expect(report.polityDiffs).toContain("NOUV (Nouvelle République) registered in A only");
    expect(report.markerDiffs).toContain('fort "Maginot Fort" (FRA) built in B only');
  });

  it("refuses nodes that are not siblings", async () => {
    const [a] = await rollSiblings();
    const child = await turn(a.id);

    await expect(compareSiblings(compareDeps(), { aId: a.id, bId: child.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(compareSiblings(compareDeps(), { aId: a.id, bId: rootId })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("writes a point-of-divergence narrative from both event lists", async () => {
    const [a, b] = await rollSiblings();
    const report = await compareSiblings(compareDeps(), { aId: a.id, bId: b.id });

    expect(narrativeCalls()).toBe(1);
    expect(report.narrative).toMatchObject({
      title: "The Rhine, Twice Told",
      keyDifferences: ["A occupies the Rhineland", "B keeps Berlin's reputation intact"],
    });

    const prompt = llm.calls.find((call) => call.taskLabel === "compareBranches")?.messages[0]?.text ?? "";
    expect(prompt).toContain("Version A: the Rhine is crossed");
    expect(prompt).toContain("Version B: the talks hold");
    expect(prompt).toContain("Rhineland occupied");
    expect(prompt).toContain("Conference at Locarno");
    // The deterministic deltas are handed to the historian as evidence.
    expect(prompt).toContain("DEU reputation 35 -> 70");
  });

  it("returns a null narrative (never a failure) when the model answers with garbage", async () => {
    const [a, b] = await rollSiblings();
    narrativeMode = "garbage";
    const report = await compareSiblings(compareDeps(), { aId: a.id, bId: b.id });

    expect(narrativeCalls()).toBe(1);
    expect(report.narrative).toBeNull();
    // The deterministic half must survive the model's failure intact.
    expect(report.regionChanges).toHaveLength(1);
    expect(report.polityDiffs.length).toBeGreaterThan(0);
  });

  it("skips the model entirely when neither sibling recorded an event", async () => {
    // Eventless nodes can't come out of the simulator (a turn result needs at
    // least one event), so the store is driven directly for this edge.
    const a = bareSibling(rootId, "Silent A");
    const b = bareSibling(rootId, "Silent B");

    const report = await compareSiblings(compareDeps(), { aId: a, bId: b });

    expect(narrativeCalls()).toBe(0);
    expect(report).toMatchObject({
      regionChanges: [],
      polityDiffs: [],
      unitDiffs: [],
      markerDiffs: [],
      narrative: null,
    });
  });
});
