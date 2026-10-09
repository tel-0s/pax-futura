import { describe, expect, it } from "vitest";
import { WorldStateSchema } from "@pax/domain";
import { buildPolityPalette, polityFillColor } from "./palette.ts";
import { parseHex } from "./color.ts";
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

const hueOf = (hex: string): number => {
  const [r, g, b] = parseHex(hex)!.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe("buildPolityPalette", () => {
  const world = WorldStateSchema.parse({
    polities: Object.fromEntries(
      ["FRA", "DEU", "GBR", "ESP", "ITA", "TUR", "EGY", "MNG", "SERAPH"].map((code) => [
        code,
        { code, ...(code === "SERAPH" ? { color: "#ff812a" } : {}) },
      ]),
    ),
  });

  it("is deterministic for the same world", () => {
    expect(buildPolityPalette(commandDeck!, world)).toEqual(buildPolityPalette(commandDeck!, world));
  });

  it("keeps hashed hues apart from each other and from explicit colors", () => {
    const palette = buildPolityPalette(commandDeck!, world);
    const hues = Object.values(palette).map(hueOf);
    let closest = 360;
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i]! - hues[j]!) % 360;
        closest = Math.min(closest, d > 180 ? 360 - d : d);
      }
    }
    // Nine polities on a full wheel: separation must beat a coin-flip palette.
    expect(closest).toBeGreaterThan(10);
  });

  it("keeps an explicit color's hue", () => {
    const palette = buildPolityPalette(commandDeck!, world);
    expect(Math.abs(hueOf(palette.SERAPH!) - hueOf("#ff812a"))).toBeLessThan(3);
  });
});
