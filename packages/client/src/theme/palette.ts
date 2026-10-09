import type { Theme, WorldState } from "@pax/domain";

/**
 * Per-faction map colors: a stable hue derived from the faction code (same
 * game, different theme => same hue relationships), with saturation and
 * luminance clamped into the theme's envelope so every theme keeps its own
 * chroma character. An explicit scenario color contributes its HUE, but its
 * chroma is still theme-clamped.
 */
export const polityFillColor = (theme: Theme, code: string, explicitColor?: string): string => {
  const { hueOffset, sat, lum } = theme.map.polityPalette;

  const explicit = explicitColor ? parseHex(explicitColor) : null;
  const hue = explicit
    ? rgbToHue(explicit)
    : (hashCode(code) % 360 + hueOffset) % 360;

  const satSpan = sat[1] - sat[0];
  const lumSpan = lum[1] - lum[0];
  const saturation = sat[0] + (hashCode(`${code}:s`) % 100) / 100 * satSpan;
  const luminance = lum[0] + (hashCode(`${code}:l`) % 100) / 100 * lumSpan;

  return hslToHex(hue, saturation, luminance);
};

/** Fill colors for every polity in a world under a theme. */
export const buildPolityPalette = (theme: Theme, world: WorldState): Record<string, string> =>
  Object.fromEntries(
    Object.values(world.polities).map((polity) => [
      polity.code,
      polityFillColor(theme, polity.code, polity.color || undefined),
    ]),
  );

/** FNV-1a over the string; stable across sessions and platforms. */
const hashCode = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
};

const parseHex = (value: string): [number, number, number] | null => {
  const hex = value.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
