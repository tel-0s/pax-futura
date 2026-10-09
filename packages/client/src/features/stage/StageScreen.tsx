import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useGameSession } from "./useGameSession.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import { LeftRail, RAIL_ITEMS } from "./LeftRail.tsx";
import { TopBar } from "./TopBar.tsx";
import { Dock } from "./Dock.tsx";
import { MapStage } from "../map/MapStage.tsx";
import { InspectorDrawer } from "../inspector/InspectorDrawer.tsx";
import { LoomOverlay } from "../loom/LoomOverlay.tsx";
import { ConversationsDrawer } from "../conversation/ConversationsDrawer.tsx";
import { EventCards } from "./EventCards.tsx";
import { OrdersDrawer } from "./OrdersDrawer.tsx";
import { GmDrawer } from "../gm/GmDrawer.tsx";
import { ChronicleDrawer } from "../chronicle/ChronicleDrawer.tsx";
import { ForcesDrawer } from "../forces/ForcesDrawer.tsx";
import { SearchDrawer } from "../search/SearchDrawer.tsx";
import { TurnDialog } from "./TurnDialog.tsx";
import { ShortcutsModal } from "./ShortcutsModal.tsx";
import { formatGameDate } from "../../lib/dates.ts";
import { useWorldStore } from "../../stores/world.ts";
import { GazettePanel } from "../gazette/GazettePanel.tsx";
import { useOrdersStore } from "../../stores/orders.ts";
import styles from "./StageScreen.module.css";

/**
 * The play surface: the map runs full-bleed beneath everything; the top bar,
 * rail, drawers and dock float over it in the theme's material (glass on the
 * deck, paper on the atlas) so the world is always the backdrop.
 */
