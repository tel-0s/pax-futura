import { create } from "zustand";
import { DEFAULT_THEME_ID } from "../theme/presets.ts";

export type LeftDrawer = "orders" | "inspector" | "forces" | "events" | "search" | "gm" | null;

interface UiState {
  leftDrawer: LeftDrawer;
  conversationsOpen: boolean;
  loomOpen: boolean;
  themeId: string;
  /** "theme" follows the active theme's projection; otherwise a user override. */
  mapProjection: "theme" | "globe" | "mercator";
  /** Whether the dispatch ticker in the dock is expanded. */
  dispatchesOpen: boolean;
  selection: { polityCode?: string; regionId?: string };

  setLeftDrawer: (drawer: LeftDrawer) => void;
  /** Non-toggle open: for "reveal in panel" actions (rail clicks use the toggle). */
  openLeftDrawer: (drawer: Exclude<LeftDrawer, null>) => void;
  toggleConversations: () => void;
  setLoomOpen: (open: boolean) => void;
  setThemeId: (id: string) => void;
  setMapProjection: (projection: UiState["mapProjection"]) => void;
  setDispatchesOpen: (open: boolean) => void;
  setSelection: (selection: UiState["selection"]) => void;
}

const THEME_KEY = "pax-theme";
const PROJECTION_KEY = "pax-map-projection";
const DISPATCHES_KEY = "pax-dispatches-open";

/** localStorage can throw (private mode, blocked storage) — never let it crash boot. */
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preference simply doesn't persist
  }
};

const storedProjection = read(PROJECTION_KEY);

export const useUiStore = create<UiState>((set) => ({
  leftDrawer: null,
  conversationsOpen: true,
  loomOpen: false,
  themeId: read(THEME_KEY) ?? DEFAULT_THEME_ID,
  mapProjection:
    storedProjection === "globe" || storedProjection === "mercator" ? storedProjection : "theme",
  dispatchesOpen: read(DISPATCHES_KEY) !== "0",
  selection: {},

  setLeftDrawer: (drawer) =>
    set((state) => ({ leftDrawer: state.leftDrawer === drawer ? null : drawer })),
  openLeftDrawer: (drawer) => set({ leftDrawer: drawer }),
  toggleConversations: () => set((state) => ({ conversationsOpen: !state.conversationsOpen })),
  setLoomOpen: (open) => set({ loomOpen: open }),
  setThemeId: (id) => {
    write(THEME_KEY, id);
    set({ themeId: id });
  },
  setMapProjection: (mapProjection) => {
    write(PROJECTION_KEY, mapProjection);
    set({ mapProjection });
  },
  setDispatchesOpen: (dispatchesOpen) => {
    write(DISPATCHES_KEY, dispatchesOpen ? "1" : "0");
    set({ dispatchesOpen });
  },
  setSelection: (selection) => set({ selection }),
}));
