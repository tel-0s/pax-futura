import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, GitBranch, MessagesSquare, Newspaper, Palette } from "lucide-react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { BrandMark } from "../../components/BrandMark.tsx";
import { api } from "../../lib/api.ts";
import { formatGameDate } from "../../lib/dates.ts";
import { focusPolity } from "../../lib/mapController.ts";
import { selectSiblings, useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useWorldStore } from "../../stores/world.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { ThemePicker } from "./ThemePicker.tsx";
import styles from "./TopBar.module.css";

/**
 * The command strip: who you are (banner + realm), when you are (the date,
 * turn and branch — with sibling arrows that flip between rerolls), and the
 * instruments (gazette, loom, conversations, theme).
 */
export function TopBar({
  busy,
  onGazette,
}: {
  busy: boolean;
  onGazette: () => void;
}) {
  const navigate = useNavigate();
  const meta = useSessionStore((state) => state.meta);
  const gameId = useSessionStore((state) => state.gameId);
  const connection = useSessionStore((state) => state.connection);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const conversationsOpen = useUiStore((state) => state.conversationsOpen);
  const toggleConversations = useUiStore((state) => state.toggleConversations);
  const setLoomOpen = useUiStore((state) => state.setLoomOpen);
  const unread = useConversationsStore((state) => state.unread);
  const world = useWorldStore((state) => state.world);
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  const [themeOpen, setThemeOpen] = useState(false);

  if (!meta) return null;
  const player = world?.polities[meta.playerPolity];
  const playerColor = world ? buildPolityPalette(theme, world)[meta.playerPolity] : undefined;
  const current = currentNodeId ? nodes[currentNodeId] : undefined;
  const siblings = currentNodeId ? selectSiblings(nodes, currentNodeId) : [];
  const siblingIndex = siblings.findIndex((node) => node.id === currentNodeId);

  const switchSibling = (delta: number) => {
    if (!gameId || busy) return;
    for (let step = 1; step <= siblings.length; step++) {
      const target = siblings[(siblingIndex + delta * step + siblings.length) % siblings.length];
      if (target && target.status === "complete" && target.id !== currentNodeId) {
        void api.setActiveNode(gameId, target.id).then(() => useLoomStore.getState().setCurrent(target.id));
        return;
      }
    }
  };

  return (
    <header className={styles.bar} data-occludes="top">
      <button className={styles.brand} onClick={() => navigate("/")} title="Back to the library">
        <BrandMark size={22} />
        <span className={`${styles.wordmark} pfTitle`}>Pax Futura</span>
      </button>

      <span className={styles.divider} />

      <button
        className={styles.nation}
        title="Your realm — locate and open the dossier"
        onClick={() => {
          useUiStore.getState().setSelection({ polityCode: meta.playerPolity });
          useUiStore.getState().openLeftDrawer("inspector");
          focusPolity(meta.playerPolity, useWorldStore.getState().world);
        }}
      >
        <PolityFlag flag={player?.flag} color={playerColor} size={26} />
        <span className={styles.nationText}>
          <span className={`${styles.nationName} pfTitle`}>{player?.name || meta.playerPolity}</span>
          <span className={styles.nationMeta}>{meta.title}</span>
        </span>
      </button>

      <div className={styles.center}>
        {siblings.length > 1 ? (
          <button className={styles.sibling} onClick={() => switchSibling(-1)} title="Previous branch" disabled={busy}>
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <button className={styles.clock} onClick={() => setLoomOpen(true)} title="Open the loom (L)">
          {/* Keyed on the date: when time advances the new date rises in. */}
          <span key={current?.gameDate ?? "none"} className={`${styles.date} pfTitle pfGlowText`}>
            {current ? formatGameDate(current.gameDate) : "…"}
          </span>
          <span className={styles.turn}>
            Turn {current?.depth ?? 0}
            {siblings.length > 1 ? (
              <span className={styles.branch}>
                <GitBranch size={11} /> {siblingIndex + 1}/{siblings.length}
              </span>
            ) : null}
            {current?.anchor ? <span className={styles.anchor}>· {current.anchor}</span> : null}
          </span>
        </button>
        {siblings.length > 1 ? (
          <button className={styles.sibling} onClick={() => switchSibling(1)} title="Next branch" disabled={busy}>
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>

      <div className={styles.tools}>
        {connection !== "live" ? <Badge tone="warning">{connection}</Badge> : null}
        <Button variant="ghost" icon title="The Gazette" disabled={!currentNodeId || busy} onClick={onGazette}>
          <Newspaper size={18} />
        </Button>
        <Button variant="ghost" icon title="Open the loom (L)" onClick={() => setLoomOpen(true)}>
          <GitBranch size={18} />
        </Button>
        <Button
          variant="ghost"
          icon
          className={conversationsOpen ? styles.toolActive : undefined}
          title={unread ? "Conversations · someone is waiting (M)" : "Conversations (M)"}
          onClick={toggleConversations}
        >
          <MessagesSquare size={18} />
          {unread ? <span className={styles.unread} /> : null}
        </Button>
        <ThemePicker
          open={themeOpen}
          onClose={() => setThemeOpen(false)}
          trigger={
            <Button variant="ghost" icon title="Theme" onClick={() => setThemeOpen(!themeOpen)}>
              <Palette size={18} />
            </Button>
          }
        />
      </div>
    </header>
  );
}
