import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { ScenarioSchema, emptyImpacts } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { proposeMapReassessment } from "./reassess.ts";
import { applyGmEdit } from "./gmEdit.ts";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-reassess-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1500-01-01",
    world: ScenarioSchema.parse({
      id: "t",
      name: "T",
      startDate: "1500-01-01",
      world: { polities: { FRA: { code: "FRA", name: "France" } } },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 4000 };

const seedHistory = () =>
  applyGmEdit(
    { store, emit: () => {} },
    {
      parentId: rootId,
      input: {
        gm: true,
        note: "Expedition sails west",
        impacts: emptyImpacts(),
      },
    },
  );

describe("proposeMapReassessment", () => {
  it("sanitizes the proposal: keeps valid ops, explains refusals", async () => {
    const node = seedHistory();
    const llm = new FakeLlmClient(() => ({
      structured: {
        notes: ["Fort Espoir was founded turn 3", "The coast was claimed"],
        changes: {
          regionTransfers: [
            { regionId: "USA", toCode: "FRA" },
            { regionId: "ATLANTIS", toCode: "FRA" },
          ],
          markerOps: [{ op: "build", marker: { name: "Fort Espoir", kind: "outpost", ownerCode: "FRA", lng: -70, lat: 45 } }],
          unitOps: [{ op: "remove", unitId: "ghost-unit" }],
        },
      },
    }));

    const proposal = await proposeMapReassessment({ store, llm, binding }, { nodeId: node.id });
    expect(proposal.impacts.regionTransfers.map((t) => t.regionId)).toEqual(["USA"]);
    expect(proposal.impacts.markerOps).toHaveLength(1);
    expect(proposal.impacts.unitOps).toHaveLength(0);
    expect(proposal.notes).toHaveLength(2);
    expect(proposal.dropped.join(" ")).toMatch(/ATLANTIS/);
    expect(proposal.dropped.join(" ")).toMatch(/ghost-unit/);
  });

  it("refuses duplicates of structures that already exist", async () => {
    const node = applyGmEdit(
      { store, emit: () => {} },
      {
        parentId: rootId,
        input: {
          gm: true,
          note: "existing fort",
          impacts: {
            ...emptyImpacts(),
            markerOps: [{ op: "build", marker: { name: "Fort Espoir", kind: "outpost", ownerCode: "FRA", lng: -70, lat: 45, note: "", foundedAt: "" } }],
          },
        },
      },
    );
    const llm = new FakeLlmClient(() => ({
      structured: {
        notes: [],
        changes: {
          markerOps: [{ op: "build", marker: { name: "fort espoir", kind: "outpost", ownerCode: "FRA", lng: -70, lat: 45 } }],
        },
      },
    }));
    const proposal = await proposeMapReassessment({ store, llm, binding }, { nodeId: node.id });
    expect(proposal.impacts.markerOps).toHaveLength(0);
    expect(proposal.dropped.join(" ")).toMatch(/already exists/i);
  });

  it("reports gracefully when there is no history to audit", async () => {
    const llm = new FakeLlmClient(() => ({ structured: { notes: [], changes: {} } }));
    const proposal = await proposeMapReassessment({ store, llm, binding }, { nodeId: rootId });
    expect(proposal.impacts).toEqual(emptyImpacts());
    expect(proposal.dropped[0]).toMatch(/no narrated history/i);
    expect(llm.calls).toHaveLength(0); // never calls the model without events
  });
});
