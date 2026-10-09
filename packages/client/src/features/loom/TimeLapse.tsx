import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, Film, Pause, Play, RotateCcw, StepBack, StepForward, X } from "lucide-react";
import type { TimelineNodeMeta, WorldState } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { formatGameDate, formatGameMonth } from "../../lib/dates.ts";
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

/** Position of step `index` along the scrubber, as a percentage. */
const at = (index: number, count: number): string => `${count > 1 ? (index / (count - 1)) * 100 : 0}%`;

/**
 * Plays the current path's world snapshots on the live map, oldest to
 * newest, by writing each snapshot straight into the world store (the same
 * painting path the overlay's selection uses). Fetched snapshots are cached
 * locally so scrubbing back and forth doesn't refetch, and the next step
 * prefetches while the current one is showing.
 *
 * Presented as a film: the frame's date as a title card over the map, and a
 * transport deck below — play/pause, step, speed, and a scrubber with one
 * tick per turn and a bookmark over every anchored one. Space plays/pauses,
 * ←/→ step (the loom's tree keys are dormant while this is open).
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
  const track = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

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

  // Play from the last frame starts the reel over rather than doing nothing.
  const togglePlay = useCallback(() => {
    if (!playing && index >= steps.length - 1) setIndex(0);
    setPlaying((was) => !was);
  }, [playing, index, steps.length]);

  // Transport keys. Escape stays with the overlay (it closes us); Space and
  // the arrows are ours — the tree's own handler is dormant while we're open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // A focused control already answers Space/Enter itself (the play
      // button would toggle twice); fields keep their keys entirely.
      if (target && ["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Scrubbing: press/drag anywhere on the track to jump frames (pauses).
  const scrubTo = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || steps.length === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    setIndex(Math.round(ratio * (steps.length - 1)));
  };
  const onScrubStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPlaying(false);
    scrubTo(event.clientX);
  };
  const onScrubMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) scrubTo(event.clientX);
  };
  const onScrubEnd = () => {
    scrubbing.current = false;
  };

  if (!node) {
    return (
      <div className={`${styles.empty} pfPanel`}>
        <Film size={24} className={styles.emptyIcon} />
        <p className={styles.emptyText}>Nothing to play back yet — complete a turn first.</p>
        <Button variant="ghost" size="sm" onClick={onClose} title="Back to the tree (Esc)">
          <X size={14} /> Back to the loom
        </Button>
      </div>
    );
  }

  const first = steps[0]!;
  const last = steps[steps.length - 1]!;

  return (
    <div className={styles.player} data-passthrough>
      <div className={styles.letterbox} aria-hidden />

      <div className={styles.titleCard} aria-live="polite">
        <span className={`${styles.reel} pfKicker`}>
          <span className={`${styles.recDot} ${playing ? styles.recLive : ""}`} />
          Time-lapse · Turn {node.depth}
        </span>
        <span key={node.id} className={`${styles.frameDate} pfTitle pfGlowText`}>
          {node.depth === 0 ? "Scenario start" : formatGameDate(node.gameDate)}
        </span>
        {node.anchor ? (
          <span className={styles.frameAnchor}>
            <Bookmark size={13} /> {node.anchor}
          </span>
        ) : null}
        {node.summary && node.depth > 0 ? (
          <p key={`${node.id}-summary`} className={styles.frameSummary}>
            {node.summary}
          </p>
        ) : null}
      </div>

      <div className={`${styles.deck} pfPanel`}>
        <div className={styles.transport}>
          <Button variant="ghost" size="sm" icon disabled={atStart} onClick={() => step(-1)} title="Step back (←)" aria-label="Step back">
            <StepBack size={15} />
          </Button>
          <button
            className={`${styles.play} pfChamfer`}
            onClick={togglePlay}
            title={playing ? "Pause (Space)" : atEnd ? "Replay from the start (Space)" : "Play (Space)"}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={18} /> : atEnd ? <RotateCcw size={17} /> : <Play size={18} />}
          </button>
          <Button variant="ghost" size="sm" icon disabled={atEnd} onClick={() => step(1)} title="Step forward (→)" aria-label="Step forward">
            <StepForward size={15} />
          </Button>
        </div>

        <div className={styles.scrubber}>
          <div
            ref={track}
            className={styles.track}
            role="slider"
            aria-label="Turn"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-valuetext={formatGameDate(node.gameDate)}
            onPointerDown={onScrubStart}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
          >
            <span className={styles.rail} />
            <span className={styles.fill} style={{ width: at(index, steps.length) }} />
            {steps.map((candidate, position) => (
              <span
                key={candidate.id}
                className={`${styles.tick} ${position <= index ? styles.tickPast : ""}`}
                style={{ left: at(position, steps.length) }}
              />
            ))}
            {steps.map((candidate, position) =>
              candidate.anchor ? (
                <span
                  key={`${candidate.id}-anchor`}
                  className={`${styles.anchorMark} ${position <= index ? styles.anchorPast : ""}`}
                  style={{ left: at(position, steps.length) }}
                  title={`${candidate.anchor} — ${formatGameDate(candidate.gameDate)}`}
                >
                  <Bookmark size={11} />
                </span>
              ) : null,
            )}
            <span className={styles.playhead} style={{ left: at(index, steps.length) }} />
          </div>
          <div className={styles.scale}>
            <span>{formatGameMonth(first.gameDate)}</span>
            <span>{formatGameMonth(last.gameDate)}</span>
          </div>
        </div>

        <div className={styles.speeds} role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((candidate) => (
            <button
              key={candidate}
              role="radio"
              aria-checked={speed === candidate}
              className={`${styles.speed} ${speed === candidate ? styles.speedActive : ""}`}
              onClick={() => setSpeed(candidate)}
              title={`${candidate}× speed`}
            >
              {candidate}×
            </button>
          ))}
        </div>

        <span className={styles.counter}>
          <span className={styles.counterNow}>{index + 1}</span>
          <span className={styles.counterOf}>/ {steps.length}</span>
        </span>

        <span className={styles.deckRule} />
        <Button variant="ghost" icon onClick={onClose} title="Back to the tree (Esc)" aria-label="Close time-lapse">
          <X size={18} />
        </Button>
      </div>
    </div>
  );
}
