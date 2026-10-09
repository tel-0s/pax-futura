import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineNodeMeta, WorldState } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useWorldStore } from "../../stores/world.ts";
import { Button } from "../../components/Button.tsx";
import styles from "./TimeLapse.module.css";

const STEP_MS = 700;
type Speed = 1 | 2 | 4;
const SPEEDS: Speed[] = [1, 2, 4];

/** Root -> current-node chronology. Non-complete nodes have no snapshot to
 *  show, so they're simply not steps (equivalent to skipping them). */
function pathToCurrent(
  nodes: Record<string, TimelineNodeMeta>,
  currentNodeId: string | null,
): TimelineNodeMeta[] {
  const path: TimelineNodeMeta[] = [];
  let cursor = currentNodeId ? nodes[currentNodeId] : undefined;
  while (cursor) {
    path.push(cursor);
    cursor = cursor.parentId !== null ? nodes[cursor.parentId] : undefined;
  }
  return path.reverse();
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Plays the current path's world snapshots on the live map, oldest to
 * newest, by writing each snapshot straight
 * into the world store (the same painting path the overlay's selection uses). Fetched snapshots are cached locally so
 * scrubbing back and forth doesn't refetch, and the next step prefetches
 * while the current one is showing.
 */
export function TimeLapse({ onClose }: { onClose: () => void }) {
  const gameId = useSessionStore((state) => state.gameId);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);

  const steps = useMemo(
    () => pathToCurrent(nodes, currentNodeId).filter((node) => node.status === "complete"),
    [nodes, currentNodeId],
  );

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const cache = useRef(new Map<string, WorldState>());

  const restoreLive = useCallback(() => {
    if (gameId && currentNodeId) void useWorldStore.getState().load(gameId, currentNodeId);
  }, [gameId, currentNodeId]);

  // Whatever closes us — the ✕ here or the whole loom overlay — the live
  // world (not some mid-playback snapshot) must be what the map shows next.
  // Unmount-only via ref: keying the cleanup on restoreLive would fire the
  // OLD cleanup whenever currentNodeId changes (a turn completing mid-
  // playback), yanking the map to the live world in the middle of a frame.
  const restoreRef = useRef(restoreLive);
  restoreRef.current = restoreLive;
  useEffect(() => () => restoreRef.current(), []);

  // steps can shrink under us (node deleted over SSE, checkout moved the
  // path) — an out-of-range index must not strand the scrubber on "nothing".
  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(steps.length - 1, 0)));
  }, [steps.length]);

  const fetchWorld = useCallback(
    async (nodeId: string): Promise<WorldState | null> => {
      const cached = cache.current.get(nodeId);
      if (cached) return cached;
      if (!gameId) return null;
      try {
        const world = await api.getWorld(gameId, nodeId);
        cache.current.set(nodeId, world);
        return world;
      } catch {
        return null;
      }
    },
    [gameId],
  );

  // Paint the current step and prefetch the next one in the background.
  useEffect(() => {
    const node = steps[index];
    if (!node || !gameId) return;
    let cancelled = false;
    void fetchWorld(node.id).then((world) => {
      if (cancelled || !world) return;
      useWorldStore.setState({ forNodeId: node.id, world, loading: false });
    });
    const next = steps[index + 1];
    if (next) void fetchWorld(next.id);
    return () => {
      cancelled = true;
    };
  }, [index, steps, gameId, fetchWorld]);

  // Advance one step every STEP_MS/speed while playing; settle on the live
  // world once playback reaches the end.
  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      restoreLive();
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setIndex((current) => Math.min(current + 1, steps.length - 1));
    }, STEP_MS / speed);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, index, speed, steps.length, restoreLive]);

  const node = steps[index];
  const atStart = index === 0;
  const atEnd = index >= steps.length - 1;

  const step = (delta: number) => {
    setPlaying(false);
    setIndex((current) => Math.min(Math.max(current + delta, 0), steps.length - 1));
  };

  if (!node) {
    return (
      <div className={styles.card}>
        <span>Nothing to play back yet.</span>
        <Button variant="ghost" onClick={onClose} title="Close time-lapse">
          ✕
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.info}>
        <span className={styles.date}>{node.depth === 0 ? "Start" : node.gameDate}</span>
        <span className={styles.turn}>Turn {node.depth}</span>
        {node.anchor ? (
          <span className={styles.anchor} title={node.anchor}>
            🔖 {truncate(node.anchor, 24)}
          </span>
        ) : null}
      </div>
      <div className={styles.progress}>
        <div
          className={styles.progressFill}
          style={{ width: `${((index + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div className={styles.controls}>
        <button className={styles.iconButton} disabled={atStart} onClick={() => step(-1)} title="Step back">
          ⏮
        </button>
        <button
          className={styles.iconButton}
          onClick={() => setPlaying((was) => !was)}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "⏵"}
        </button>
        <button className={styles.iconButton} disabled={atEnd} onClick={() => step(1)} title="Step forward">
          ⏭
        </button>
        <span className={styles.speeds}>
          {SPEEDS.map((candidate) => (
            <button
              key={candidate}
              className={`${styles.speedButton} ${speed === candidate ? styles.speedActive : ""}`}
              onClick={() => setSpeed(candidate)}
            >
              x{candidate}
            </button>
          ))}
        </span>
        <span className={styles.step}>
          {index + 1} / {steps.length}
        </span>
        <Button variant="ghost" onClick={onClose} title="Close time-lapse">
          ✕
        </Button>
      </div>
    </div>
  );
}
