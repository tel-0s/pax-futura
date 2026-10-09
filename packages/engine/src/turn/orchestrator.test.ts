import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { addPendingAction } from "../../../server/src/db/stores/actions.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { executeTurn, TurnFailedError } from "./orchestrator.ts";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let db: ReturnType<typeof createSaveDb>["db"];
let rootId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-orch-"));
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
      world: { polities: { FRA: { code: "FRA", name: "France" } } },
    }).world,
  });
  store = makeSavePort(created.db);
  db = created.db;
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 100 };

const goodTurn = {
  stopDate: "1936-02-01",
  summary: "a full turn",
  events: [
    { date: "1936-01-15", title: "Substantive event", description: "Something happened at length.", impacts: {} },
  ],
};

/** The truncation shape in the wild: a salvaged prefix — one bare headline. */
const clippedTurn = {
  stopDate: "1936-02-01",
  summary: "clip",
  events: [{ date: "1936-01-15", title: "Clipped headline", impacts: {} }],
};

/** A simulator that always returns a clean turn (plus the reconcile no-op). */
const goodLlm = () =>
  new FakeLlmClient((req) =>
    req.taskLabel === "reconcileImpacts" ? { structured: { amendments: [] } } : { structured: goodTurn },
  );

const queueOrder = (nodeId: string, title: string) =>
  addPendingAction(db, nodeId, {
    kind: "action",
    title,
    text: "",
    rawInput: title,
    invitees: [],
    source: "player",
  });

describe("executeTurn ghost turns", () => {
  it("persists a scouted turn without moving the checkout or eating the order queue", async () => {
    queueOrder(rootId, "Scout the frontier");
    const emitted: SseEvent[] = [];

    const node = await executeTurn(
      { store, llm: goodLlm(), binding, emit: (event) => emitted.push(event) },
      {
        parentId: rootId,
        input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
        commit: false,
      },
    );

    // The node is real and fully persisted — only the commit is withheld.
    expect(node.status).toBe("complete");
    expect(node.worldBlobHash).not.toBeNull();
    expect(store.getNodeMeta(node.id)?.summary).toBe("a full turn");

    expect(store.getGame().activeNodeId).toBe(rootId); // checkout stayed put
    expect(store.getNode(rootId)?.preferredChildId).toBeNull(); // path unchanged
    expect(store.listPendingActions(rootId)).toHaveLength(1); // queue survives a discard

    // No commit events: the client must not repaint or move on a scout.
    expect(emitted.some((event) => event.type === "world.changed")).toBe(false);
    expect(emitted.some((event) => event.type === "game.meta")).toBe(false);
    // …but the node still streams in like any other, so the ghost is visible.
    expect(
      emitted.some((event) => event.type === "node.updated" && event.node.id === node.id),
    ).toBe(true);
  });

  it("commits by default: checkout moves, preferred path updates, queue clears", async () => {
    queueOrder(rootId, "Mobilise");
    const emitted: SseEvent[] = [];

    const node = await executeTurn(
      { store, llm: goodLlm(), binding, emit: (event) => emitted.push(event) },
      { parentId: rootId, input: { actions: [], jumpDays: 30, stopPolicy: "toDate" } },
    );

    expect(store.getGame().activeNodeId).toBe(node.id);
    expect(store.getNode(rootId)?.preferredChildId).toBe(node.id);
    expect(store.listPendingActions(rootId)).toHaveLength(0);
    expect(emitted.some((event) => event.type === "world.changed")).toBe(true);
    expect(emitted.some((event) => event.type === "game.meta")).toBe(true);
  });
});

describe("executeTurn truncation handling", () => {
  it("rejects a max_tokens result even when its salvaged JSON parses, then accepts the retry", async () => {
    let simCalls = 0;
    const llm = new FakeLlmClient((req) => {
      if (req.taskLabel === "reconcileImpacts") return { structured: { amendments: [] } };
      simCalls += 1;
      return simCalls === 1
        ? { structured: clippedTurn, stopReason: "max_tokens" as const }
        : { structured: goodTurn };
    });

    const node = await executeTurn(
      { store, llm, binding, emit: () => {} },
      { parentId: rootId, input: { actions: [], jumpDays: 30, stopPolicy: "toDate" } },
    );

    expect(simCalls).toBe(2); // truncated attempt forced the corrective retry
    expect(node.status).toBe("complete");
    expect(node.summary).toBe("a full turn"); // never the clipped prefix
  });

  it("fails with actionable guidance when both attempts truncate", async () => {
    const llm = new FakeLlmClient((req) => {
      if (req.taskLabel === "reconcileImpacts") return { structured: { amendments: [] } };
      return { structured: clippedTurn, stopReason: "max_tokens" as const };
    });

    await expect(
      executeTurn(
        { store, llm, binding, emit: () => {} },
        { parentId: rootId, input: { actions: [], jumpDays: 30, stopPolicy: "toDate" } },
      ),
    ).rejects.toThrow(TurnFailedError);

    const failed = store
      .listNodeMetas()
      .find((meta) => meta.status === "failed");
    expect(failed).toBeDefined(); // retryable failed node, not a silent stump
  });
});
