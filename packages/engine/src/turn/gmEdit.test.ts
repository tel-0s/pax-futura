import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { ScenarioSchema, emptyImpacts } from "@pax/domain";
import { applyGmEdit } from "./gmEdit.ts";
import { regenerateNode } from "./orchestrator.ts";
import { openConversation } from "../conversations/chat.ts";
import { ConflictError } from "../loom/tree.ts";
import { FakeLlmClient } from "@pax/providers";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-gm-"));
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
        regionOwnership: { FRA: "FRA" },
        polities: { FRA: { code: "FRA", name: "France" } },
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("applyGmEdit", () => {
  it("creates a complete same-date child applying the impacts verbatim", () => {
    openConversation(store, { nodeId: rootId, kind: "advisor" });

    const node = applyGmEdit(
      { store, emit: () => {} },
      {
        parentId: rootId,
        input: {
          gm: true,
          note: "New World claim",
          impacts: {
            ...emptyImpacts(),
            regionTransfers: [
              { regionId: "USA", regionName: "United States", fromCode: "", toCode: "FRA", note: "" },
            ],
          },
        },
      },
    );

    expect(node.status).toBe("complete");
    expect(node.parentId).toBe(rootId);
    expect(node.gameDate).toBe("1936-01-01"); // no time advance
    expect(node.summary).toBe("GM: New World claim");
    expect(store.getGame().activeNodeId).toBe(node.id);

    const world = store.getWorld(node.worldBlobHash!);
    expect(world.regionOwnership.USA).toBe("FRA");

    // The edit is a normal loom node: conversation heads propagate.
    expect(store.conversationsAtNode(node.id)).toHaveLength(1);
  });

  it("clears ownership on null toCode and refuses regeneration", async () => {
    const node = applyGmEdit(
      { store, emit: () => {} },
      {
        parentId: rootId,
        input: {
          gm: true,
          note: "",
          impacts: {
            ...emptyImpacts(),
            regionTransfers: [{ regionId: "FRA", regionName: "", fromCode: "FRA", toCode: null, note: "" }],
          },
        },
      },
    );
    expect(store.getWorld(node.worldBlobHash!).regionOwnership).toEqual({});

    const llm = new FakeLlmClient(() => ({ structured: {} }));
    const binding = { connectionId: "fake", model: "fake", contextWindow: 1000, maxOutput: 100 };
    await expect(
      regenerateNode({ store, llm, binding, emit: () => {} }, { nodeId: node.id }),
    ).rejects.toThrow(ConflictError);
  });
});
