import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema } from "@pax/domain";
import { executeTurn } from "../turn/orchestrator.ts";
import { buildTurnRequest } from "../prompts/assemble.ts";
import { runExtraction } from "./extract.ts";
import type { NodeRow, SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;
/** Flipped per-test to exercise the deterministic fallback path. */
let eraMode: "ok" | "garbage" = "ok";

/** Fixed day-of-month keeps this overflow-free. */
const addMonth = (date: string): string => {
  const [year = 1936, month = 1, day = 1] = date.split("-").map(Number);
  const shifted = month + 1;
  return [
    year + Math.floor((shifted - 1) / 12),
    String(((shifted - 1) % 12) + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
};

const llm = new FakeLlmClient((req) => {
  if (req.taskLabel === "summarizeEra") {
    if (eraMode === "garbage") return { structured: { nonsense: true } };
    return {
      structured: {
        title: "The Rhineland Decade",
        summary: "Ten turns of brinkmanship along the frontier.",
        openThreads: ["Rhineland standoff unresolved"],
      },
    };
  }
  if (req.taskLabel === "extractFacts") {
    return {
      structured: {
        facts: [
          { type: "arc_update", arcId: "arc-rhine", title: "Rhineland standoff", status: "escalated", note: "n" },
          { type: "notable_event", headline: "Border incident", polities: ["FRA", "DEU"] },
        ],
      },
    };
  }
  // The simulator: advance one month from whatever date the prompt states.
  const current = /Current date: (\d{4}-\d{2}-\d{2})/.exec(req.messages[0]?.text ?? "")?.[1] ?? "1936-01-01";
  const stopDate = addMonth(current);
  return {
    structured: {
      stopDate,
      summary: `Turn ending ${stopDate}`,
      events: [{ date: stopDate, title: `Manoeuvres of ${stopDate}`, impacts: {} }],
    },
  };
});

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: () => {} });

const eraCalls = (): number => llm.calls.filter((call) => call.taskLabel === "summarizeEra").length;

const eraPrompts = (): string[] =>
  llm.calls.filter((call) => call.taskLabel === "summarizeEra").map((call) => call.messages[0]?.text ?? "");

/** Drive `count` turns from `parentId`, optionally running the extraction job. */
const driveTurns = async (
  count: number,
  parentId: string,
  options: { extract: boolean } = { extract: true },
): Promise<NodeRow[]> => {
  const nodes: NodeRow[] = [];
  let cursor = parentId;
  for (let index = 0; index < count; index += 1) {
    const node = await executeTurn(deps(), {
      parentId: cursor,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    if (options.extract) await runExtraction(deps(), node.id);
    nodes.push(node);
    cursor = node.id;
  }
  return nodes;
};

beforeEach(() => {
  eraMode = "ok";
  llm.calls.length = 0;
  dir = mkdtempSync(join(tmpdir(), "pax-eras-"));
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
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("era summaries", () => {
  it("summarizes the first complete era at turn 10 and caches it", async () => {
    const nodes = await driveTurns(10, rootId);
    expect(eraCalls()).toBe(1);

    const era = store.getEraSummary(nodes[0]!.id, nodes[9]!.id);
    expect(era).not.toBeNull();
    expect(era).toMatchObject({
      title: "The Rhineland Decade",
      startNodeId: nodes[0]!.id,
      endNodeId: nodes[9]!.id,
      startDepth: 1,
      endDepth: 10,
      startDate: "1936-02-01",
      endDate: "1936-11-01",
    });
    expect(era!.openThreads.length).toBeGreaterThan(0);

    // (b) re-running extraction on the same node must not re-summarize.
    await runExtraction(deps(), nodes[9]!.id);
    expect(eraCalls()).toBe(1);
  });

  it("backfills every complete era oldest-first on a save with no summaries", async () => {
    const nodes = await driveTurns(20, rootId, { extract: false });
    expect(eraCalls()).toBe(0);

    await runExtraction(deps(), nodes[19]!.id);

    expect(eraCalls()).toBe(2);
    const prompts = eraPrompts();
    expect(prompts[0]).toContain("turns 1–10");
    expect(prompts[0]).toContain("(first era — no prior chronicle)");
    // Oldest-first means the second era gets the first one as chain context.
    expect(prompts[1]).toContain("turns 11–20");
    expect(prompts[1]).toContain('Previous era "The Rhineland Decade"');

    expect(store.getEraSummary(nodes[0]!.id, nodes[9]!.id)).not.toBeNull();
    expect(store.getEraSummary(nodes[10]!.id, nodes[19]!.id)).toMatchObject({
      startDepth: 11,
      endDepth: 20,
    });
  });

  it("renders chronicled eras in the turn prompt and drops their digest lines", async () => {
    // 17 turns: the recent window holds 6, so depths 0-11 are older history —
    // era 1 (depths 1-10) is fully outside it, depth 11 is not.
    const nodes = await driveTurns(17, rootId);
    const parent = nodes[16]!;
    const text =
      buildTurnRequest({
        store,
        game: store.getGame(),
        parent,
        world: store.getWorld(parent.worldBlobHash!),
        input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
      }).messages[0]?.text ?? "";

    expect(text).toContain("## ERA CHRONICLE (older history)");
    expect(text).toContain("### The Rhineland Decade (1936-02-01 → 1936-11-01)");
    expect(text).toContain("- Rhineland standoff unresolved");

    // Chronicled turns leave the digest tier; the uncovered older turn stays.
    expect(text).toContain("## EARLIER HISTORY");
    expect(text).toContain("- T11 (");
    for (const depth of [1, 5, 10]) {
      expect(text).not.toContain(`- T${depth} (`);
    }
  });

  it("stores a deterministic fallback when the model returns garbage", async () => {
    eraMode = "garbage";
    const nodes = await driveTurns(10, rootId);

    const era = store.getEraSummary(nodes[0]!.id, nodes[9]!.id);
    expect(era).toMatchObject({ title: "Turns 1–10", startDepth: 1, endDepth: 10 });
    expect(era!.summary.length).toBeGreaterThan(0);
    // A failed era must not fail the extraction job that hosts it.
    expect(store.getNode(nodes[9]!.id)?.extractionStatus).toBe("done");
  });
});
