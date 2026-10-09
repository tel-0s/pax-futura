import { describe, expect, it } from "vitest";
import { TurnResultSchema, emptyWorld } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { reconcileTurnImpacts } from "./reconcile.ts";

const world = () => {
  const state = emptyWorld();
  state.polities.FRA = { code: "FRA", name: "France", color: "", aliases: [], note: "", reputation: null, tags: [], flag: "" };
  state.units.push({
    id: "u1",
    name: "Grande Armée",
    type: "infantry",
    ownerCode: "FRA",
    strength: 500,
    lng: 2,
    lat: 48,
    regionId: "",
    status: "idle",
    note: "",
    source: "scenario",
  });
  return state;
};

const turn = () =>
  TurnResultSchema.parse({
    stopDate: "1500-06-01",
    summary: "expansion",
    events: [
      {
        date: "1500-03-01",
        title: "Colonists land in the New World",
        description: "A charter company establishes Fort Espoir on the far continent and claims the coast.",
        impacts: {},
      },
    ],
  });

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 4000 };

describe("reconcileTurnImpacts", () => {
  it("merges valid amendments, drops invented region ids, dedupes narrated forces", async () => {
    const llm = new FakeLlmClient(() => ({
      structured: {
        amendments: [
          {
            eventIndex: 0,
            impacts: {
              regionTransfers: [
                { regionId: "USA", toCode: "FRA" }, // valid GADM claim
                { regionId: "VINLAND", toCode: "FRA" }, // invented id — must drop
              ],
              markerOps: [{ op: "build", marker: { name: "Fort Espoir", kind: "outpost", ownerCode: "FRA", lng: -70, lat: 45 } }],
              unitOps: [
                { op: "spawn", unit: { name: "Grande Armée", ownerCode: "FRA", lng: 2, lat: 48 } }, // duplicate of existing — must drop
              ],
            },
          },
          { eventIndex: 99, impacts: { regionTransfers: [{ regionId: "USA", toCode: "FRA" }] } }, // bad index — ignored
        ],
      },
    }));
    const result = await reconcileTurnImpacts({ llm, binding }, { turn: turn(), world: world(), parentDate: "1500-01-01" });

    const impacts = result.events[0]!.impacts;
    expect(impacts.regionTransfers.map((t) => t.regionId)).toEqual(["USA"]);
    expect(impacts.markerOps).toHaveLength(1);
    expect(impacts.unitOps).toHaveLength(0);
  });

  it("drops transfers to unregistered polities unless the amendment registers them", async () => {
    const llm = new FakeLlmClient(() => ({
      structured: {
        amendments: [
          {
            eventIndex: 0,
            impacts: {
              regionTransfers: [
                { regionId: "USA", toCode: "GHOST" }, // never registered — drop
                { regionId: "CAN", toCode: "NOUV" }, // registered below — keep
              ],
              polityChanges: [{ code: "NOUV", name: "Nouvelle Colonie" }],
            },
          },
        ],
      },
    }));
    const result = await reconcileTurnImpacts({ llm, binding }, { turn: turn(), world: world(), parentDate: "1500-01-01" });
    const impacts = result.events[0]!.impacts;
    expect(impacts.regionTransfers.map((t) => `${t.regionId}>${t.toCode}`)).toEqual(["CAN>NOUV"]);
    expect(impacts.polityChanges[0]?.code).toBe("NOUV");
  });

  it("applies the extractor's classification over the simulator's defaults", async () => {
    const llm = new FakeLlmClient(() => ({
      structured: {
        amendments: [
          {
            eventIndex: 0,
            impacts: {},
            kind: "Discovery",
            importance: "pivotal",
            playerRelated: true,
            lng: -70.5,
            lat: 45.25,
          },
        ],
      },
    }));
    const result = await reconcileTurnImpacts(
      { llm, binding },
      { turn: turn(), world: world(), parentDate: "1500-01-01", playerPolity: "FRA" },
    );
    const event = result.events[0]!;
    expect(event.kind).toBe("discovery");
    expect(event.importance).toBe("pivotal");
    expect(event.playerRelated).toBe(true);
    expect([event.lng, event.lat]).toEqual([-70.5, 45.25]);
  });

  it("never overwrites an explicit location the simulator already stated", async () => {
    const llm = new FakeLlmClient(() => ({
      structured: {
        amendments: [{ eventIndex: 0, impacts: {}, importance: "major", lng: 10, lat: 10 }],
      },
    }));
    const located = turn();
    located.events[0]!.lng = -70;
    located.events[0]!.lat = 45;
    const result = await reconcileTurnImpacts(
      { llm, binding },
      { turn: located, world: world(), parentDate: "1500-01-01" },
    );
    const event = result.events[0]!;
    expect([event.lng, event.lat]).toEqual([-70, 45]);
    expect(event.importance).toBe("major"); // classification still applies
  });

  it("leaves an unlocatable event without coordinates on an old-shape response", async () => {
    const llm = new FakeLlmClient(() => ({
      structured: {
        amendments: [
          { eventIndex: 0, impacts: { regionTransfers: [{ regionId: "USA", toCode: "FRA" }] } },
        ],
      },
    }));
    const result = await reconcileTurnImpacts(
      { llm, binding },
      { turn: turn(), world: world(), parentDate: "1500-01-01" },
    );
    const event = result.events[0]!;
    expect(event).not.toHaveProperty("lng");
    expect(event).not.toHaveProperty("lat");
    expect(event.kind).toBe("world"); // untouched defaults survive
    expect(event.importance).toBe("minor");
    expect(event.impacts.regionTransfers).toHaveLength(1); // and the merge still ran
  });

  it("returns the turn unchanged on model failure or empty amendments", async () => {
    const failing = new FakeLlmClient(() => ({ structured: { nonsense: true } }));
    const original = turn();
    const result = await reconcileTurnImpacts({ llm: failing, binding }, { turn: original, world: world(), parentDate: "1500-01-01" });
    expect(result).toEqual(original);
  });
});
