import { describe, expect, it } from "vitest";
import { WorldStateSchema } from "@pax/domain";
import { buildOwnership, inFilter, matchExpression, ownerAt } from "./ownership.ts";

const world = WorldStateSchema.parse({
  polities: { FRA: { code: "FRA" }, DEU: { code: "DEU" }, SERAPH: { code: "SERAPH" } },
  regionOwnership: { AUT: "DEU", FRA: "SERAPH", "ITA.1_1": "FRA" },
  regionClaimants: { "ITA.1_1": ["FRA", "DEU"], BEL: ["FRA"], CHE: [] },
});

describe("buildOwnership", () => {
  const ownership = buildOwnership(world);

  it("lets country transfers override polity self-ownership", () => {
    expect(ownership.countryOwner.FRA).toBe("SERAPH");
    expect(ownership.countryOwner.DEU).toBe("DEU");
    expect(ownership.countryOwner.AUT).toBe("DEU");
    // Landless polities paint nothing at country level.
    expect(ownership.countryOwner.SERAPH).toBeUndefined();
  });

  it("inverts ownership per polity", () => {
    expect(ownership.countriesOf.SERAPH).toEqual(["FRA"]);
    expect(ownership.countriesOf.DEU?.sort()).toEqual(["AUT", "DEU"]);
    expect(ownership.regionsOf.FRA).toEqual(["ITA.1_1"]);
  });

  it("splits claims by id kind and skips empty claimant lists", () => {
    expect(ownership.claimedRegions).toEqual(["ITA.1_1"]);
    expect(ownership.claimedCountries).toEqual(["BEL"]);
  });

  it("resolves a feature's owner region-first", () => {
    expect(ownerAt(ownership, { GID_0: "ITA", GID_1: "ITA.1_1" })).toBe("FRA");
    expect(ownerAt(ownership, { GID_0: "FRA", GID_1: "FRA.2_1" })).toBe("SERAPH");
    expect(ownerAt(ownership, { GID_0: "POL" })).toBeNull();
    expect(ownerAt(ownership, undefined)).toBeNull();
  });
});

describe("expressions", () => {
  it("falls back to the plain value when nothing matches", () => {
    expect(matchExpression("GID_0", {}, "#000")).toBe("#000");
    expect(matchExpression("GID_0", { FRA: "#111" }, "#000")).toEqual(["match", ["get", "GID_0"], "FRA", "#111", "#000"]);
  });

  it("builds a never-matching filter for an empty id list", () => {
    expect(inFilter("GID_1", [])).toEqual(["==", ["get", "GID_1"], "\u0000"]);
    expect(inFilter("GID_1", ["A"])).toEqual(["in", ["get", "GID_1"], ["literal", ["A"]]]);
  });
});