export function StageScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  useGameSession(gameId);

  const meta = useSessionStore((state) => state.meta);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const pending = useLoomStore((state) => state.pending);
  const loomOpen = useUiStore((state) => state.loomOpen);
  const setLoomOpen = useUiStore((state) => state.setLoomOpen);
  const conversationsOpen = useUiStore((state) => state.conversationsOpen);
  const unreadConversations = useConversationsStore((state) => state.unread);

  const activeProgress = Object.values(pending)[0];
  const [turnDialogOpen, setTurnDialogOpen] = useState(false);
  const [gazetteOpen, setGazetteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scout, setScout] = useState<{ parentId: string; known: string[] } | null>(null);

  // Looking at the drawer is what marks it read — however it was opened.
  useEffect(() => {
    if (conversationsOpen && unreadConversations) {
      useConversationsStore.getState().setUnread(false);
    }
  }, [conversationsOpen, unreadConversations]);

  // A scouted turn lands over SSE like any other node, but the checkout never
  // moves: the ghost is the scouted parent's newly-complete child that isn't
  // checked out. Derived from the tree rather than from the POST response
  // because SSE is the authority on node state (and the response body is
  // dropped by the shared request helper when it has no schema).
  const ghost = scout
    ? Object.values(nodes).find(
        (node) =>
          node.parentId === scout.parentId &&
          node.status === "complete" &&
          node.id !== currentNodeId &&
          !scout.known.includes(node.id),
      )
    : undefined;

  const canAdvance = Boolean(currentNodeId) && !activeProgress && !ghost;

  // Keyboard: L loom, T advance time, M conversations, rail letters open
  // drawers, Escape closes the left drawer — never while typing or when a
  // modal/overlay owns the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector("[aria-modal='true']")) return;
      const ui = useUiStore.getState();
      if (ui.loomOpen) {
        if (event.key.toLowerCase() === "l") ui.setLoomOpen(false);
        return;
      }
      if (useEventCardsStore.getState().open && event.key === "Escape") return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "?") return setShortcutsOpen(true);
      if (key === "l") return ui.setLoomOpen(true);
      if (key === "m") return ui.toggleConversations();
      if (key === "t") {
        if (canAdvance) setTurnDialogOpen(true);
        return;
      }
      if (key === "Escape" && ui.leftDrawer) return ui.setLeftDrawer(null);
      const rail = RAIL_ITEMS.find((item) => item.hotkey.toLowerCase() === key);
      if (rail) {
        event.preventDefault();
        ui.setLeftDrawer(rail.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAdvance, setLoomOpen]);

  const beginScout = (parentId: string, request: Promise<unknown>) => {
    setScout({
      parentId,
      known: Object.values(useLoomStore.getState().nodes)
        .filter((node) => node.parentId === parentId)
        .map((node) => node.id),
    });
    // A failed or cancelled scout leaves a failed node (or nothing) behind,
    // never a ghost — stop watching so the composer unblocks.
    void request.catch(() => setScout(null));
  };

  // The tab says where (and when) you are: "Order of the Seraph · 2 July 1228".
  const playerName = useWorldStore((state) =>
    meta ? state.world?.polities[meta.playerPolity]?.name || meta.playerPolity : "",
  );
  const currentDate = currentNodeId ? nodes[currentNodeId]?.gameDate : undefined;
  useEffect(() => {
    if (!meta) return;
    document.title = `${playerName}${currentDate ? ` · ${formatGameDate(currentDate)}` : ""} — Pax Futura`;
    return () => {
      document.title = "Pax Futura";
    };
  }, [meta, playerName, currentDate]);

  // A scout is only undecided while we're still standing at the node it was
  // launched from — accepting it, or checking out anywhere else, ends it.
  useEffect(() => {
    if (scout && currentNodeId !== scout.parentId) setScout(null);
  }, [scout, currentNodeId]);

  // Orders live on the checked-out node; reload when it changes or a turn
  // consumes the queue (world.changed empties it server-side).
  useEffect(() => {
    if (gameId && currentNodeId) void useOrdersStore.getState().load(gameId, currentNodeId);
  }, [gameId, currentNodeId]);

  if (!gameId || !meta) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingMark} />
        <span className="pfKicker">Unrolling the map…</span>
      </div>
    );
  }

  return (
    <div className={styles.stage} data-stage>
      <div className={styles.mapLayer}>
        <MapStage />
      </div>

      <TopBar busy={Boolean(activeProgress)} onGazette={() => setGazetteOpen(true)} />

      <div className={styles.canvas}>
        <LeftRail />
        <StageDrawers />
        <EventCards />
        {conversationsOpen ? <ConversationsDrawer /> : null}
        {loomOpen ? <LoomOverlay /> : null}
        {turnDialogOpen && currentNodeId ? (
          <TurnDialog
            gameId={gameId}
            parentId={currentNodeId}
            onClose={() => setTurnDialogOpen(false)}
            onScout={(request) => beginScout(currentNodeId, request)}
          />
        ) : null}
        {shortcutsOpen ? <ShortcutsModal onClose={() => setShortcutsOpen(false)} /> : null}
        {gazetteOpen && currentNodeId ? (
          <GazettePanel gameId={gameId} nodeId={currentNodeId} onClose={() => setGazetteOpen(false)} />
        ) : null}
      </div>

      <Dock
        gameId={gameId}
        nodeId={currentNodeId}
        progress={activeProgress}
        ghost={ghost}
        onAdvance={() => canAdvance && setTurnDialogOpen(true)}
        onGhostDecided={() => setScout(null)}
      />
    </div>
  );
}

/** Exclusive left-drawer host. */
function StageDrawers() {
  const leftDrawer = useUiStore((state) => state.leftDrawer);
  if (leftDrawer === "orders") return <OrdersDrawer />;
  if (leftDrawer === "inspector") return <InspectorDrawer />;
  if (leftDrawer === "gm") return <GmDrawer />;
  if (leftDrawer === "events") return <ChronicleDrawer />;
  if (leftDrawer === "forces") return <ForcesDrawer />;
  if (leftDrawer === "search") return <SearchDrawer />;
  return null;
}
