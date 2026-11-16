import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient, type LlmRequest } from "@pax/providers";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { openConversation, sendChatMessage } from "./chat.ts";
import { council } from "./council.ts";
import { draftCouncilOrders } from "./regency.ts";
import type { SavePort } from "../ports.ts";

const scenario = ScenarioSchema.parse({
  id: "t",
  name: "T",
  startDate: "1492-01-01",
  world: {
    polities: {
      INC: { code: "INC", name: "Inca Empire" },
      ESP: { code: "ESP", name: "Castile" },
    },
  },
});

let dir: string;
let store: SavePort;
let rootId: string;
let events: SseEvent[];
let requests: LlmRequest[];
/** Scripted replies, shifted per call; after the script runs out, a default. */
let script: string[];

const llm = new FakeLlmClient((req) => {
  requests.push(req);
  if (req.tool) throw new Error("regency never makes structured calls");
  const reply = script.shift() ?? "Counsel without end.";
  return { deltas: [reply] };
});
const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: (e: SseEvent) => events.push(e) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-regency-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "INC",
    difficulty: "standard",
    startDate: "1492-01-01",
    world: scenario.world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
  events = [];
  requests = [];
  script = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const members = () => council(rootId, "1492-01-01");

describe("joint session", () => {
  it("one call; stances parsed off the titles; draft from the proposal block", async () => {
    const [chancellor, marshal, spymaster] = members();
    script = [
      [
        `${chancellor!.title}: The treasury can bear one campaign, not two.`,
        `${marshal!.title}: Then give me the one. The pass is open.`,
        `${spymaster!.title}: Castile's envoy lies; I can prove it by spring.`,
        "ORDERS PROPOSAL:",
        "Send the army through the pass and fund the spymaster's proof.",
      ].join("\n"),
    ];
    const result = await draftCouncilOrders(deps(), { nodeId: rootId, depth: "joint" });
    expect(requests).toHaveLength(1);
    expect(result.draft).toBe("Send the army through the pass and fund the spymaster's proof.");
    expect(result.stances.map((stance) => stance.role)).toEqual([
      "chancellor",
      "marshal",
      "spymaster",
    ]);
    expect(result.stances[1]?.position).toBe("Then give me the one. The pass is open.");
  });

  it("a session with no proposal block throws, and nothing is drafted", async () => {
    script = ["The council argued until the candles died."];
    await expect(
      draftCouncilOrders(deps(), { nodeId: rootId, depth: "joint" }),
    ).rejects.toThrow(/without a draft/);
  });

  it("what a minister discussed with the leader reaches the session", async () => {
    const [chancellor] = members();
    const thread = openConversation(store, {
      nodeId: rootId,
      kind: "advisor",
      title: chancellor!.title,
    });
    script = ["A fine plan, if the silver holds."];
    await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: thread.id,
      text: "Can we afford the northern road?",
    });
    requests = [];
    script = ["ORDERS PROPOSAL:\nBuild the northern road."];
    await draftCouncilOrders(deps(), { nodeId: rootId, depth: "joint" });
    const sessionText = requests[0]!.messages.map((turn) => turn.text).join("\n");
    expect(sessionText).toContain("Can we afford the northern road?");
    expect(sessionText).toContain("A fine plan, if the silver holds.");
  });
});

describe("chamber session", () => {
  it("three ministers in order, each seeing the session so far, then the synthesis", async () => {
    const [chancellor, marshal] = members();
    script = [
      "Coin first: we cannot pay for a war and a road in the same year.",
      "The chancellor counts coin while the pass stands open. Take the pass.",
      "Both of you assume Castile waits. It does not.",
      "ORDERS PROPOSAL:\nTake the pass; delay the road a season.",
    ];
    const result = await draftCouncilOrders(deps(), { nodeId: rootId, depth: "chamber" });
    expect(requests).toHaveLength(4);

    // The marshal argues WITH the chancellor's stance in view — the fight is wired.
    const marshalTurn = requests[1]!.messages.map((turn) => turn.text).join("\n");
    expect(marshalTurn).toContain("we cannot pay for a war and a road");
    // And in the marshal's own persona.
    const marshalSystem = (requests[1]!.system ?? []).map((block) => block.text).join("\n");
    expect(marshalSystem).toContain(marshal!.title);
    expect(marshalSystem).not.toContain(`You are ${chancellor!.title}`);

    // The synthesis sees the whole record and yields the draft.
    const synthesisTurn = requests[3]!.messages.map((turn) => turn.text).join("\n");
    expect(synthesisTurn).toContain("Castile waits");
    expect(result.draft).toBe("Take the pass; delay the road a season.");
    expect(result.stances).toHaveLength(3);
    expect(result.stances[0]?.position).toContain("Coin first");
  });

  it("a synthesis without the block throws", async () => {
    script = ["one", "two", "three", "The clerk lost his nerve."];
    await expect(
      draftCouncilOrders(deps(), { nodeId: rootId, depth: "chamber" }),
    ).rejects.toThrow(/without a draft/);
  });
});
