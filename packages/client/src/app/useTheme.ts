import { useEffect } from "react";
import { useUiStore } from "../stores/ui.ts";
import { selectTheme, useThemesStore } from "../stores/themes.ts";
import { applyTheme } from "../theme/applyTheme.ts";

/** Keeps the DOM's --pf-* variables in sync with the selected theme. */
export const useTheme = (): void => {
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    void useThemesStore.getState().loadCustom();
  }, []);
};
