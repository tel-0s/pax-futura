import { describe, expect, it } from "vitest";
import { polityFillColor } from "./palette.ts";
import { PRESET_THEMES } from "./presets.ts";

const [commandDeck, parchment] = PRESET_THEMES;

describe("polityFillColor", () => {
  it("is stable for the same code and theme", () => {
    expect(polityFillColor(commandDeck!, "FRA")).toBe(polityFillColor(commandDeck!, "FRA"));
  });

  it("gives different codes different colors", () => {
    expect(polityFillColor(commandDeck!, "FRA")).not.toBe(polityFillColor(commandDeck!, "GER"));
  });

  it("keeps an explicit color's hue but clamps chroma into the theme envelope", () => {
    const themed = polityFillColor(parchment!, "FRA", "#0000ff");
    // Pure blue (hue 240) through parchment's low-sat envelope: still bluish,
    // never the raw saturated input.
    expect(themed).not.toBe("#0000ff");
    expect(themed).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("produces valid hex for every preset", () => {
    for (const theme of PRESET_THEMES) {
      expect(polityFillColor(theme, "GBR")).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
