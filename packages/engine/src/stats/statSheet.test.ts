import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema } from "@pax/domain";
import { getOrBuildStatSheet } from "./statSheet.ts";
import { executeTurn } from "../turn/orchestrator.ts";
import { runExtraction } from "../facts/extract.ts";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;

const llm = new FakeLlmClient((req) => {
  if (req.taskLabel === "statSheet") {
    return {
      structured: {
        stability: 70,
        economy: 65,
        military: 55,
        diplomacy: 60,
        security: 52,
        economics: { gdp: 180, gdpUnit: "USD billions (1936)", growthPct: 2.1, inflationPct: 1.2 },
        assessment: "Solid but watchful.",
        highlights: ["Border tension with DEU"],
      },
    };
  }
  if (req.taskLabel === "extractFacts") {
    return {
      structured: {
        facts: [{ type: "war_started", attacker: "DEU", defender: "FRA", cause: "test" }],
      },
    };
  }
  return {
    structured: {
      stopDate: "1936-02-01",
      summary: "turn",
      events: [{ date: "1936-01-15", title: "Skirmish", impacts: {} }],
    },
  };
});
const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: () => {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-stats-"));
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
        regionOwnership: { r1: "FRA", r2: "FRA", r3: "DEU" },
        polities: {
          FRA: { code: "FRA", name: "France", reputation: 62 },
          DEU: { code: "DEU", name: "Germany" },
        },
        units: [
          { id: "u1", name: "1st", type: "infantry", ownerCode: "FRA", strength: 300, lng: 2, lat: 48 },
          { id: "u2", name: "2nd", type: "armor", ownerCode: "FRA", strength: 200, lng: 3, lat: 48 },
          { id: "u3", name: "W", type: "infantry", ownerCode: "DEU", strength: 400, lng: 8, lat: 50 },
        ],
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("stat sheets", () => {
  it("computes hard stats exactly and caches per (node, polity)", async () => {
    const before = llm.calls.length;
    const sheet = await getOrBuildStatSheet(deps(), { nodeId: rootId, polity: "FRA" });
    expect(sheet.hard).toMatchObject({
      regionsOwned: 2,
      unitCount: 2,
      totalStrength: 500,
      reputation: 62,
    });
    expect(sheet.stability).toBe(70);

    await getOrBuildStatSheet(deps(), { nodeId: rootId, polity: "FRA" });
    expect(llm.calls.length).toBe(before + 1); // cache hit, no second call
  });

  it("anchors the child sheet on the parent scores and this turn's facts", async () => {
    await getOrBuildStatSheet(deps(), { nodeId: rootId, polity: "FRA" });
    const node = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), node.id);
    await getOrBuildStatSheet(deps(), { nodeId: node.id, polity: "FRA" });

    const statCall = llm.calls.filter((call) => call.taskLabel === "statSheet").at(-1);
    const promptText = statCall?.messages[0]?.text ?? "";
    expect(promptText).toContain("Previous scores (last turn): stability 70");
    expect(promptText).toContain("security 52");
    expect(promptText).toContain("gdp 180 USD billions (1936)");
    expect(promptText).toContain("war_started DEU->FRA");
    expect(statCall?.system[0]?.text).toContain("adjust them only as far as this turn's facts justify");
  });
});
