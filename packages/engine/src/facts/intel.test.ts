import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import {
  FactBatchSchema,
  FactSchema,
  GameEventSchema,
  ScenarioSchema,
  type Fact,
  type SseEvent,
} from "@pax/domain";
import { collectChronicle } from "./chronicle.ts";
import { factConfidence, factDigestLine } from "./digest.ts";
import { deriveFacts } from "./derive.ts";
import { runExtraction } from "./extract.ts";
import { executeTurn } from "../turn/orchestrator.ts";
import type { SavePort } from "../ports.ts";

describe("fact confidence schema", () => {
  // Every fact ever written to a save predates the intel layer — those rows
  // must keep parsing, or an old campaign loses its entire ledger.
  it("parses stored facts that have no confidence at all", () => {
    const legacy = JSON.parse(
      '{"type":"treaty_signed","parties":["DEU","GBR"],"kind":"alliance","name":"Pact","terms":"mutual defence"}',
    ) as unknown;
    const fact = FactSchema.parse(legacy);
    expect(fact.confidence).toBeUndefined();
    expect(factConfidence(fact)).toBe("confirmed");
  });

  it("accepts the three grades and rejects anything else", () => {
    for (const confidence of ["confirmed", "reported", "rumored"] as const) {
      const parsed = FactSchema.parse({ type: "notable_event", headline: "h", polities: [], confidence });
      expect(parsed.confidence).toBe(confidence);
    }
    expect(
      FactSchema.safeParse({ type: "notable_event", headline: "h", polities: [], confidence: "hearsay" })
        .success,
    ).toBe(false);
  });

  it("keeps discriminating on type after grading", () => {
    // The union still routes by "type": a war payload under a treaty tag fails.
    expect(FactSchema.safeParse({ type: "war_started", attacker: "DEU", defender: "FRA", cause: "x" }).success).toBe(
      true,
    );
    expect(FactSchema.safeParse({ type: "not_a_fact", headline: "h" }).success).toBe(false);
    expect(FactSchema.safeParse({ type: "war_started", parties: ["DEU", "FRA"] }).success).toBe(false);
    // A whole ungraded batch (what the fake provider still sends) round-trips.
    const batch = FactBatchSchema.parse({
      facts: [{ type: "economic_shift", polity: "FRA", direction: "boom", driver: "harvest" }],
    });
    expect(batch.facts[0]?.confidence).toBeUndefined();
  });
});

describe("factDigestLine confidence prefix", () => {
  const treaty: Fact = {
    type: "treaty_signed",
    parties: ["DEU", "GBR"],
    kind: "alliance",
    name: "Pact",
    terms: "mutual defence",
  };

  it("marks reported and rumored lines and leaves confirmed ones bare", () => {
    expect(factDigestLine(treaty)).toBe('treaty "Pact" (alliance) DEU+GBR');
    expect(factDigestLine({ ...treaty, confidence: "confirmed" })).toBe('treaty "Pact" (alliance) DEU+GBR');
    expect(factDigestLine({ ...treaty, confidence: "reported" })).toBe(
      '(reported) treaty "Pact" (alliance) DEU+GBR',
    );
    expect(factDigestLine({ ...treaty, confidence: "rumored" })).toBe('(rumor) treaty "Pact" (alliance) DEU+GBR');
  });

  it("derived facts render unmarked", () => {
    const event = GameEventSchema.parse({
      id: "e1",
      nodeId: "n1",
      seq: 0,
      date: "1936-01-15",
      title: "Cession",
      impacts: {
        regionTransfers: [{ regionId: "r1", regionName: "Alsace", fromCode: "FRA", toCode: "DEU" }],
      },
    });
    const derived = deriveFacts([event]);
    expect(derived).toHaveLength(1);
    expect(factConfidence(derived[0]!)).toBe("confirmed");
    expect(factDigestLine(derived[0]!)).toBe("territory Alsace: FRA->DEU");
  });
});

describe("extraction grades ungraded facts by the player's vantage", () => {
  let dir: string;
  let store: SavePort;
  let rootId: string;

  const llm = new FakeLlmClient((req) => {
    if (req.taskLabel === "extractFacts") {
      return {
        structured: {
          facts: [
            // The player (FRA) is a party — confirmed even though ungraded.
            { type: "war_started", attacker: "DEU", defender: "FRA", cause: "border" },
            // Two other powers dealing with each other — secondhand.
            { type: "treaty_signed", parties: ["DEU", "GBR"], kind: "alliance", name: "Pact", terms: "defence" },
            // An explicit grade from the model is never overwritten.
            { type: "notable_event", headline: "Whispers of a coup", polities: ["DEU"], confidence: "rumored" },
          ],
        },
      };
    }
    if (req.taskLabel === "updatePsyches") return { structured: { updates: [] } };
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
  const deps = () => ({ store, llm, binding, emit: (_event: SseEvent) => undefined });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pax-intel-"));
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
          polities: {
            FRA: { code: "FRA", name: "France" },
            DEU: { code: "DEU", name: "Germany" },
            GBR: { code: "GBR", name: "Britain" },
          },
        },
      }).world,
    });
    store = makeSavePort(created.db);
    rootId = created.rootNodeId;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults player facts to confirmed, foreign facts to reported, and keeps derived facts firsthand", async () => {
    const node = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), node.id);

    const facts = store.listFactsForNode(node.id);
    const byType = (type: Fact["type"]) => facts.find((fact) => fact.type === type);

    expect(byType("war_started")?.confidence).toBe("confirmed");
    expect(byType("treaty_signed")?.confidence).toBe("reported");
    expect(byType("notable_event")?.confidence).toBe("rumored");
    // Engine-derived: left ungraded, which reads as confirmed.
    expect(byType("territory_change")?.confidence).toBeUndefined();
    expect(factConfidence(byType("territory_change")!)).toBe("confirmed");

    const lines = facts.map(factDigestLine);
    expect(lines.some((line) => line.startsWith("(reported) treaty"))).toBe(true);
    expect(lines.some((line) => line.startsWith("(rumor) notable"))).toBe(true);
    expect(lines.some((line) => line.startsWith("war_started DEU->FRA"))).toBe(true);
  });

  it("tells the extractor whose vantage to grade from", async () => {
    const node = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), node.id);

    const call = llm.calls.filter((entry) => entry.taskLabel === "extractFacts").at(-1);
    expect(call?.system[0]?.text).toContain('"rumored"');
    expect(call?.messages[0]?.text).toContain("Player nation: FRA (France)");
  });

  it("hands the marked lines to the chronicle the drawer reads", async () => {
    const node = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });
    await runExtraction(deps(), node.id);

    const lines = collectChronicle(store, node.id).recent.at(-1)?.lines ?? [];
    expect(lines.some((line) => line.startsWith("(reported) "))).toBe(true);
    expect(lines.some((line) => line.startsWith("(rumor) "))).toBe(true);
  });
});
