import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Theme fonts, bundled by Vite (local-first — no CDN at runtime). @font-face
// only downloads a face when a theme actually uses it, so shipping every
// theme's families costs nothing until that theme is picked.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "@fontsource/barlow-semi-condensed/700.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource-variable/eb-garamond/wght.css";
import "@fontsource-variable/eb-garamond/wght-italic.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/vt323/400.css";
import "../theme/tokens.css";
import "../theme/skins.css";
import { App } from "./App.tsx";
import { useWorldStore } from "../stores/world.ts";
import { useLoomStore } from "../stores/loom.ts";
import { useUiStore } from "../stores/ui.ts";
import { useSessionStore } from "../stores/session.ts";
import { useEventCardsStore } from "../stores/eventCards.ts";

// Dev-only handles for poking live state from the console / test drivers
// (a dynamic import() from the console can get a different module instance
// than the app once HMR has stamped URLs).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __pax: { useWorldStore, useLoomStore, useUiStore, useSessionStore, useEventCardsStore },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
