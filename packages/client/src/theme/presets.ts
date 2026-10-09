import { ThemeSchema, type Theme } from "@pax/domain";
import commandDeck from "./presets/command-deck.json";
import parchment from "./presets/parchment.json";
import daylight from "./presets/daylight.json";
import seraphim from "./presets/seraphim.json";

/** Shipped presets, validated at module load so a bad edit fails loudly. */
export const PRESET_THEMES: readonly Theme[] = [
  ThemeSchema.parse(commandDeck),
  ThemeSchema.parse(seraphim),
  ThemeSchema.parse(parchment),
  ThemeSchema.parse(daylight),
];

export const DEFAULT_THEME_ID = "command-deck";

export const getPreset = (id: string): Theme =>
  PRESET_THEMES.find((theme) => theme.meta.id === id) ??
  PRESET_THEMES.find((theme) => theme.meta.id === DEFAULT_THEME_ID)!;
