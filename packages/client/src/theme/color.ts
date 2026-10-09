/**
 * Tiny color toolkit for the theme runtime and the map renderer. Everything
 * works on #rrggbb hex (theme JSON may also carry rgba()/named colors; those
 * pass through untouched where a hex parse fails).
 */

export type Rgb = [number, number, number];

export const parseHex = (value: string): Rgb | null => {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [0, 1, 2].map((i) => parseInt(hex[i]! + hex[i]!, 16)) as Rgb;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Linear mix in sRGB: t=0 → a, t=1 → b. Unparseable inputs return `a`. */
export const mix = (a: string, b: string, t: number): string => {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex([0, 1, 2].map((i) => ca[i]! + (cb[i]! - ca[i]!) * t) as Rgb);
};

/** `rgba()` string for a hex color at the given alpha. */
export const alpha = (color: string, a: number): string => {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

/** Relative luminance (WCAG) — used to pick ink vs. paper for text on fills. */
export const luminance = (color: string): number => {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
