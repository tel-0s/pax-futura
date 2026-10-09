import { z } from "zod";

const Color = z.string().min(1);

/** MapLibre needs pre-rendered glyphs, so themes pick from shipped stacks. */
export const GlyphStackSchema = z.enum(["sans", "serif", "mono-condensed"]);

/**
 * Chrome personality beyond color: what panels are MADE of (glass, paper,
 * machined metal), how their corners are cut, what ornament frames them, and
 * how headings carry themselves. Every field defaults to the plain look, so
 * a v1 theme (no `style` block) still parses and renders as before.
 */
export const ThemeStyleSchema = z.object({
  /** Floating-panel material: 1 = opaque surface; lower lets the map through. */
  panelOpacity: z.number().min(0.4).max(1).default(1),
  /** Backdrop blur behind translucent panels, px. */
  panelBlur: z.number().min(0).max(48).default(0),
  /** Corner treatment for panels, cards and buttons. */
  corners: z.enum(["round", "chamfer", "square"]).default("round"),
  /** Decorative frame motif on panels, modals and cards. */
  ornament: z.enum(["none", "brackets", "double-rule", "hazard", "hairline"]).default("none"),
  /** Full-screen material texture laid over the chrome. */
  texture: z.enum(["none", "paper", "grain", "scanlines"]).default("none"),
  textureOpacity: z.number().min(0).max(1).default(0),
  /** Accent glow strength: 0 = flat print, 1 = phosphor. */
  glow: z.number().min(0).max(1).default(0),
  heading: z
    .object({
      case: z.enum(["none", "uppercase", "small-caps"]).default("none"),
      /** CSS letter-spacing for display headings, e.g. "0.08em". */
      tracking: z.string().default("0"),
      weight: z.number().min(100).max(900).default(600),
    })
    .prefault({}),
  /** Separator glyph for ornamental rules ("❦", "◆", "//"); empty = plain rule. */
  fleuron: z.string().max(4).default(""),
});
export type ThemeStyle = z.infer<typeof ThemeStyleSchema>;

/**
 * Cartographic personality: projection, how coasts meet the sea, what the
 * water and land are textured with, and how territory edges are inked.
 */
export const ThemeMapStyleSchema = z.object({
  projection: z.enum(["mercator", "globe"]).default("mercator"),
  /** Globe-only atmosphere; space is the canvas behind the globe. */
  atmosphere: z
    .object({ space: Color, horizon: Color, glow: z.number().min(0).max(1) })
    .nullable()
    .default(null),
  coast: z
    .object({
      /** glow = luminous rim, ripples = engraved water-lines, shadow = raised paper. */
      style: z.enum(["none", "glow", "ripples", "shadow"]).default("none"),
      color: z.string().default(""),
      width: z.number().min(0).max(40).default(6),
      opacity: z.number().min(0).max(1).default(0.5),
    })
    .prefault({}),
  /** Screen-space pattern over the sea. */
  waterPattern: z.enum(["none", "grid", "dots", "hatch", "waves"]).default("none"),
  /** Screen-space material over land (paper fibre, film grain). */
  landTexture: z.enum(["none", "paper", "grain"]).default("none"),
  textureStrength: z.number().min(0).max(1).default(0.3),
  /** How much polity color covers the base land (precomposited, 0..1). */
  fillOpacity: z.number().min(0).max(1).default(0.85),
  /** Width (px) of the owner-colored band inked inside territory edges; 0 = off. */
  borderBand: z.number().min(0).max(12).default(0),
  /** Dash pattern for country boundaries; empty = solid. */
  boundaryDash: z.array(z.number().min(0)).max(4).default([]),
  /** Darkened (or lightened, on dark themes) viewport edges, 0..1. */
  vignette: z.number().min(0).max(1).default(0),
  /** Overlay furniture drawn over the map. */
  ornament: z.enum(["none", "hud", "compass", "minimal"]).default("none"),
});
export type ThemeMapStyle = z.infer<typeof ThemeMapStyleSchema>;

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
    /** One-line flavor shown in the theme picker. */
    tagline: z.string().max(80).default(""),
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
    /**
     * CSS font-size-adjust (x-height ratio) for the display face, so faces
     * with tiny x-heights (VT323) render at the size the layout intends.
     */
    displayAdjust: z.number().min(0.2).max(1).nullable().default(null),
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
  style: ThemeStyleSchema.prefault({}),
  map: z
    .object({
      water: Color,
      land: Color,
      terrainTintOpacity: z.number().min(0).max(1),
      boundary: z.object({ line: Color, disputed: Color }),
      label: z.object({
        color: Color,
        halo: Color,
        glyphStack: GlyphStackSchema,
        /** CSS font stack for map labels; empty = the display font. */
        font: z.string().default(""),
        case: z.enum(["none", "uppercase", "small-caps"]).default("uppercase"),
        tracking: z.string().default("0.12em"),
        /** Italic labels (the cartographer's convention for water and wilds). */
        italic: z.boolean().default(false),
        /** Size multiplier for faces with small x-heights (VT323, Fell). */
        scale: z.number().min(0.5).max(2).default(1),
      }),
      graticule: Color,
      selectionOutline: Color,
      hoverFill: Color,
      /** Per-faction palette envelope: stable hue per faction, theme-clamped. */
      polityPalette: z.object({
        hueOffset: z.number().min(0).max(360),
        sat: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
        lum: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
        contested: z.enum(["stripe", "blend"]),
        /**
         * Fraction of the hue wheel polities spread over, starting at
         * hueOffset (1 = full wheel). Monochrome themes narrow it so the map
         * stays in-palette; explicit scenario hues are compressed the same way.
         */
        hueSpread: z.number().min(0.05).max(1).default(1),
      }),
    })
    .extend(ThemeMapStyleSchema.shape),
});
export type Theme = z.infer<typeof ThemeSchema>;
