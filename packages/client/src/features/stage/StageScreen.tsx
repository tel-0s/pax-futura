import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { TimelineNodeMeta } from "@pax/domain";
import { useGameSession } from "./useGameSession.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore, selectSiblings } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { EventFeed } from "./EventFeed.tsx";
import { LeftRail } from "./LeftRail.tsx";
import { MapStage } from "../map/MapStage.tsx";
import { InspectorDrawer } from "../inspector/InspectorDrawer.tsx";
import { LoomOverlay } from "../loom/LoomOverlay.tsx";
import { LoomStrip } from "../loom/LoomStrip.tsx";
import { ConversationsDrawer } from "../conversation/ConversationsDrawer.tsx";
import { EventCards } from "./EventCards.tsx";
import { OrdersDrawer } from "./OrdersDrawer.tsx";
import { GmDrawer } from "../gm/GmDrawer.tsx";
import { ChronicleDrawer } from "../chronicle/ChronicleDrawer.tsx";
import { ForcesDrawer } from "../forces/ForcesDrawer.tsx";
import { SearchDrawer } from "../search/SearchDrawer.tsx";
import { TurnDialog } from "./TurnDialog.tsx";
import { GazettePanel } from "../gazette/GazettePanel.tsx";
import { focusPolity } from "../../lib/mapController.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import { useWorldStore } from "../../stores/world.ts";
import { Drawer } from "../../components/Drawer.tsx";
import { useThemesStore } from "../../stores/themes.ts";
import { ThemeImportModal } from "../settings/ThemeImportModal.tsx";
import styles from "./StageScreen.module.css";

export function StageScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  useGameSession(gameId);

  const meta = useSessionStore((state) => state.meta);
  const connection = useSessionStore((state) => state.connection);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const pending = useLoomStore((state) => state.pending);
  const { themeId, setThemeId, loomOpen, setLoomOpen, conversationsOpen, toggleConversations } =
    useUiStore();
  const unreadConversations = useConversationsStore((state) => state.unread);
  const navigate = useNavigate();

  // Looking at the drawer is what marks it read — however it was opened.
  useEffect(() => {
    if (conversationsOpen && unreadConversations) {
      useConversationsStore.getState().setUnread(false);
    }
  }, [conversationsOpen, unreadConversations]);

  // "L" toggles the loom overlay (unless typing in an input).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key.toLowerCase() === "l") setLoomOpen(!useUiStore.getState().loomOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setLoomOpen]);

  const current = currentNodeId ? nodes[currentNodeId] : undefined;
  const siblings = currentNodeId ? selectSiblings(nodes, currentNodeId) : [];
  const siblingIndex = siblings.findIndex((node) => node.id === currentNodeId);
  const activeProgress = Object.values(pending)[0];
  const [turnDialogOpen, setTurnDialogOpen] = useState(false);
  const [gazetteOpen, setGazetteOpen] = useState(false);
  const [scout, setScout] = useState<{ parentId: string; known: string[] } | null>(null);

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
    return <div className={styles.stage} />;
  }

  return (
    <div className={styles.stage}>
      <header className={styles.topbar}>
        <span className={styles.brand} onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
          ⬡ Pax Futura
        </span>
        <span
          style={{ cursor: "pointer" }}
          title="Locate my nation (opens inspector)"
          onClick={() => {
            useUiStore.getState().setSelection({ polityCode: meta.playerPolity });
            useUiStore.getState().setLeftDrawer("inspector");
            focusPolity(meta.playerPolity, useWorldStore.getState().world);
          }}
        >
          ⌖ {meta.playerPolity}
        </span>
        <span className={styles.clock}>{current?.gameDate ?? "…"}</span>
        <Button
          variant="ghost"
          title={ghost ? "Decide on the scouted turn first" : "Fast-forward time"}
          disabled={!currentNodeId || Boolean(activeProgress) || Boolean(ghost)}
          onClick={() => setTurnDialogOpen(true)}
        >
          ⏩
        </Button>
        <span
          className={styles.breadcrumb}
          style={{ cursor: "pointer" }}
          title="Open loom (L)"
          onClick={() => setLoomOpen(true)}
        >
          Turn {current?.depth ?? 0}
          {siblings.length > 1 ? ` · branch ${siblingIndex + 1}/${siblings.length}` : ""}
        </span>
        {connection !== "live" ? <Badge tone="warning">{connection}</Badge> : null}
        <span className={styles.spacer} />
        <Button
          variant="ghost"
          onClick={toggleConversations}
          title={unreadConversations ? "Conversations · someone is waiting" : "Conversations"}
        >
          💬{unreadConversations ? <Badge tone="accent">•</Badge> : null}
        </Button>
        <Button
          variant="ghost"
          title="The Gazette"
          disabled={!currentNodeId || Boolean(activeProgress)}
          onClick={() => setGazetteOpen(true)}
        >
          📰
        </Button>
        <ThemePicker themeId={themeId} setThemeId={setThemeId} />
      </header>

      <div className={styles.canvas}>
        <MapStage />
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
        {gazetteOpen && currentNodeId ? (
          <GazettePanel gameId={gameId} nodeId={currentNodeId} onClose={() => setGazetteOpen(false)} />
        ) : null}
      </div>

      <div className={styles.dock}>
        <LoomStrip />
        {current ? <EventFeed gameId={gameId} nodeId={current.id} /> : null}
        {ghost ? (
          <GhostBar
            gameId={gameId}
            ghost={ghost}
            liveNodeId={currentNodeId}
            onDecided={() => setScout(null)}
          />
        ) : null}
        <Composer
          gameId={gameId}
          parentId={currentNodeId}
          progress={activeProgress}
          blocked={Boolean(ghost)}
        />
      </div>
    </div>
  );
}

