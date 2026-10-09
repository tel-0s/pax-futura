import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Eye,
  FastForward,
  Ghost,
  ListTodo,
  Send,
  Square,
  Trash,
} from "lucide-react";
import type { GameEvent, TimelineNodeMeta } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { formatDayMonth, formatGameDate } from "../../lib/dates.ts";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import { useLoomStore, type TurnProgress } from "../../stores/loom.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { LoomStrip } from "../loom/LoomStrip.tsx";
import styles from "./Dock.module.css";

/**
 * The bottom deck: the timeline strip, this turn's dispatches as a ticker of
 * cards, and the command line — write orders, then Advance Time. While the
 * world turns, the command line becomes the live progress of the simulation.
 * Its measured height is published as --pf-dock-h so map furniture can sit
 * clear of it.
 */
export function Dock({
  gameId,
  nodeId,
  progress,
  ghost,
  onAdvance,
  onGhostDecided,
}: {
  gameId: string;
  nodeId: string | null;
  progress: TurnProgress | undefined;
  ghost: TimelineNodeMeta | undefined;
  onAdvance: () => void;
  onGhostDecided: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const host = node?.closest<HTMLElement>("[data-stage]");
    if (!node || !host) return;
    const publish = () => host.style.setProperty("--pf-dock-h", `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${styles.dock} pfPanel`} data-occludes="bottom">
      <LoomStrip />
      {nodeId ? <Dispatches gameId={gameId} nodeId={nodeId} /> : null}
      {ghost ? (
        <GhostBar gameId={gameId} ghost={ghost} liveNodeId={nodeId} onDecided={onGhostDecided} />
      ) : null}
      <CommandLine
        gameId={gameId}
        parentId={nodeId}
        progress={progress}
        blocked={Boolean(ghost)}
        onAdvance={onAdvance}
      />
    </div>
  );
}

