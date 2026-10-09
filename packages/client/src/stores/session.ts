import { create } from "zustand";
import type { GameMeta } from "@pax/domain";

interface SessionState {
  gameId: string | null;
  meta: GameMeta | null;
  connection: "idle" | "live" | "reconnecting";

  setGame: (gameId: string | null, meta: GameMeta | null) => void;
  setMeta: (meta: GameMeta) => void;
  setConnection: (connection: SessionState["connection"]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  gameId: null,
  meta: null,
  connection: "idle",

  setGame: (gameId, meta) => set({ gameId, meta }),
  setMeta: (meta) => set({ meta }),
  setConnection: (connection) => set({ connection }),
}));
