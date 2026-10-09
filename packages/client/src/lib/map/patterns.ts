import type { Map as MaplibreMap } from "maplibre-gl";
import type { Theme } from "@pax/domain";
import { alpha } from "../../theme/color.ts";

/**
 * Procedural, theme-tinted map patterns. The base style ships no sprite, so
 * every fill-pattern / background-pattern image is drawn here on a canvas and
 * registered with `map.addImage` the first time the style asks for it
 * (`styleimagemissing`). Names carry the theme id, so a theme switch simply
 * asks for — and lazily draws — a fresh set.
 */

export type PatternKind =
  | "water-grid"
  | "water-dots"
  | "water-hatch"
  | "water-waves"
  | "land-paper"
  | "land-grain"
  | "disputed";

export const patternName = (kind: PatternKind, theme: Theme): string => `pf-${kind}--${theme.meta.id}`;

const PIXEL_RATIO = 2;

/** Draw one pattern tile; returns null for kinds a theme doesn't define. */
const drawPattern = (kind: PatternKind, theme: Theme): ImageData | null => {
  const dark = theme.meta.scheme === "dark";
  const ink = dark ? theme.map.graticule : theme.map.boundary.line;
  switch (kind) {
    case "water-grid":
      return paint(48, (ctx, size) => {
        ctx.strokeStyle = alpha(dark ? theme.color.accent.base : ink, dark ? 0.09 : 0.12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0.5);
        ctx.lineTo(size, 0.5);
        ctx.moveTo(0.5, 0);
        ctx.lineTo(0.5, size);
        ctx.stroke();
        // Minor ticks at the half-step: a plotting sheet, not a spreadsheet.
        ctx.fillStyle = alpha(dark ? theme.color.accent.base : ink, dark ? 0.16 : 0.2);
        ctx.fillRect(size / 2 - 0.5, size / 2 - 0.5, 1.5, 1.5);
      });
    case "water-dots":
      return paint(12, (ctx) => {
        ctx.fillStyle = alpha(theme.color.text.muted, dark ? 0.22 : 0.25);
        ctx.beginPath();
        ctx.arc(6, 6, 0.9, 0, Math.PI * 2);
        ctx.fill();
      });
    case "water-hatch":
      // Engraver's sea: fine horizontal strokes of uneven length and weight.
      return paint(64, (ctx, size) => {
        const rand = seeded(17);
        ctx.strokeStyle = alpha(theme.map.coast.color || ink, 0.16);
        for (let y = 2; y < size; y += 4) {
          let x = -rand() * 20;
          while (x < size) {
            const len = 8 + rand() * 22;
            ctx.lineWidth = 0.5 + rand() * 0.5;
            ctx.beginPath();
            ctx.moveTo(x, y + rand() * 0.6);
            ctx.lineTo(x + len, y + rand() * 0.6);
            ctx.stroke();
            x += len + 3 + rand() * 9;
          }
        }
      });
    case "water-waves":
      return paint(40, (ctx, size) => {
        ctx.strokeStyle = alpha(ink, 0.18);
        ctx.lineWidth = 0.8;
        for (let row = 0; row < 2; row++) {
          const y = 10 + row * 20;
          const offset = row * 10;
          ctx.beginPath();
          for (let x = -10; x <= size + 10; x += 20) {
            ctx.moveTo(x + offset, y);
            ctx.quadraticCurveTo(x + offset + 5, y - 3, x + offset + 10, y);
          }
          ctx.stroke();
        }
      });
    case "land-paper":
      // Fibres + mottling, inked in the theme's own text color.
      return paint(128, (ctx, size) => {
        const rand = seeded(41);
        const image = ctx.getImageData(0, 0, size * PIXEL_RATIO, size * PIXEL_RATIO);
        const [r, g, b] = hexRgb(theme.color.text.secondary);
        for (let i = 0; i < image.data.length; i += 4) {
          const n = rand();
          image.data[i] = r;
          image.data[i + 1] = g;
          image.data[i + 2] = b;
          image.data[i + 3] = n > 0.55 ? Math.round((n - 0.55) * 110) : 0;
        }
        ctx.putImageData(image, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = alpha(theme.color.text.secondary, 0.12);
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 26; i++) {
          const x = rand() * size * PIXEL_RATIO;
          const y = rand() * size * PIXEL_RATIO;
          const angle = rand() * Math.PI;
          const len = 4 + rand() * 14;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
          ctx.stroke();
        }
      });
    case "land-grain":
      return paint(96, (ctx, size) => {
        const rand = seeded(5);
        const image = ctx.getImageData(0, 0, size * PIXEL_RATIO, size * PIXEL_RATIO);
        for (let i = 0; i < image.data.length; i += 4) {
          const n = rand();
          const light = n > 0.5;
          image.data[i] = light ? 255 : 0;
          image.data[i + 1] = light ? 255 : 0;
          image.data[i + 2] = light ? 255 : 0;
          image.data[i + 3] = Math.round(Math.abs(n - 0.5) * 70);
        }
        ctx.putImageData(image, 0, 0);
      });
    case "disputed":
      return paint(14, (ctx, size) => {
        ctx.strokeStyle = alpha(theme.map.boundary.disputed, 0.75);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let k = -size; k <= size * 2; k += 7) {
          ctx.moveTo(k, size);
          ctx.lineTo(k + size, 0);
        }
        ctx.stroke();
      });
    default:
      return null;
  }
};

const installed = new WeakSet<MaplibreMap>();

/**
 * Registers the handler that draws patterns on demand for this map. Install
 * it as soon as the map instance exists (ref attach), not on `load`: layers
 * ask for their images while the first tiles render, before `load` fires.
 * Idempotent per map.
 */
export const installPatternProvider = (map: MaplibreMap, getTheme: () => Theme): void => {
  if (installed.has(map)) return;
  installed.add(map);
  map.on("styleimagemissing", (event: { id: string }) => {
    const match = /^pf-([a-z-]+)--(.+)$/.exec(event.id);
    if (!match) return;
    const theme = getTheme();
    if (match[2] !== theme.meta.id) return;
    const data = drawPattern(match[1] as PatternKind, theme);
    if (!data || map.hasImage(event.id)) return;
    map.addImage(event.id, data, { pixelRatio: PIXEL_RATIO });
  });
};

const paint = (
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): ImageData | null => {
  const canvas = document.createElement("canvas");
  canvas.width = size * PIXEL_RATIO;
  canvas.height = size * PIXEL_RATIO;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  draw(ctx, size);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

/** Deterministic PRNG so patterns don't shimmer between redraws. */
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hexRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace(/^#/, "");
  const n = parseInt(clean.length === 6 ? clean : "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