function ThemePicker({
  themeId,
  setThemeId,
}: {
  themeId: string;
  setThemeId: (id: string) => void;
}) {
  const themes = useThemesStore((state) => state.themes);
  const [importing, setImporting] = useState(false);
  return (
    <>
      <select
        value={themeId}
        onChange={(event) => {
          if (event.target.value === "__import__") setImporting(true);
          else setThemeId(event.target.value);
        }}
      >
        {themes.map((theme) => (
          <option key={theme.meta.id} value={theme.meta.id}>
            {theme.meta.name}
          </option>
        ))}
        <option value="__import__">Import theme…</option>
      </select>
      {importing ? <ThemeImportModal onClose={() => setImporting(false)} /> : null}
    </>
  );
}

/** Exclusive left-drawer host; search is still a stub. */
function StageDrawers() {
  const leftDrawer = useUiStore((state) => state.leftDrawer);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);

  if (!leftDrawer) return null;
  if (leftDrawer === "orders") return <OrdersDrawer />;
  if (leftDrawer === "inspector") return <InspectorDrawer />;
  if (leftDrawer === "gm") return <GmDrawer />;
  if (leftDrawer === "events") return <ChronicleDrawer />;
  if (leftDrawer === "forces") return <ForcesDrawer />;
  if (leftDrawer === "search") return <SearchDrawer />;
  return (
    <Drawer side="left" title={leftDrawer} onClose={() => setLeftDrawer(null)}>
      <p>Coming in a later phase.</p>
    </Drawer>
  );
}

/**
 * Decision bar for a scouted ("ghost") turn: it is already persisted and
 * checked out nowhere. Preview paints its world on the live map, Accept moves
 * the checkout onto it, Discard deletes it. The bar is session state — a page
 * reload loses it, but never the turn: the node is still a child of the
 * current one in the loom, where it can be checked out or deleted.
 */
