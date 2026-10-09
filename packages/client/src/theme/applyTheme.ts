import type { Theme } from "@pax/domain";
import { alpha, mix } from "./color.ts";
import { textureImage } from "./textures.ts";

/**
 * Flatten a validated Theme into `--pf-*` custom properties on <html>.
 * Every component stylesheet consumes only these variables, so switching
 * themes is one function call — no rerender, no rebuild.
 *
 * Beyond the raw tokens, this derives the theme's MATERIAL: translucent panel
 * fills + backdrop filters, glow shadows, heading typography, the chamfer
 * clip-path and the chrome texture — and mirrors the structural choices
 * (corners, ornament, texture) as data attributes that `skins.css` keys on.
 */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(`--pf-${name}`, value);
  const { style } = theme;
  const dark = theme.meta.scheme === "dark";

  theme.color.surface.forEach((color, index) => set(`surface-${index}`, color));
  for (const [key, value] of Object.entries(theme.color.text)) set(`text-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.accent)) set(`accent-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.semantic)) set(`semantic-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.border)) set(`border-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.loom)) set(`loom-${kebab(key)}`, value);

  set("font-ui", theme.font.ui);
  set("font-display", theme.font.display);
  set("font-mono", theme.font.mono);
  set("font-label", theme.map.label.font || theme.font.display);
  set("display-adjust", theme.font.displayAdjust ? String(theme.font.displayAdjust) : "none");
  for (const [key, value] of Object.entries(theme.font.scale)) set(`font-${key}`, value);

  for (let step = 1; step <= 8; step++) {
    set(`space-${step}`, `${theme.space.unit * step}px`);
  }
  for (const [key, value] of Object.entries(theme.radius)) set(`radius-${key}`, value);
  for (const [key, value] of Object.entries(theme.shadow)) set(`shadow-${key}`, value);

  set("map-water", theme.map.water);
  set("map-land", theme.map.land);
  set("map-label", theme.map.label.color);
  set("map-label-halo", theme.map.label.halo);
  set("map-label-tracking", theme.map.label.tracking);
  set("map-label-transform", theme.map.label.case === "uppercase" ? "uppercase" : "none");
  set("map-label-variant", theme.map.label.case === "small-caps" ? "small-caps" : "normal");
  set("map-label-style", theme.map.label.italic ? "italic" : "normal");
  set("map-graticule", theme.map.graticule);
  set("map-selection", theme.map.selectionOutline);

  // ── Material ─────────────────────────────────────────────────────────
  const surface1 = theme.color.surface[1];
  set("panel-bg", alpha(surface1, style.panelOpacity));
  // Nested surfaces (cards in a glass drawer) stay a touch more solid so
  // text never sits on raw map detail.
  set("panel-bg-solid", alpha(surface1, Math.max(style.panelOpacity, 0.94)));
  set("panel-inset", alpha(theme.color.surface[0], dark ? 0.55 : 0.6));
  set(
    "panel-filter",
    style.panelBlur > 0 ? `blur(${style.panelBlur}px) saturate(${dark ? 150 : 170}%)` : "none",
  );
  // A hairline of light along the top edge of raised material.
  set("panel-highlight", dark ? alpha("#ffffff", 0.06) : alpha("#ffffff", 0.7));
  set("scrim", alpha(theme.color.surface[0], dark ? 0.62 : 0.48));

  const glow = style.glow;
  set(
    "glow-accent",
    glow > 0
      ? `0 0 0 1px ${alpha(theme.color.accent.base, 0.25 + glow * 0.2)}, 0 0 ${Math.round(8 + glow * 18)}px ${alpha(theme.color.accent.base, glow * 0.38)}`
      : "none",
  );
  set(
    "text-glow",
    glow > 0 ? `0 0 ${Math.round(4 + glow * 6)}px ${alpha(theme.color.accent.base, glow * 0.55)}` : "none",
  );
  // Phosphor-grade glow lights ALL text, not just accents.
  set(
    "body-glow",
    glow >= 0.8 ? `0 0 5px ${alpha(theme.color.text.primary, 0.35 * glow)}` : "none",
  );

  set("heading-transform", style.heading.case === "uppercase" ? "uppercase" : "none");
  set("heading-variant", style.heading.case === "small-caps" ? "all-small-caps" : "normal");
  set("heading-tracking", style.heading.tracking);
  set("heading-weight", String(style.heading.weight));
  set("fleuron", style.fleuron ? JSON.stringify(style.fleuron) : '""');

  set("cut", style.corners === "chamfer" ? "10px" : "0px");
  set("cut-sm", style.corners === "chamfer" ? "6px" : "0px");

  // Accent tints used for selection washes and gradients.
  set("accent-wash", alpha(theme.color.accent.base, dark ? 0.14 : 0.1));
  set("accent-line", alpha(theme.color.accent.base, 0.55));
  set("accent-deep", mix(theme.color.accent.base, theme.color.surface[0], 0.55));
  for (const [key, value] of Object.entries(theme.color.semantic)) {
    set(`semantic-${key}-wash`, alpha(value, dark ? 0.14 : 0.12));
  }

  set("texture-image", textureImage(style.texture, theme));
  set("texture-opacity", String(style.textureOpacity));
  set(
    "texture-blend",
    style.texture === "paper" ? "multiply" : style.texture === "grain" ? "overlay" : "normal",
  );

  root.dataset.pfScheme = theme.meta.scheme;
  root.dataset.pfTheme = theme.meta.id;
  root.dataset.pfCorners = style.corners;
  root.dataset.pfOrnament = style.ornament;
  root.dataset.pfTexture = style.texture;
  root.dataset.pfFleuron = style.fleuron ? "glyph" : "none";
  root.dataset.pfGlow = glow >= 0.8 ? "high" : glow > 0 ? "low" : "none";
  // Native form controls (select dropdown lists, scrollbars, pickers) follow
  // the theme's scheme instead of the OS default — fixes white-on-white
  // dropdowns on macOS in dark themes.
  root.style.colorScheme = theme.meta.scheme;
  // Browser chrome (mobile address bar, PWA title bar) follows the canvas.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.color.surface[0]);
};

const kebab = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
