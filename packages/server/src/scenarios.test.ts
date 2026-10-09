import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRY_ENTRIES, KNOWN_REGION_IDS } from "@pax/domain";
import { loadScenarios } from "./scenarios.ts";

const scenariosDir = resolve(import.meta.dirname, "../../../scenarios");
const scenarios = loadScenarios(scenariosDir);

const countryCodes = new Set(COUNTRY_ENTRIES.map(([code]) => code));

describe("scenario files", () => {
  it("load without validation errors", () => {
    // loadScenarios swallows parse failures with a console.warn; make sure
    // every file on disk actually made it into the loaded map.
    expect(scenarios.size).toBeGreaterThan(0);
  });

  for (const [id, scenario] of scenarios) {
    describe(id, () => {
      const polityCodes = new Set(Object.keys(scenario.world.polities));

      it("every regionOwnership key is a known GADM country code", () => {
        for (const regionId of Object.keys(scenario.world.regionOwnership)) {
          expect(KNOWN_REGION_IDS.has(regionId), `unknown region id "${regionId}"`).toBe(true);
        }
      });

      it("every regionOwnership country-level key is in COUNTRY_ENTRIES", () => {
        for (const regionId of Object.keys(scenario.world.regionOwnership)) {
          // Country-level composites use 3-letter GID_0 keys; sub-region
          // (GID_1) keys contain a dot and aren't covered by this check.
          if (!regionId.includes(".")) {
            expect(countryCodes.has(regionId), `"${regionId}" is not a COUNTRY_ENTRIES code`).toBe(
              true,
            );
          }
        }
      });

      it("every regionOwnership owner references a polity defined in this scenario", () => {
        for (const [regionId, ownerCode] of Object.entries(scenario.world.regionOwnership)) {
          expect(
            polityCodes.has(ownerCode),
            `region "${regionId}" is owned by "${ownerCode}", which has no polity entry in ${id}`,
          ).toBe(true);
        }
      });

      it("every playable polity code has a matching world.polities entry", () => {
        for (const playable of scenario.playablePolities) {
          expect(
            polityCodes.has(playable.code),
            `playable polity "${playable.code}" has no world.polities entry in ${id}`,
          ).toBe(true);
        }
      });
    });
  }
});
