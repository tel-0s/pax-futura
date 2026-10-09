import { create } from "zustand";
import { DEFAULT_THEME_ID } from "../theme/presets.ts";

export type LeftDrawer = "orders" | "inspector" | "forces" | "events" | "search" | "gm" | null;

interface UiState {
  leftDrawer: LeftDrawer;
  conversationsOpen: boolean;
  loomOpen: boolean;
  themeId: string;
  selection: { polityCode?: string; regionId?: string };

  setLeftDrawer: (drawer: LeftDrawer) => void;
  /** Non-toggle open: for "reveal in panel" actions (rail clicks use the toggle). */
  openLeftDrawer: (drawer: Exclude<LeftDrawer, null>) => void;
  toggleConversations: () => void;
  setLoomOpen: (open: boolean) => void;
  setThemeId: (id: string) => void;
  setSelection: (selection: UiState["selection"]) => void;
}

const THEME_KEY = "pax-theme";

export const useUiStore = create<UiState>((set) => ({
  leftDrawer: null,
  conversationsOpen: true,
  loomOpen: false,
  themeId: localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID,
  selection: {},

  setLeftDrawer: (drawer) =>
    set((state) => ({ leftDrawer: state.leftDrawer === drawer ? null : drawer })),
  openLeftDrawer: (drawer) => set({ leftDrawer: drawer }),
  toggleConversations: () => set((state) => ({ conversationsOpen: !state.conversationsOpen })),
  setLoomOpen: (open) => set({ loomOpen: open }),
  setThemeId: (id) => {
    localStorage.setItem(THEME_KEY, id);
    set({ themeId: id });
  },
  setSelection: (selection) => set({ selection }),
}));
