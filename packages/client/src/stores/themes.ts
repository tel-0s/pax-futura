import { create } from "zustand";
import { z } from "zod";
import { ThemeSchema, type Theme } from "@pax/domain";
import { DEFAULT_THEME_ID, PRESET_THEMES } from "../theme/presets.ts";

interface ThemesState {
  /** Shipped presets + server-stored custom themes. */
  themes: Theme[];
  loadCustom: () => Promise<void>;
  /** Validate + persist a user theme; returns it on success. */
  importTheme: (json: string) => Promise<Theme>;
  removeCustom: (id: string) => Promise<void>;
}

export const useThemesStore = create<ThemesState>((set) => ({
  themes: [...PRESET_THEMES],

  loadCustom: async () => {
    try {
      const res = await fetch("/api/themes");
      if (!res.ok) return;
      const customs = z.array(ThemeSchema).parse(await res.json());
      set({
        themes: [
          ...PRESET_THEMES,
          ...customs.filter((custom) => !PRESET_THEMES.some((p) => p.meta.id === custom.meta.id)),
        ],
      });
    } catch {
      // Offline or invalid rows: presets still work.
    }
  },

  importTheme: async (json) => {
    const theme = ThemeSchema.parse(JSON.parse(json));
    if (PRESET_THEMES.some((preset) => preset.meta.id === theme.meta.id)) {
      throw new Error(`"${theme.meta.id}" is a built-in preset id — pick another meta.id.`);
    }
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(theme),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? "Import failed");
    }
    set((state) => ({
      themes: [...state.themes.filter((entry) => entry.meta.id !== theme.meta.id), theme],
    }));
    return theme;
  },

  removeCustom: async (id) => {
    await fetch(`/api/themes/${id}`, { method: "DELETE" });
    set((state) => ({ themes: state.themes.filter((entry) => entry.meta.id !== id) }));
  },
}));

export const selectTheme = (themes: readonly Theme[], id: string): Theme =>
  themes.find((theme) => theme.meta.id === id) ??
  themes.find((theme) => theme.meta.id === DEFAULT_THEME_ID) ??
  themes[0]!;