function GhostBar({
  gameId,
  ghost,
  liveNodeId,
  onDecided,
}: {
  gameId: string;
  ghost: TimelineNodeMeta;
  liveNodeId: string | null;
  onDecided: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Accepting makes the previewed world the live world, so the server's
  // world.changed repaint must not be undone by our own restore.
  const skipRestore = useRef(false);

  const restoreLive = useCallback(() => {
    if (skipRestore.current) return;
    // Only take the map back if it is still showing the ghost — otherwise
    // something newer (a checkout move) already owns the world store.
    if (useWorldStore.getState().forNodeId !== ghost.id) return;
    // Read the checkout LIVE, not from the render-captured prop: checking the
    // ghost out from the loom unmounts this bar in the same commit that moves
    // currentNodeId, and restoring to the STALE id would repaint the old world.
    const live = useLoomStore.getState().currentNodeId ?? liveNodeId;
    if (live === ghost.id) return; // the ghost became canon — nothing to undo
    if (live) void useWorldStore.getState().load(gameId, live);
  }, [gameId, ghost.id, liveNodeId]);

  // Restore on unmount however the bar goes away. Unmount-only via ref so a
  // changing liveNodeId doesn't fire the old cleanup mid-preview (same shape
  // as the loom's TimeLapse).
  const restoreRef = useRef(restoreLive);
  restoreRef.current = restoreLive;
  useEffect(() => () => restoreRef.current(), []);

  // Paint the ghost's snapshot straight into the world store — the same path
  // the loom overlay and TimeLapse use to show a non-checked-out node.
  useEffect(() => {
    if (!previewing) return;
    let cancelled = false;
    void api
      .getWorld(gameId, ghost.id)
      .then((world) => {
        if (cancelled) return;
        useWorldStore.setState({ forNodeId: ghost.id, world, loading: false });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewing, gameId, ghost.id]);

  const decide = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      onDecided();
    } catch (error) {
      setBusy(false);
      skipRestore.current = false;
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.ghostBar}>
      <span className={styles.ghostLabel}>Scouted</span>
      <span className={styles.ghostDate}>{ghost.gameDate}</span>
      <span className={styles.ghostSummary} title={ghost.summary}>
        {ghost.summary || "(no summary)"}
      </span>
      <div className={styles.ghostActions}>
        <Button
          variant={previewing ? "primary" : "default"}
          disabled={busy}
          title="Show this outcome on the map"
          onClick={() => {
            if (previewing) {
              setPreviewing(false);
              restoreLive();
            } else {
              setPreviewing(true);
            }
          }}
        >
          {previewing ? "Previewing" : "Preview"}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          title="Make this turn canon"
          onClick={() => {
            skipRestore.current = true;
            void decide(() => api.acceptNode(gameId, ghost.id));
          }}
        >
          Accept
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          title="Delete this turn and stay where you are"
          onClick={() => void decide(() => api.deleteSubtree(gameId, ghost.id))}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}

function Composer({
  gameId,
  parentId,
  progress,
  blocked,
}: {
  gameId: string;
  parentId: string | null;
  progress: { phase: string; streamedChars: number; lastEventTitle: string } | undefined;
  /** A scouted turn is awaiting a decision — orders would target a stale node. */
  blocked: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const queued = useOrdersStore((state) => state.orders.length);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);

  const submitOrder = async () => {
    if (!parentId || !draft.trim() || submitting || blocked) return;
    setSubmitting(true);
    try {
      await useOrdersStore.getState().submit(gameId, parentId, draft.trim());
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  if (progress) {
    return (
      <div className={styles.composer}>
        <div className={styles.progress}>
          <span className={styles.progressPhase}>{progress.phase}</span>
          <span>{progress.streamedChars} chars</span>
          {progress.lastEventTitle ? <span>⚑ {progress.lastEventTitle}</span> : null}
        </div>
        <Button variant="danger" onClick={() => void api.cancelTurn(gameId)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.orders}
        disabled={blocked}
        placeholder={
          blocked
            ? "Accept or discard the scouted turn to keep giving orders."
            : "Write an order… (⏎ to submit; time advances with ⏩ above)"
        }
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submitOrder();
          }
        }}
      />
      {queued > 0 ? (
        <button
          className={styles.queueChip}
          title="Open order queue"
          onClick={() => setLeftDrawer("orders")}
        >
          {queued} queued
        </button>
      ) : null}
      <Button
        variant="primary"
        disabled={blocked || !parentId || submitting || !draft.trim()}
        onClick={() => void submitOrder()}
      >
        Submit Order
      </Button>
    </div>
  );
}
