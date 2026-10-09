import type { Theme, WorldState } from "@pax/domain";
import { mix, parseHex } from "./color.ts";

/**
 * Per-faction map colors: a stable hue derived from the faction code (same
 * game, different theme => same hue relationships), with saturation and
 * luminance clamped into the theme's envelope so every theme keeps its own
 * chroma character. An explicit scenario color contributes its HUE, but its
 * chroma is still theme-clamped. Themes with a narrowed `hueSpread` compress
 * every hue (hashed or explicit) into their slice of the wheel.
 */
export const polityFillColor = (theme: Theme, code: string, explicitColor?: string): string =>
  colorForHue(theme, code, polityHue(theme, code, explicitColor));

/** The hue a polity gets before any separation from its neighbours. */
const polityHue = (theme: Theme, code: string, explicitColor?: string): number => {
  const { hueOffset, hueSpread = 1 } = theme.map.polityPalette;
  const explicit = explicitColor ? parseHex(explicitColor) : null;
  const baseHue = explicit ? rgbToHue(explicit) : hashCode(code) % 360;
  return explicit && hueSpread >= 1 ? baseHue : (baseHue * hueSpread + hueOffset) % 360;
};

const colorForHue = (theme: Theme, code: string, hue: number): string => {
  const { sat, lum } = theme.map.polityPalette;
  const saturation = sat[0] + ((hashCode(`${code}:s`) % 100) / 100) * (sat[1] - sat[0]);
  const luminance = lum[0] + ((hashCode(`${code}:l`) % 100) / 100) * (lum[1] - lum[0]);
  return hslToHex(hue, saturation, luminance);
};

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Fill colors for every polity in a world under a theme. Explicit scenario
 * colors claim their hues first; hashed hues that land too close to an
 * already-claimed one are walked around the theme's slice of the wheel by a
 * golden-ratio step until they stand apart. Deterministic for a given set of
 * polities (codes are visited in sorted order), so a world always paints the
 * same way.
 */
export const buildPolityPalette = (theme: Theme, world: WorldState): Record<string, string> => {
  const { hueOffset, hueSpread = 1 } = theme.map.polityPalette;
  const polities = Object.values(world.polities).sort((a, b) => a.code.localeCompare(b.code));
  const slice = 360 * hueSpread;
  const step = slice * 0.381966;
  const gap = Math.max(7, Math.min(24, (slice / Math.max(polities.length, 1)) * 0.6));
  const claimed: number[] = [];
  const result: Record<string, string> = {};
  const hasExplicit = (color: string) => Boolean(color && parseHex(color));

  for (const polity of polities.filter((entry) => hasExplicit(entry.color))) {
    const hue = polityHue(theme, polity.code, polity.color);
    claimed.push(hue);
    result[polity.code] = colorForHue(theme, polity.code, hue);
  }
  for (const polity of polities.filter((entry) => !hasExplicit(entry.color))) {
    let hue = polityHue(theme, polity.code);
    for (let attempt = 0; attempt < 12 && claimed.some((other) => hueDistance(other, hue) < gap); attempt++) {
      const within = (hue - hueOffset + 360) % 360;
      hue = (hueOffset + ((within + step) % slice)) % 360;
    }
    claimed.push(hue);
    result[polity.code] = colorForHue(theme, polity.code, hue);
  }
  return result;
};

/**
 * What a polity's territory actually looks like on the map: its palette color
 * laid over the theme's base land at `fillOpacity`, precomposited so country
 * and region layers paint identical shades and no layer needs alpha.
 */
export const territoryColor = (theme: Theme, fill: string): string =>
  mix(theme.map.land, fill, theme.map.fillOpacity);

/**
 * The inked edge band inside a territory: darker on paper (ink), brighter on
 * dark themes (a lit rim), so borders read in either scheme.
 */
export const bandColor = (theme: Theme, fill: string): string =>
  theme.meta.scheme === "light" ? mix(fill, "#1a1208", 0.42) : mix(fill, "#ffffff", 0.32);

/** FNV-1a over the string; stable across sessions and platforms. */
const hashCode = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
};

const rgbToHue = ([r, g, b]: [number, number, number]): number => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let hue: number;
  if (max === rn) hue = ((gn - bn) / d) % 6;
  else if (max === gn) hue = (bn - rn) / d + 2;
  else hue = (rn - gn) / d + 4;
  return (hue * 60 + 360) % 360;
};

const hslToHex = (h: number, s: number, l: number): string => {
  const sn = s / 100;
  const ln = l / 100;
  const chroma = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - chroma / 2;
  const [r, g, b] =
    h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};
