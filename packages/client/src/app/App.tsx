import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useTheme } from "./useTheme.ts";
import { LibraryScreen } from "../features/library/LibraryScreen.tsx";
import { StageScreen } from "../features/stage/StageScreen.tsx";
import { ThemeLab } from "../features/dev/ThemeLab.tsx";

export function App() {
  useTheme();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryScreen />} />
        <Route path="/game/:gameId" element={<StageScreen />} />
        <Route path="/game/:gameId/n/:nodeId" element={<StageScreen />} />
        <Route path="/dev/themes" element={<ThemeLab />} />
      </Routes>
      {/* The theme's chrome material (paper, grain, scanlines) — one fixed,
          click-through layer over everything; hidden when the theme has none. */}
      <div className="pfTextureOverlay" aria-hidden />
    </BrowserRouter>
  );
}
