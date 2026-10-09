import { describe, expect, it } from "vitest";
import { applyImpacts, applyMarkerOps, applyUnitOps } from "./applyImpacts.ts";
import { emptyImpacts, type Impacts } from "./impacts.ts";
import type { EventDraft } from "./event.ts";
import { emptyWorld } from "../world/world.ts";
import type { Unit } from "../world/units.ts";

let counter = 0;
const testId = () => `id-${++counter}`;

const event = (impacts: Partial<Impacts>): EventDraft => ({
  date: "1936-03-12",
  title: "Test event",
  description: "",
  kind: "world",
  importance: "minor",
  playerRelated: false,
  impacts: { ...emptyImpacts(), ...impacts },
});

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: "u1",
  name: "1st Army",
  type: "infantry",
  ownerCode: "FRA",
  strength: 100,
  lng: 2.35,
  lat: 48.85,
  regionId: "",
  status: "idle",
  note: "",
  source: "scenario",
  ...overrides,
});

describe("applyImpacts", () => {
  it("does not mutate the input world", () => {
    const world = emptyWorld();
    const frozen = JSON.stringify(world);
    applyImpacts(world, [event({ regionTransfers: [transfer("r1", "GER")] })], testId);
    expect(JSON.stringify(world)).toBe(frozen);
  });

  it("applies region transfers as ownership overwrites", () => {
    const next = applyImpacts(
      emptyWorld(),
      [event({ regionTransfers: [transfer("r1", "GER"), transfer("r2", "FRA")] })],
      testId,
    );
    expect(next.regionOwnership).toEqual({ r1: "GER", r2: "FRA" });
  });

  it("clears ownership when toCode is null", () => {
    const owned = applyImpacts(emptyWorld(), [event({ regionTransfers: [transfer("r1", "GER")] })], testId);
    const next = applyImpacts(
      owned,
      [event({ regionTransfers: [{ ...transfer("r1", "GER"), toCode: null }] })],
      testId,
    );
    expect(next.regionOwnership).toEqual({});
  });

  it("last transfer wins when events contest a region", () => {
    const next = applyImpacts(
      emptyWorld(),
      [
        event({ regionTransfers: [transfer("r1", "GER")] }),
        event({ regionTransfers: [transfer("r1", "FRA")] }),
      ],
      testId,
    );
    expect(next.regionOwnership.r1).toBe("FRA");
  });

  describe("polity changes", () => {
    it("creates a polity on first touch and merges non-empty fields only", () => {
      const world = emptyWorld();
      world.polities.FRA = {
        code: "FRA",
        name: "France",
        color: "#0000ff",
        aliases: ["French Republic"],
        note: "",
        reputation: 60,
        tags: ["democratic"],
        flag: "",
      };
      const next = applyImpacts(
        world,
        [
          event({
            polityChanges: [
              { code: "FRA", name: "", color: "", aliases: [], note: "In crisis", reputation: null, tags: null },
              { code: "GER", name: "Germany", color: "#333333", aliases: [], note: "", reputation: 40, tags: null },
            ],
          }),
        ],
        testId,
      );
      expect(next.polities.FRA).toMatchObject({
        name: "France",
        color: "#0000ff",
        note: "In crisis",
        reputation: 60,
        tags: ["democratic"],
      });
      expect(next.polities.GER).toMatchObject({ name: "Germany", reputation: 40, tags: [] });
    });

    it("distinguishes tags [] (clear) from null (unchanged)", () => {
      const world = emptyWorld();
      world.polities.RUS = {
        code: "RUS",
        name: "Russia",
        color: "",
        aliases: [],
        note: "",
        reputation: null,
        tags: ["socialist", "revolutionary"],
        flag: "",
      };
      const unchanged = applyImpacts(
        world,
        [event({ polityChanges: [{ code: "RUS", name: "", color: "", aliases: [], note: "", reputation: null, tags: null }] })],
        testId,
      );
      expect(unchanged.polities.RUS?.tags).toEqual(["socialist", "revolutionary"]);

      const cleared = applyImpacts(
        world,
        [event({ polityChanges: [{ code: "RUS", name: "", color: "", aliases: [], note: "", reputation: null, tags: [] }] })],
        testId,
      );
      expect(cleared.polities.RUS?.tags).toEqual([]);
    });
  });
});

describe("applyUnitOps", () => {
  it("spawn is idempotent by unit id and forces source ai", () => {
    const spawn = { op: "spawn" as const, unit: { ...unit(), id: "u9" } };
    const next = applyUnitOps([], [spawn, spawn], testId);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "u9", source: "ai" });
  });

  it("assigns an id to id-less spawns", () => {
    const { id: _id, ...spawnable } = unit();
    const next = applyUnitOps([], [{ op: "spawn", unit: spawnable }], testId);
    expect(next[0]?.id).toMatch(/^id-/);
  });

  it("move updates position and sets status moving, keeping regionId when omitted", () => {
    const next = applyUnitOps(
      [unit({ regionId: "r1" })],
      [{ op: "move", unitId: "u1", toLng: 13.4, toLat: 52.5, regionId: "", note: "" }],
      testId,
    );
    expect(next[0]).toMatchObject({ lng: 13.4, lat: 52.5, status: "moving", regionId: "r1" });
  });

  it("strength 0 marks defeated and the unit is dropped", () => {
    const next = applyUnitOps(
      [unit(), unit({ id: "u2" })],
      [{ op: "strength", unitId: "u1", strength: 0, note: "" }],
      testId,
    );
    expect(next.map((entry) => entry.id)).toEqual(["u2"]);
  });

  it("ops referencing unknown ids are silently ignored", () => {
    const next = applyUnitOps(
      [unit()],
      [{ op: "remove", unitId: "nope", note: "" }, { op: "strength", unitId: "nope", strength: 5, note: "" }],
      testId,
    );
    expect(next).toHaveLength(1);
  });
});

describe("applyMarkerOps", () => {
  const marker = { name: "Maginot Line", kind: "fortification", ownerCode: "FRA", lng: 6.9, lat: 49.2, note: "", foundedAt: "" };

  it("building under an existing name replaces instead of stacking", () => {
    const first = applyMarkerOps([], [{ op: "build", marker }], testId);
    const second = applyMarkerOps(
      first,
      [{ op: "build", marker: { ...marker, name: "maginot line", note: "expanded" } }],
      testId,
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.note).toBe("expanded");
  });

  it("removal matches id first, then exact name", () => {
    const built = applyMarkerOps(
      [],
      [
        { op: "build", marker: { ...marker, id: "m1" } },
        { op: "build", marker: { ...marker, id: "m2", name: "Siegfried Line" } },
      ],
      testId,
    );
    const byId = applyMarkerOps(built, [{ op: "remove", markerId: "m1", name: "", note: "" }], testId);
    expect(byId.map((entry) => entry.id)).toEqual(["m2"]);
    const byName = applyMarkerOps(built, [{ op: "remove", markerId: "", name: "siegfried line", note: "" }], testId);
    expect(byName.map((entry) => entry.id)).toEqual(["m1"]);
  });
});

const transfer = (regionId: string, toCode: string) => ({
  regionId,
  regionName: "",
  fromCode: "",
  toCode,
  note: "",
});
