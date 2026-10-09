import type { Theme, ThemeStyle } from "@pax/domain";
import { alpha, parseHex } from "./color.ts";

/**
 * Chrome textures as CSS `background-image` values — inline SVG filters and
 * gradients, so nothing is fetched and every texture is tinted by the theme.
 */
export const textureImage = (kind: ThemeStyle["texture"], theme: Theme): string => {
  switch (kind) {
    case "paper":
      return [svgUrl(paperSvg(theme.color.text.primary)), svgUrl(blotchSvg(theme.color.text.secondary))].join(", ");
    case "grain":
      return svgUrl(grainSvg());
    case "scanlines":
      return [
        `repeating-linear-gradient(0deg, ${alpha("#000000", 0.55)} 0 1px, transparent 1px 3px)`,
        `radial-gradient(ellipse at center, transparent 55%, ${alpha("#000000", 0.55)} 100%)`,
      ].join(", ");
    default:
      return "none";
  }
};

const svgUrl = (svg: string): string =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

/** Fine laid-paper fibre: high-frequency noise inked in the theme's text color. */
const paperSvg = (ink: string): string => {
  const [r, g, b] = (parseHex(ink) ?? [40, 30, 20]).map((channel) => (channel / 255).toFixed(3));
  return `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 0.42 -0.05'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`;
};

/** Low-frequency foxing and tide marks — age, not grain. */
const blotchSvg = (ink: string): string => {
  const [r, g, b] = (parseHex(ink) ?? [80, 60, 40]).map((channel) => (channel / 255).toFixed(3));
  return `<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900'><filter id='b'><feTurbulence type='fractalNoise' baseFrequency='0.006' numOctaves='4' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 0.55 -0.18'/></filter><rect width='100%' height='100%' filter='url(#b)'/></svg>`;
};

/** Neutral film grain for overlay blending. */
const grainSvg = (): string =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