/** This turn's events as a horizontal ticker; click a card to walk them on the map. */
function Dispatches({ gameId, nodeId }: { gameId: string; nodeId: string }) {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const open = useUiStore((state) => state.dispatchesOpen);
  const setOpen = useUiStore((state) => state.setDispatchesOpen);
  const activeIndex = useEventCardsStore((state) => (state.open ? state.index : -1));
  const activeNode = useEventCardsStore((state) => state.nodeId);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listNodeEvents(gameId, nodeId)
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("dispatch load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, nodeId]);

  // Keep the card being walked in view.
  useEffect(() => {
    if (activeIndex < 0) return;
    const card = scroller.current?.children[activeIndex] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIndex]);

  // Vertical wheel scrolls the ticker sideways.
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  }, []);

  if (events.length === 0) return null;
  const pivotal = events.filter((event) => event.importance !== "minor").length;

  return (
    <section className={styles.dispatches}>
      <button className={styles.dispatchHeader} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="pfKicker">Dispatches</span>
        <span className={styles.dispatchCount}>{events.length}</span>
        {pivotal > 0 ? <span className={styles.dispatchMajor}>{pivotal} major</span> : null}
        <span className={styles.dispatchToggle}>{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
      </button>
      {open ? (
        <div ref={scroller} className={styles.ticker} onWheel={onWheel}>
          {events.map((event, index) => (
            <button
              key={event.id}
              className={[
                styles.card,
                styles[event.importance],
                event.playerRelated ? styles.mine : "",
                activeNode === nodeId && activeIndex === index ? styles.cardActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => useEventCardsStore.getState().show(events, index)}
              title={event.description || event.title}
            >
              <span className={styles.cardMeta}>
                <span className={styles.cardDot} />
                {formatDayMonth(event.date)}
                {event.playerRelated ? <span className={styles.cardYou}>you</span> : null}
                {event.lng !== undefined ? <span className={styles.cardPin}>⌖</span> : null}
              </span>
              <span className={styles.cardTitle}>{event.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const PHASES: Array<{ id: TurnProgress["phase"]; label: string }> = [
  { id: "assembling", label: "Briefing" },
  { id: "generating", label: "Simulating" },
  { id: "repairing", label: "Revising" },
  { id: "reconciling", label: "Mapping" },
  { id: "applying", label: "Recording" },
];

function CommandLine({
  gameId,
  parentId,
  progress,
  blocked,
  onAdvance,
}: {
  gameId: string;
  parentId: string | null;
  progress: TurnProgress | undefined;
  /** A scouted turn is awaiting a decision — orders would target a stale node. */
  blocked: boolean;
  onAdvance: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const queued = useOrdersStore((state) => state.orders.length);
  const openLeftDrawer = useUiStore((state) => state.openLeftDrawer);
  const input = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~5 lines.
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [draft]);

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
    const phaseIndex = PHASES.findIndex((phase) => phase.id === progress.phase);
    return (
      <div className={`${styles.command} ${styles.progress}`}>
        <div className={styles.progressBody}>
          <div className={styles.phases}>
            {PHASES.map((phase, index) => (
              <span
                key={phase.id}
                className={[
                  styles.phase,
                  index < phaseIndex ? styles.phaseDone : "",
                  index === phaseIndex ? styles.phaseNow : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={styles.phaseDot} />
                {phase.label}
              </span>
            ))}
            <span className={styles.chars}>{progress.streamedChars.toLocaleString()} chars</span>
          </div>
          <div className={styles.bar}>
            <span className={styles.barFill} />
          </div>
          <div className={styles.headline}>
            {progress.lastEventTitle ? (
              <>
                <span className="pfKicker">Latest</span> <span key={progress.lastEventTitle} className={styles.headlineText}>{progress.lastEventTitle}</span>
              </>
            ) : (
              <span className={styles.headlineWait}>The world turns…</span>
            )}
          </div>
        </div>
        <Button variant="danger" onClick={() => void api.cancelTurn(gameId)}>
          <Square size={13} /> Halt
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.command}>
      <div className={`${styles.composer} ${blocked ? styles.composerBlocked : ""}`}>
        <span className={styles.prompt} aria-hidden>
          ›
        </span>
        <textarea
          ref={input}
          rows={1}
          className={styles.orders}
          disabled={blocked}
          placeholder={
            blocked
              ? "Accept or discard the scouted turn to keep giving orders."
              : "Issue an order to your realm…"
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
          <button className={styles.queueChip} title="Open the order queue (O)" onClick={() => openLeftDrawer("orders")}>
            <ListTodo size={13} /> {queued} queued
          </button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked || !parentId || submitting || !draft.trim()}
          onClick={() => void submitOrder()}
          title="Queue this order (Enter)"
        >
          {draft.trim() ? <Send size={14} /> : <CornerDownLeft size={14} />} Queue
        </Button>
      </div>
      <button
        className={`${styles.advance} pfChamfer`}
        disabled={!parentId || blocked}
        onClick={onAdvance}
        title={blocked ? "Decide on the scouted turn first" : "Advance time (T)"}
      >
        <FastForward size={18} />
        <span className={styles.advanceText}>
          <span className={styles.advanceLabel}>Advance time</span>
          <span className={styles.advanceSub}>
            {queued > 0 ? `${queued} order${queued === 1 ? "" : "s"} ready` : "no orders queued"}
          </span>
        </span>
      </button>
    </div>
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
      <span className={styles.ghostLabel}>
        <Ghost size={14} /> Scouted
      </span>
      <span className={styles.ghostDate}>{formatGameDate(ghost.gameDate)}</span>
      <span className={styles.ghostSummary} title={ghost.summary}>
        {ghost.summary || "(no summary)"}
      </span>
      <div className={styles.ghostActions}>
        <Button
          size="sm"
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
          <Eye size={13} /> {previewing ? "Previewing" : "Preview"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          title="Make this turn canon"
          onClick={() => {
            skipRestore.current = true;
            void decide(() => api.acceptNode(gameId, ghost.id));
          }}
        >
          <Check size={13} /> Accept
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          title="Delete this turn and stay where you are"
          onClick={() => void decide(() => api.deleteSubtree(gameId, ghost.id))}
        >
          <Trash size={13} /> Discard
        </Button>
      </div>
    </div>
  );
}
