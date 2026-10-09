import { describe, expect, it } from "vitest";
import { TurnResultSchema, emptyWorld } from "@pax/domain";
import { validateTurnResult } from "./validate.ts";

const world = () => {
  const state = emptyWorld();
  state.regionOwnership.r1 = "FRA"; // scenario-local region key (not in the GADM catalog)
  state.polities.FRA = { code: "FRA", name: "France", color: "", aliases: [], note: "", reputation: null, tags: [], flag: "" };
  state.units.push({
    id: "u1",
    name: "1st Army",
    type: "infantry",
    ownerCode: "FRA",
    strength: 100,
    lng: 2,
    lat: 48,
    regionId: "",
    status: "idle",
    note: "",
    source: "scenario",
  });
  return state;
};

const turn = (overrides: Record<string, unknown>) =>
  TurnResultSchema.parse({
    stopDate: "1936-02-01",
    summary: "s",
    events: [{ date: "1936-01-15", title: "t", description: "something happened", impacts: {} }],
    ...overrides,
  });

describe("validateTurnResult", () => {
  it("flags non-advancing stopDate for retry", () => {
    const outcome = validateTurnResult(turn({ stopDate: "1936-01-01" }), world(), "1936-01-01");
    expect(outcome.errors[0]).toMatch(/does not advance/);
  });

  it("drops unit ops referencing unknown units, keeps valid ones", () => {
    const result = turn({
      events: [
        {
          date: "1936-01-15",
          title: "t",
          description: "d",
          impacts: {
            unitOps: [
              { op: "strength", unitId: "u1", strength: 50 },
              { op: "move", unitId: "ghost", toLng: 1, toLat: 1 },
            ],
          },
        },
      ],
    });
    const outcome = validateTurnResult(result, world(), "1936-01-01");
    expect(outcome.errors).toHaveLength(0);
    expect(outcome.salvaged.events[0]?.impacts.unitOps).toHaveLength(1);
    expect(outcome.dropped[0]).toMatch(/ghost/);
  });

  it("requires unknown transfer targets to be registered via polityChanges", () => {
    const unregistered = turn({
      events: [
        { date: "1936-01-15", title: "t", description: "d", impacts: { regionTransfers: [{ regionId: "r1", toCode: "XYZ" }] } },
      ],
    });
    expect(validateTurnResult(unregistered, world(), "1936-01-01").errors[0]).toMatch(/XYZ/);

    const registered = turn({
      events: [
        {
          date: "1936-01-15",
          title: "t",
          description: "d",
          impacts: {
            regionTransfers: [{ regionId: "r1", toCode: "XYZ" }],
            polityChanges: [{ code: "XYZ", name: "Xyzia" }],
          },
        },
      ],
    });
    expect(validateTurnResult(registered, world(), "1936-01-01").errors).toHaveLength(0);
  });

  it("rejects invented region ids but accepts GADM catalog ids and null toCode", () => {
    const invented = turn({
      events: [
        { date: "1936-01-15", title: "t", description: "d", impacts: { regionTransfers: [{ regionId: "VINLAND", toCode: "FRA" }] } },
      ],
    });
    const outcome = validateTurnResult(invented, world(), "1936-01-01");
    expect(outcome.errors[0]).toMatch(/VINLAND/);
    expect(outcome.salvaged.events[0]?.impacts.regionTransfers).toHaveLength(0);

    // Terra incognita: "USA" is not in this world's ownership but is a real
    // GADM country code; claiming it (or abandoning r1) is legal.
    const claims = turn({
      events: [
        {
          date: "1936-01-15",
          title: "t",
          description: "d",
          impacts: {
            regionTransfers: [
              { regionId: "USA", toCode: "FRA" },
              { regionId: "r1", toCode: null },
            ],
          },
        },
      ],
    });
    expect(validateTurnResult(claims, world(), "1936-01-01").errors).toHaveLength(0);
  });

  it("flags all-headline turns for a corrective retry, keeps mixed turns", () => {
    const bare = turn({
      events: [
        { date: "1936-01-10", title: "Headline one", impacts: {} },
        { date: "1936-01-20", title: "Headline two", impacts: {} },
      ],
    });
    expect(validateTurnResult(bare, world(), "1936-01-01").errors.join(" ")).toMatch(/bare headline/i);

    // One substantive description is enough — partial laziness is salvageable.
    const mixed = turn({
      events: [
        { date: "1936-01-10", title: "Headline", impacts: {} },
        { date: "1936-01-20", title: "Full", description: "A described development.", impacts: {} },
      ],
    });
    expect(validateTurnResult(mixed, world(), "1936-01-01").errors).toHaveLength(0);
  });

  it("clamps event dates past stopDate", () => {
    const result = turn({
      events: [{ date: "1936-03-15", title: "future event", description: "d", impacts: {} }],
    });
    const outcome = validateTurnResult(result, world(), "1936-01-01");
    expect(outcome.salvaged.events[0]?.date).toBe("1936-02-01");
  });
});
