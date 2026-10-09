import type { Theme } from "@pax/domain";

/**
 * Flatten a validated Theme into `--pf-*` custom properties on <html>.
 * Every component stylesheet consumes only these variables, so switching
 * themes is one function call — no rerender, no rebuild.
 */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(`--pf-${name}`, value);

  theme.color.surface.forEach((color, index) => set(`surface-${index}`, color));
  for (const [key, value] of Object.entries(theme.color.text)) set(`text-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.accent)) set(`accent-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.semantic)) set(`semantic-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.border)) set(`border-${key}`, value);
  for (const [key, value] of Object.entries(theme.color.loom)) set(`loom-${kebab(key)}`, value);

  set("font-ui", theme.font.ui);
  set("font-display", theme.font.display);
  set("font-mono", theme.font.mono);
  for (const [key, value] of Object.entries(theme.font.scale)) set(`font-${key}`, value);

  for (let step = 1; step <= 8; step++) {
    set(`space-${step}`, `${theme.space.unit * step}px`);
  }
  for (const [key, value] of Object.entries(theme.radius)) set(`radius-${key}`, value);
  for (const [key, value] of Object.entries(theme.shadow)) set(`shadow-${key}`, value);

  set("map-water", theme.map.water);
  set("map-land", theme.map.land);

  root.dataset.pfScheme = theme.meta.scheme;
  root.dataset.pfTheme = theme.meta.id;
  // Native form controls (select dropdown lists, scrollbars, pickers) follow
  // the theme's scheme instead of the OS default — fixes white-on-white
  // dropdowns on macOS in dark themes.
  root.style.colorScheme = theme.meta.scheme;
};

const kebab = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
