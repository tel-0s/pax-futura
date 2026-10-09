import { describe, expect, it } from "vitest";
import { TurnResultSchema } from "./outputs.ts";
import { toLlmToolSchema } from "./jsonSchema.ts";
import { FactBatchSchema } from "../facts/fact.ts";
import { SseEventSchema } from "../api/sse.ts";

describe("TurnResult", () => {
  it("parses a realistic simulator payload, filling defaults", () => {
    const result = TurnResultSchema.parse({
      stopDate: "1936-04-01",
      summary: "Germany remilitarizes the Rhineland; France mobilizes.",
      events: [
        {
          date: "1936-03-07",
          title: "Rhineland remilitarized",
          description: "German troops cross the bridges at dawn.",
          importance: "pivotal",
          impacts: {
            regionTransfers: [{ regionId: "DEU.rhineland", toCode: "GER" }],
            polityChanges: [{ code: "GER", reputation: 35 }],
            unitOps: [
              { op: "spawn", unit: { name: "Wehrmacht III", ownerCode: "GER", lng: 7.1, lat: 50.7 } },
            ],
          },
        },
      ],
    });
    expect(result.events[0]?.impacts.polityChanges[0]?.tags).toBeNull();
    expect(result.events[0]?.impacts.unitOps[0]).toMatchObject({ op: "spawn" });
    expect(result.events[0]?.playerRelated).toBe(false);
  });

  it("rejects a payload with no events", () => {
    expect(() =>
      TurnResultSchema.parse({ stopDate: "1936-04-01", summary: "s", events: [] }),
    ).toThrow();
  });
});

describe("toLlmToolSchema", () => {
  it("derives JSON Schema from TurnResult without throwing", () => {
    const tool = toLlmToolSchema("submit_turn_result", "Submit the simulated turn", TurnResultSchema);
    expect(tool.schema).toHaveProperty("type", "object");
    expect(JSON.stringify(tool.schema)).toContain("regionTransfers");
  });

  it("derives JSON Schema from FactBatch (discriminated union)", () => {
    const tool = toLlmToolSchema("submit_facts", "Submit extracted facts", FactBatchSchema);
    expect(JSON.stringify(tool.schema)).toContain("war_started");
  });
});

describe("FactBatch", () => {
  it("parses a mixed batch of facts", () => {
    const batch = FactBatchSchema.parse({
      facts: [
        { type: "war_started", attacker: "GER", defender: "POL", cause: "Border dispute" },
        { type: "relationship_shift", pair: ["FRA", "GER"], delta: -2, reason: "Rhineland" },
        { type: "commitment", from: "GBR", to: "POL", what: "Security guarantee", status: "made" },
      ],
    });
    expect(batch.facts).toHaveLength(3);
  });
});

describe("SseEvent", () => {
  it("round-trips a discriminated event", () => {
    const parsed = SseEventSchema.parse({
      type: "turn.progress",
      nodeId: "n1",
      phase: "generating",
    });
    expect(parsed.type).toBe("turn.progress");
    expect(() => SseEventSchema.parse({ type: "bogus" })).toThrow();
  });
});
