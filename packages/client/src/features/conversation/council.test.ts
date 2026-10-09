import { describe, expect, it } from "vitest";
// The duplicated naming half is only allowed to exist because this test proves
// the two copies agree. Test-only import: runtime client code never reaches
// into the engine (dependency-cruiser excludes tests for exactly this).
import { council as engineCouncil } from "../../../../engine/src/conversations/council.ts";
import { council, councilEra, isCouncilTitle } from "./council.ts";

describe("client council twin", () => {
  it("names the same cast as the engine across eras and games", () => {
    for (const startDate of ["1200-01-01", "1492-08-03", "1805-01-01", "1936-01-01", "2045-03-09"]) {
      for (const gameId of ["g1", "g2", "01JABCDEF", "a-longer-game-id"]) {
        expect(council(gameId, startDate)).toEqual(engineCouncil(gameId, startDate));
      }
    }
  });

  it("agrees with the engine on era boundaries", () => {
    expect(councilEra("1499-12-31")).toBe("medieval");
    expect(councilEra("1500-01-01")).toBe("industrial");
    expect(councilEra("1899-12-31")).toBe("industrial");
    expect(councilEra("1900-01-01")).toBe("modern");
  });

  it("recognises minister titles and leaves the plain advisor alone", () => {
    expect(isCouncilTitle("Chancellor Aldric")).toBe(true);
    expect(isCouncilTitle("Advisor")).toBe(false);
  });
});
