import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Engine tests exercise the real stores through the server's SavePort adapter;
// the dev-only import is confined to tests (dependency direction holds in src).
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { executeTurn, TurnFailedError } from "./orchestrator.ts";
import type { SavePort } from "../ports.ts";

const scenario = ScenarioSchema.parse({
  id: "t",
  name: "T",
  startDate: "1936-01-01",
  world: { polities: { FRA: { code: "FRA", name: "France" } } },
});

let dir: string;
let store: SavePort;
let rootId: string;
let events: SseEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-repair-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: scenario.world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
  events = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const goodTurn = {
  stopDate: "1936-02-01",
  summary: "Corrected turn",
  events: [{ date: "1936-01-20", title: "Fixed event", impacts: {} }],
};

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const input = { actions: [], jumpDays: 30, stopPolicy: "toDate" as const };

describe("2-attempt repair", () => {
  it("recovers when attempt 1 is malformed and attempt 2 is valid", async () => {
    const llm = new FakeLlmClient((_req, index) =>
      index === 0 ? { structuredError: "bad JSON" } : { structured: goodTurn },
    );
    const node = await executeTurn(
      { store, llm, binding, emit: (e) => events.push(e) },
      { parentId: rootId, input },
    );
    expect(node.status).toBe("complete");
    expect(node.summary).toBe("Corrected turn");
    expect(llm.calls).toHaveLength(2);
    // The corrective message carried the validation problems.
    expect(llm.calls[1]?.messages.at(-1)?.text).toMatch(/failed validation/);
    expect(events.some((e) => e.type === "turn.progress" && e.phase === "repairing")).toBe(true);
  });

  it("repairs semantic failures (non-advancing date) the same way", async () => {
    const llm = new FakeLlmClient((_req, index) =>
      index === 0
        ? { structured: { ...goodTurn, stopDate: "1935-01-01" } }
        : { structured: goodTurn },
    );
    const node = await executeTurn(
      { store, llm, binding, emit: (e) => events.push(e) },
      { parentId: rootId, input },
    );
    expect(node.gameDate).toBe("1936-02-01");
    expect(llm.calls).toHaveLength(2);
  });

  it("fails the node (retryable) when both attempts are malformed", async () => {
    const llm = new FakeLlmClient(() => ({ structuredError: "hopeless" }));
    await expect(
      executeTurn({ store, llm, binding, emit: (e) => events.push(e) }, { parentId: rootId, input }),
    ).rejects.toThrow(TurnFailedError);
    const failed = store.listNodeMetas().find((meta) => meta.status === "failed");
    expect(failed).toBeDefined();
  });

  it("surfaces refusals with a clear message", async () => {
    const llm = new FakeLlmClient(() => ({ stopReason: "refusal" as const }));
    await expect(
      executeTurn({ store, llm, binding, emit: (e) => events.push(e) }, { parentId: rootId, input }),
    ).rejects.toThrow(/declined/);
  });
});
