import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, emptyRollup, type PsycheSheet, type SseEvent } from "@pax/domain";
import { runExtraction } from "./extract.ts";
import { executeTurn } from "../turn/orchestrator.ts";
import { buildTurnRequest } from "../prompts/assemble.ts";
import { openConversation, sendChatMessage } from "../conversations/chat.ts";
import type { NodeRow, SavePort } from "../ports.ts";

const scenario = ScenarioSchema.parse({
  id: "t",
  name: "T",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { r1: "FRA" },
    polities: {
      FRA: { code: "FRA", name: "France" },
      DEU: { code: "DEU", name: "Germany" },
      GBR: { code: "GBR", name: "Britain" },
      ITA: { code: "ITA", name: "Italy" },
    },
  },
});

const sheet = (overrides: Partial<PsycheSheet> = {}): PsycheSheet => ({
  temperament: "cautious, legalistic",
  ambitions: ["restore the Rhine frontier"],
  grudges: [],
  opinionOfPlayer: 0,
  opinionReason: "",
  ...overrides,
});

/** What the fake simulator emits — swapped per test to steer involvement. */
let turnEvents: unknown[] = [];
/** What the fake extractor returns as this turn's semantic facts. */
let extractedFacts: unknown[] = [];
/** What the fake psyche pass returns; `"throw"` exercises the failure path. */
let psycheResponse: unknown | "throw" = { updates: [] };

let dir: string;
let store: SavePort;
let rootId: string;
let events: SseEvent[] = [];

const llm = new FakeLlmClient((req) => {
  if (req.taskLabel === "updatePsyches") {
    if (psycheResponse === "throw") throw new Error("model exploded");
    return { structured: psycheResponse };
  }
  if (req.taskLabel === "extractFacts") return { structured: { facts: extractedFacts } };
  if (req.taskLabel === "summarizeEra") {
    return { structured: { title: "Era", summary: "s", openThreads: [] } };
  }
  if (!req.tool) return { deltas: ["Reply."] };
  return { structured: { stopDate: "1936-02-01", summary: "turn", events: turnEvents } };
});

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: (event: SseEvent) => events.push(event) });

const psycheCalls = () => llm.calls.filter((call) => call.taskLabel === "updatePsyches");

const runTurn = async (): Promise<NodeRow> => {
  const node = await executeTurn(deps(), {
    parentId: rootId,
    input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
  });
  await runExtraction(deps(), node.id);
  return node;
};

