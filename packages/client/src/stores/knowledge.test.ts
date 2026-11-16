import { describe, expect, it } from "vitest";
import { GameEventSchema } from "@pax/domain";
import { feedVisibility } from "./knowledge.ts";

const event = (partial: Record<string, unknown>) =>
  GameEventSchema.parse({ id: "e1", nodeId: "n1", seq: 0, date: "1492-06-01", title: "t", ...partial });

describe("feedVisibility", () => {
  it("everything shows when the mode is off or knowledge is unmodeled", () => {
    const foreign = event({
      importance: "minor",
      impacts: { regionTransfers: [{ regionId: "r", fromCode: "ESP", toCode: "PRT" }] },
    });
    expect(feedVisibility(foreign, null, true)).toBe("shown");
    expect(feedVisibility(foreign, ["PER"], false)).toBe("shown");
  });

  it("player-related and nobody-named events always show", () => {
    expect(feedVisibility(event({ playerRelated: true }), ["PER"], true)).toBe("shown");
    expect(feedVisibility(event({}), ["PER"], true)).toBe("shown");
  });

  it("known-world events show; unknown pivotal is a rumor; unknown lesser hides", () => {
    const between = (importance: string) =>
      event({
        importance,
        impacts: { regionTransfers: [{ regionId: "r", fromCode: "ESP", toCode: "PRT" }] },
      });
    expect(feedVisibility(between("major"), ["ESP", "PRT", "PER"], true)).toBe("shown");
    expect(feedVisibility(between("pivotal"), ["PER"], true)).toBe("rumor");
    expect(feedVisibility(between("major"), ["PER"], true)).toBe("hidden");
    expect(feedVisibility(between("minor"), ["PER"], true)).toBe("hidden");
  });

  it("a partly-known cast still reads as beyond the known world", () => {
    const mixed = event({
      importance: "major",
      impacts: { regionTransfers: [{ regionId: "r", fromCode: "ESP", toCode: "PER" }] },
    });
    expect(feedVisibility(mixed, ["PER"], true)).toBe("hidden");
  });
});
