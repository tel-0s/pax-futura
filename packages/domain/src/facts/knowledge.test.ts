import { describe, expect, it } from "vitest";
import { ImpactsSchema } from "../turn/impacts.ts";
import { eventPolities, growKnownPolities } from "./knowledge.ts";

const impacts = (partial: Record<string, unknown>) => ImpactsSchema.parse(partial);

describe("eventPolities", () => {
  it("collects transfer sides, polity changes and chat participants", () => {
    const codes = eventPolities(
      impacts({
        regionTransfers: [{ regionId: "r1", fromCode: "ESP", toCode: "PER" }],
        polityChanges: [{ code: "PRT" }],
        createdChats: [
          {
            title: "Envoys",
            participants: ["TUR"],
            openingMessage: { speaker: "Vizier", text: "We hear things." },
          },
        ],
      }),
    );
    expect([...codes].sort()).toEqual(["ESP", "PER", "PRT", "TUR"]);
  });

  it("skips empty from-codes and null to-codes", () => {
    const codes = eventPolities(
      impacts({ regionTransfers: [{ regionId: "r1", toCode: null }] }),
    );
    expect(codes).toEqual([]);
  });
});

describe("growKnownPolities", () => {
  it("null parent and null seed stays null — knowledge never modeled", () => {
    expect(
      growKnownPolities({ parent: null, seed: null, playerCode: "PER", contacts: ["ESP"] }),
    ).toBeNull();
  });

  it("the first fold starts from the seed and adds the player and contacts", () => {
    expect(
      growKnownPolities({ parent: null, seed: ["PER"], playerCode: "PER", contacts: ["ESP", ""] }),
    ).toEqual(["ESP", "PER"]);
  });

  it("later folds grow the parent set; knowledge never shrinks", () => {
    expect(
      growKnownPolities({
        parent: ["ESP", "PER"],
        seed: ["PER"],
        playerCode: "PER",
        contacts: [],
      }),
    ).toEqual(["ESP", "PER"]);
  });
});
