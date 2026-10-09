import { z } from "zod";

const Color = z.string().min(1);

/** MapLibre needs pre-rendered glyphs, so themes pick from shipped stacks. */
export const GlyphStackSchema = z.enum(["sans", "serif", "mono-condensed"]);

/**
 * A theme is user-editable JSON validated against this schema, flattened to
 * `--pf-*` CSS custom properties at runtime, and transformed into a MapLibre
 * style patch. Every panel, conversation UI, the loom view, and the world map
 * derive from these tokens — no raw colors anywhere else.
 */
export const ThemeSchema = z.object({
  meta: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    scheme: z.enum(["dark", "light"]),
  }),
  color: z.object({
    /** bg0 canvas -> bg3 raised, back-to-front. */
    surface: z.tuple([Color, Color, Color, Color]),
    text: z.object({ primary: Color, secondary: Color, muted: Color, inverse: Color }),
    accent: z.object({ base: Color, hover: Color, subtle: Color }),
    semantic: z.object({ success: Color, warning: Color, danger: Color, info: Color }),
    border: z.object({ subtle: Color, strong: Color, focus: Color }),
    loom: z.object({
      canonicalEdge: Color,
      siblingEdge: Color,
      nodeCurrent: Color,
      nodePending: Color,
    }),
  }),
  font: z.object({
    ui: z.string().min(1),
    display: z.string().min(1),
    mono: z.string().min(1),
    scale: z.object({
      xs: z.string(),
      sm: z.string(),
      md: z.string(),
      lg: z.string(),
      xl: z.string(),
    }),
  }),
  /** Base spacing unit in px; the runtime derives --pf-space-1..8. */
  space: z.object({ unit: z.number().positive() }),
  radius: z.object({ sm: z.string(), md: z.string(), lg: z.string() }),
  shadow: z.object({ raise: z.string(), overlay: z.string() }),
  map: z.object({
    water: Color,
    land: Color,
    terrainTintOpacity: z.number().min(0).max(1),
    boundary: z.object({ line: Color, disputed: Color }),
    label: z.object({ color: Color, halo: Color, glyphStack: GlyphStackSchema }),
    graticule: Color,
    selectionOutline: Color,
    hoverFill: Color,
    /** Per-faction palette envelope: stable hue per faction, theme-clamped. */
    polityPalette: z.object({
      hueOffset: z.number().min(0).max(360),
      sat: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
      lum: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
      contested: z.enum(["stripe", "blend"]),
    }),
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;
