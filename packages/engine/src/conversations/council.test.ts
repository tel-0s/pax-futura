import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLlmClient } from "@pax/providers";
import type { LlmRequest } from "@pax/providers";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import type { SavePort } from "../ports.ts";
import { openConversation, sendChatMessage } from "./chat.ts";
import { COUNCIL_NAMES, council, councilEra, parseCouncilTitle } from "./council.ts";

describe("council cast", () => {
  it("is deterministic per game id and gives each minister a distinct name", () => {
    const first = council("game-a", "1936-01-01");
    const again = council("game-a", "1936-01-01");
    expect(again).toEqual(first);
    expect(first.map((member) => member.role)).toEqual(["chancellor", "marshal", "spymaster"]);
    expect(new Set(first.map((member) => member.name)).size).toBe(3);
    expect(first[0]?.title).toBe(`Chancellor ${first[0]?.name}`);
  });

  it("different games draw different casts", () => {
    const casts = ["g1", "g2", "g3", "g4", "g5", "g6"].map(
      (gameId) => council(gameId, "1936-01-01").map((member) => member.name).join("/"),
    );
    expect(new Set(casts).size).toBeGreaterThan(1);
  });

  it("picks the name list from the start year's era", () => {
    expect(councilEra("1200-06-01")).toBe("medieval");
    expect(councilEra("1492-08-03")).toBe("medieval");
    expect(councilEra("1805-01-01")).toBe("industrial");
    expect(councilEra("2026-01-01")).toBe("modern");
    // Unparseable dates must still produce a cast rather than throwing.
    expect(councilEra("")).toBe("modern");

    for (const [era, names] of Object.entries(COUNCIL_NAMES)) {
      const startDate = { medieval: "1200-01-01", industrial: "1805-01-01", modern: "2026-01-01" }[
        era as keyof typeof COUNCIL_NAMES
      ];
      for (const member of council("g1", startDate)) {
        expect(names).toContain(member.name);
      }
    }
  });

  it("parses the role off a title and ignores everything else", () => {
    expect(parseCouncilTitle("Marshal Berengar")?.role).toBe("marshal");
    // Names may drift between client and engine; the role word is authoritative.
    expect(parseCouncilTitle("Spymaster Someone Else Entirely")?.role).toBe("spymaster");
    expect(parseCouncilTitle("Advisor")).toBeNull();
    expect(parseCouncilTitle("Germany")).toBeNull();
  });
});

const scenario = ScenarioSchema.parse({
  id: "t",
  name: "T",
  startDate: "1936-01-01",
  world: {
    polities: {
      FRA: { code: "FRA", name: "France" },
      DEU: { code: "DEU", name: "Germany" },
    },
  },
});

let dir: string;
let store: SavePort;
let rootId: string;
let requests: LlmRequest[];

const llm = new FakeLlmClient((req) => {
  requests.push(req);
  return { deltas: ["ok"] };
});
const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: (_event: SseEvent) => {} });

const systemText = (request: LlmRequest | undefined): string =>
  (request?.system ?? []).map((block) => block.text).join("\n");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-council-"));
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
  requests = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("minister personas", () => {
  const ask = async (title: string) => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor", title });
    const { assistantMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "What now?",
    });
    return { system: systemText(requests.at(-1)), assistantMessage };
  };

  it("a Marshal conversation gets the marshal worldview and signs as the marshal", async () => {
    const { system, assistantMessage } = await ask("Marshal Berengar");
    expect(system).toContain("You are Marshal Berengar");
    expect(system).toContain("blunt soldier who counts divisions");
    expect(system).toContain("formations, supply, terrain, and time");
    expect(system).not.toContain("chief strategic advisor");
    expect(assistantMessage.speaker).toBe("Marshal Berengar");
  });

  it("each minister privileges something different", async () => {
    const chancellor = (await ask("Chancellor Aldric")).system;
    const spymaster = (await ask("Spymaster Ivo")).system;
    expect(chancellor).toContain("coin, law, and legitimacy");
    expect(spymaster).toContain("You deal in what is hidden");
    expect(chancellor).not.toContain("You deal in what is hidden");
    // Both are told they are one partial voice of three.
    expect(chancellor).toContain("one voice of three");
    expect(spymaster).toContain("one voice of three");
  });

  it("the plain Advisor conversation keeps the original persona", async () => {
    const { system, assistantMessage } = await ask("Advisor");
    expect(system).toContain("You are the chief strategic advisor to the leader of France");
    expect(system).not.toContain("one voice of three");
    expect(assistantMessage.speaker).toBe("Advisor");
  });

  it("diplomacy titles never pick up a minister persona", async () => {
    const conversation = openConversation(store, {
      nodeId: rootId,
      kind: "diplomacy",
      title: "Marshal Islands",
      participants: ["DEU"],
    });
    await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Terms?",
    });
    expect(systemText(requests.at(-1))).toContain("You are roleplaying the leader of Germany");
  });
});
