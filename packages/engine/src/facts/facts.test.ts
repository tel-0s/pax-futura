import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, emptyRollup, type Fact, type SseEvent } from "@pax/domain";
import { foldRollup } from "./rollup.ts";
import { runExtraction } from "./extract.ts";
import { executeTurn } from "../turn/orchestrator.ts";
import type { SavePort } from "../ports.ts";

describe("foldRollup", () => {
  const fold = (facts: Fact[]) => foldRollup(emptyRollup(), facts, 1);

  it("tracks wars symmetrically and ends them", () => {
    const atWar = fold([{ type: "war_started", attacker: "DEU", defender: "FRA", cause: "border" }]);
    expect(atWar.nations.DEU?.atWarWith).toEqual(["FRA"]);
    expect(atWar.nations.FRA?.atWarWith).toEqual(["DEU"]);

    const peace = foldRollup(atWar, [{ type: "war_ended", parties: ["DEU", "FRA"], outcome: "ceasefire" }], 2);
    expect(peace.nations.DEU?.atWarWith).toEqual([]);
  });

  it("accumulates and clamps relationship scores under one pair key", () => {
    const first = fold([{ type: "relationship_shift", pair: ["FRA", "DEU"], delta: -3, reason: "a" }]);
    const second = foldRollup(
      first,
      Array.from({ length: 5 }, () => ({
        type: "relationship_shift" as const,
        pair: ["DEU", "FRA"] as [string, string],
        delta: -3 as const,
        reason: "b",
      })),
      2,
    );
    expect(Object.keys(second.relations)).toEqual(["DEU|FRA"]);
    expect(second.relations["DEU|FRA"]?.score).toBe(-10);
  });

  it("opens, updates, and resolves arcs; commitments clear on fulfillment", () => {
    const opened = fold([
      { type: "arc_update", arcId: "a1", title: "Border crisis", status: "opened", note: "" },
      { type: "commitment", from: "GBR", to: "FRA", what: "naval support", status: "made" },
    ]);
    expect(opened.openArcs).toHaveLength(1);
    expect(opened.openCommitments).toHaveLength(1);

    const closed = foldRollup(
      opened,
      [
        { type: "arc_update", arcId: "a1", title: "Border crisis", status: "resolved", note: "" },
        { type: "commitment", from: "GBR", to: "FRA", what: "naval support", status: "fulfilled" },
      ],
      2,
    );
    expect(closed.openArcs).toHaveLength(0);
    expect(closed.openCommitments).toHaveLength(0);
  });
});

describe("runExtraction end-to-end", () => {
  let dir: string;
  let store: SavePort;
  let rootId: string;
  const events: SseEvent[] = [];

  const llm = new FakeLlmClient((req) => {
    if (req.taskLabel === "extractFacts") {
      return {
        structured: {
          facts: [
            { type: "war_started", attacker: "DEU", defender: "FRA", cause: "test" },
            // Model tries to sneak in a derived type — must be filtered.
            { type: "territory_change", regionId: "x", regionName: "", from: "", to: "DEU" },
            { type: "arc_update", arcId: "", title: "New crisis", status: "opened", note: "" },
          ],
        },
      };
    }
    return {
      structured: {
        stopDate: "1936-02-01",
        summary: "turn",
        events: [
          {
            date: "1936-01-15",
            title: "Skirmish",
            impacts: { regionTransfers: [{ regionId: "r1", toCode: "DEU" }] },
          },
        ],
      },
    };
  });
  const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
  const deps = () => ({ store, llm, binding, emit: (e: SseEvent) => events.push(e) });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pax-facts-"));
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
          regionOwnership: { r1: "FRA" },
          polities: { FRA: { code: "FRA", name: "France" }, DEU: { code: "DEU", name: "Germany" } },
        },
      }).world,
    });
    store = makeSavePort(created.db);
    rootId = created.rootNodeId;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("derives + extracts facts, folds the rollup, feeds the next prompt", async () => {
    const node = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), node.id);

    const facts = store.listFactsForNode(node.id);
    // 1 derived territory_change + 2 extracted (sneaky derived type filtered out)
    expect(facts.filter((f) => f.type === "territory_change")).toHaveLength(1);
    expect(facts.filter((f) => f.type === "war_started")).toHaveLength(1);
    expect(facts.filter((f) => f.type === "arc_update")).toHaveLength(1);
    const arc = facts.find((f) => f.type === "arc_update");
    expect(arc?.type === "arc_update" && arc.arcId).toBeTruthy(); // "" was assigned an id

    const rollup = store.getRollup(node.id);
    expect(rollup?.nations.DEU?.atWarWith).toEqual(["FRA"]);
    expect(rollup?.openArcs[0]?.title).toBe("New crisis");
    expect(store.getNode(node.id)?.extractionStatus).toBe("done");
    expect(events.some((e) => e.type === "facts.updated")).toBe(true);

    // A second turn's prompt now carries the standing facts.
    await executeTurn(deps(), {
      parentId: node.id,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    const turnCalls = llm.calls.filter((call) => call.taskLabel === "simulateTurn");
    expect(turnCalls.at(-1)?.messages[0]?.text).toContain("STANDING FACTS");
    expect(turnCalls.at(-1)?.messages[0]?.text).toContain("at war with FRA");
  });

  it("sibling regenerations fold from the same parent rollup independently", async () => {
    const first = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), first.id);
    const second = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), second.id);

    // Identical apart from the freshly-minted arc ids.
    const normalize = (rollup: ReturnType<SavePort["getRollup"]>) => ({
      ...rollup,
      openArcs: rollup?.openArcs.map(({ arcId: _arcId, ...rest }) => rest),
    });
    expect(normalize(store.getRollup(first.id))).toEqual(normalize(store.getRollup(second.id)));
    expect(store.getRollup(rootId)).toBeNull(); // parent untouched
  });
});