beforeEach(() => {
  llm.calls.length = 0;
  events = [];
  turnEvents = [{ date: "1936-01-15", title: "Quiet manoeuvres", impacts: {} }];
  extractedFacts = [];
  psycheResponse = { updates: [] };
  dir = mkdtempSync(join(tmpdir(), "pax-psyche-"));
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
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("leader psyches", () => {
  it("skips the model entirely when no foreign nation is involved", async () => {
    store.setRollup(rootId, { ...emptyRollup(), psyches: { DEU: sheet() } });
    // Only the player appears: a domestic economic shift on FRA soil.
    extractedFacts = [{ type: "economic_shift", polity: "FRA", direction: "growth", driver: "rearmament" }];
    turnEvents = [
      {
        date: "1936-01-15",
        title: "Factory orders",
        impacts: { polityChanges: [{ code: "FRA", note: "rearming" }] },
      },
    ];

    const node = await runTurn();

    expect(psycheCalls()).toHaveLength(0);
    expect(store.getRollup(node.id)?.psyches).toEqual({ DEU: sheet() });
  });

  it("merges updates over the parent, dropping unknown codes and invalid sheets", async () => {
    store.setRollup(rootId, {
      ...emptyRollup(),
      psyches: { DEU: sheet(), ITA: sheet({ temperament: "opportunistic" }) },
    });
    extractedFacts = [{ type: "war_started", attacker: "DEU", defender: "GBR", cause: "border" }];
    psycheResponse = {
      updates: [
        {
          code: "DEU",
          sheet: {
            temperament: "belligerent, aggrieved",
            // Over the schema's bound: clamped to three rather than lost.
            ambitions: ["a", "b", "c", "d", "e"],
            grudges: ["FRA blocked the customs union (1936-01)"],
            opinionOfPlayer: -2,
            opinionReason: "France sided with Britain",
          },
        },
        // Not in the world's catalog — never enters the world's memory.
        { code: "ZZZ", sheet: { temperament: "invented" } },
        // Out-of-range opinion: this entry alone is dropped.
        { code: "GBR", sheet: { temperament: "resolute", opinionOfPlayer: 99 } },
      ],
    };

    const node = await runTurn();

    expect(psycheCalls()).toHaveLength(1);
    const psyches = store.getRollup(node.id)?.psyches ?? {};
    expect(Object.keys(psyches).sort()).toEqual(["DEU", "ITA"]);
    expect(psyches.DEU).toEqual({
      temperament: "belligerent, aggrieved",
      ambitions: ["a", "b", "c"],
      grudges: ["FRA blocked the customs union (1936-01)"],
      opinionOfPlayer: -2,
      opinionReason: "France sided with Britain",
    });
    // Untouched nations carry forward verbatim.
    expect(psyches.ITA).toEqual(sheet({ temperament: "opportunistic" }));

    // The pass sees the parent's psyches and this turn's record.
    const prompt = psycheCalls()[0]?.messages[0]?.text ?? "";
    expect(prompt).toContain("Current psyches");
    expect(prompt).toContain("opportunistic");
    expect(prompt).toContain("war_started DEU->GBR");
  });

  it("carries the parent's psyches unchanged when the model fails", async () => {
    store.setRollup(rootId, { ...emptyRollup(), psyches: { DEU: sheet({ opinionOfPlayer: 1 }) } });
    extractedFacts = [{ type: "war_started", attacker: "DEU", defender: "GBR", cause: "border" }];
    psycheResponse = "throw";

    const node = await runTurn();

    expect(psycheCalls()).toHaveLength(1);
    expect(store.getRollup(node.id)?.psyches).toEqual({ DEU: sheet({ opinionOfPlayer: 1 }) });
    // A psyche failure must not fail the extraction job that hosts it.
    expect(store.getNode(node.id)?.extractionStatus).toBe("done");
  });

  it("feeds each nation's psyche into the simulator's NATIONS block", async () => {
    store.setRollup(rootId, {
      ...emptyRollup(),
      psyches: {
        DEU: sheet({
          temperament: "belligerent, aggrieved",
          ambitions: ["rearm the Rhineland"],
          grudges: ["FRA blocked the customs union (1936-01)"],
          opinionOfPlayer: -2,
          opinionReason: "France sided with Britain",
        }),
      },
    });
    const root = store.getNode(rootId)!;

    const text =
      buildTurnRequest({
        store,
        game: store.getGame(),
        parent: root,
        world: store.getWorld(root.worldBlobHash!),
        input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
      }).messages[0]?.text ?? "";

    expect(text).toContain(
      "psyche: belligerent, aggrieved; wants rearm the Rhineland; grudges: FRA blocked the customs union (1936-01); sees us -2 (France sided with Britain)",
    );
    // Nations without a sheet stay unadorned.
    expect(text).toContain("- Italy [ITA]");
  });

  it("puts the counterpart's psyche in the diplomacy persona and the advisor's context", async () => {
    store.setRollup(rootId, {
      ...emptyRollup(),
      psyches: { DEU: sheet({ temperament: "belligerent, aggrieved", opinionOfPlayer: -2 }) },
    });

    const talks = openConversation(store, {
      nodeId: rootId,
      kind: "diplomacy",
      participants: ["DEU"],
    });
    await sendChatMessage(deps(), { nodeId: rootId, conversationId: talks.id, text: "Withdraw." });

    const diplomacy = llm.calls.findLast((call) => call.taskLabel === "diplomacyChat");
    expect(diplomacy?.system[0]?.text).toContain("You are belligerent, aggrieved.");
    expect(diplomacy?.system[0]?.text).toContain("disposition toward France is -2");

    const advisor = openConversation(store, { nodeId: rootId, kind: "advisor" });
    await sendChatMessage(deps(), { nodeId: rootId, conversationId: advisor.id, text: "Advise me." });

    const chat = llm.calls.findLast((call) => call.taskLabel === "advisorChat");
    expect(chat?.system[1]?.text).toContain("Foreign courts: Germany [DEU] — psyche: belligerent, aggrieved");
    // The counterpart persona is the diplomacy path's alone.
    expect(chat?.system[0]?.text).not.toContain("belligerent");
  });
});
