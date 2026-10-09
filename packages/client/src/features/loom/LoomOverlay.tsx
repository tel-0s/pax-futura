import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  CornerDownLeft,
  Flag,
  Ghost,
  GitBranch,
  GitCompareArrows,
  LoaderCircle,
  MessagesSquare,
  Play,
  RefreshCw,
  Trash,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ThemeStyle, TimelineNodeMeta } from "@pax/domain";
import { TreeCanvas, type TreeEdgeShape } from "../../components/tree/TreeCanvas.tsx";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { formatGameDate } from "../../lib/dates.ts";
import { selectCurrentPath, selectSiblings, useLoomStore, type TurnProgress } from "../../stores/loom.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { useSessionStore } from "../../stores/session.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { TimeLapse } from "./TimeLapse.tsx";
import { SiblingDiff } from "./SiblingDiff.tsx";
import { useNodeFingerprint } from "./fingerprintCache.ts";
import styles from "./LoomOverlay.module.css";

const NODE_WIDTH = 232;
const NODE_HEIGHT = 114;
/** Wide enough for routed elbows, tall enough for an anchor ribbon to hang
 *  above a card without touching the sibling over it. */
const GAP_X = 64;
const GAP_Y = 34;
/** The header bar and the selection plate float over the canvas; centering
 *  and keyboard reveal aim for the band between them. */
const INSETS = { top: 84, bottom: 140 };

/** Interactions the selection plate can be in besides plain inspection. */
type PlateMode = "anchor" | "delete" | null;

const PHASE_LABELS: Record<TurnProgress["phase"], string> = {
  assembling: "Briefing",
  generating: "Simulating",
  repairing: "Revising",
  reconciling: "Mapping",
  applying: "Recording",
};

/** Connector geometry follows the theme's material: glass and editorial
 *  themes curve, machined ones route at 45°, the atlas draws genealogy
 *  elbows, and a square-cornered screen draws straight vector fans. */
const edgeShapeFor = (style: ThemeStyle): TreeEdgeShape => {
  if (style.corners === "chamfer") return "chamfer";
  if (style.corners === "round") return "curve";
  return style.ornament === "double-rule" ? "elbow" : "fan";
};

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return Boolean(
    element && (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.isContentEditable),
  );
};

/**
 * The navigable timeline tree. The map stays live underneath the scrim and
 * previews the selected node, so branching feels consequential. Click =
 * select + preview; double-click/Enter = check out; ↻ = regenerate a sibling.
 * The selection plate at the foot spells out the selected turn and carries
 * its actions (check out, compare, anchor, re-roll, delete).
 */
export function LoomOverlay() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const pending = useLoomStore((state) => state.pending);
  const setLoomOpen = useUiStore((state) => state.setLoomOpen);
  const themeId = useUiStore((state) => state.themeId);
  const themes = useThemesStore((state) => state.themes);
  const world = useWorldStore((state) => state.world);
  const theme = useMemo(() => selectTheme(themes, themeId), [themes, themeId]);
  // Fingerprint bars need a palette, but each node has its own (unfetched)
  // world snapshot — colors are stable per polity code regardless of which
  // snapshot supplies them, so the currently-loaded world is close enough.
  const palette = useMemo(() => (world ? buildPolityPalette(theme, world) : {}), [theme, world]);
  const polityNames = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(world?.polities ?? {}).map(([code, polity]) => [code, polity.name || code]),
      ),
    [world],
  );

  const [selectedId, setSelectedId] = useState(currentNodeId);
  const [mode, setMode] = useState<PlateMode>(null);
  const [timeLapseOpen, setTimeLapseOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const items = useMemo(() => Object.values(nodes), [nodes]);
  const pathIds = useMemo(
    () => new Set(selectCurrentPath({ nodes, currentNodeId }).map((node) => node.id)),
    [nodes, currentNodeId],
  );
  // Root → checkout only (the "present line"); pathIds also runs on along
  // remembered preferred children, which draw as the line's quieter future.
  const pastIds = useMemo(() => {
    const ids = new Set<string>();
    let cursor = currentNodeId ? nodes[currentNodeId] : undefined;
    while (cursor) {
      ids.add(cursor.id);
      cursor = cursor.parentId !== null ? nodes[cursor.parentId] : undefined;
    }
    return ids;
  }, [nodes, currentNodeId]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of items) {
      if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const forkCount = useMemo(
    () => [...childCounts.values()].filter((count) => count > 1).length,
    [childCounts],
  );

  // Ghost-ness isn't persisted, but it is derivable (the engine's own rule for
  // regenerate): a scouted turn is a complete, childless child of the checkout
  // that its parent never adopted as the preferred child.
  const isGhost = (node: TimelineNodeMeta): boolean =>
    node.status === "complete" &&
    node.parentId !== null &&
    node.parentId === currentNodeId &&
    nodes[node.parentId]?.preferredChildId !== node.id &&
    !childCounts.has(node.id);

  const select = (nodeId: string | null, nextMode: PlateMode = null) => {
    setSelectedId(nodeId);
    setMode(nextMode);
  };

  // The selection can vanish under us (a branch deleted over SSE) — fall back
  // to the checkout rather than leaving the plate and keys on a ghost id.
  useEffect(() => {
    if (selectedId && !nodes[selectedId]) {
      setSelectedId(currentNodeId);
      setMode(null);
    }
  }, [nodes, selectedId, currentNodeId]);

  // Comparable = the selection is a COMPLETE re-roll with at least one other
  // complete sibling — anything less opens the panel onto an error state.
  const canCompare = useMemo(() => {
    const node = selectedId ? nodes[selectedId] : undefined;
    if (!selectedId || node?.status !== "complete") return false;
    return selectSiblings(nodes, selectedId).some(
      (sibling) => sibling.id !== selectedId && sibling.status === "complete",
    );
  }, [nodes, selectedId]);
  useEffect(() => {
    if (!canCompare) setDiffOpen(false);
  }, [canCompare]);

  // Preview the selection on the live map beneath the scrim. Suspended while
  // the time-lapse or the sibling diff owns the map — two writers to the world
  // store means the paused frame silently loses to whatever ran last.
  useEffect(() => {
    if (!gameId || !selectedId || timeLapseOpen || diffOpen) return;
    const node = nodes[selectedId];
    if (node?.status !== "complete") return;
    void useWorldStore.getState().load(gameId, selectedId);
  }, [gameId, selectedId, nodes, timeLapseOpen, diffOpen]);

  const close = () => {
    // Read the checkout fresh: checkout() calls setCurrent() then close(), and
    // the render-scope currentNodeId would still be the PRE-checkout node.
    const live = useLoomStore.getState().currentNodeId;
    if (gameId && live) void useWorldStore.getState().load(gameId, live);
    setLoomOpen(false);
  };

  const checkout = async (nodeId: string) => {
    if (!gameId) return;
    const node = nodes[nodeId];
    if (!node || node.status !== "complete") return;
    await api.setActiveNode(gameId, nodeId);
    useLoomStore.getState().setCurrent(nodeId);
    close();
  };

  const regenerate = (nodeId: string) => {
    if (gameId) void api.regenerate(gameId, nodeId).catch(() => {});
  };

  // Keyboard: esc close, enter checkout, arrows navigate the tree.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The time-lapse replaces the tree: the tree's keys must go dormant
      // (Enter would check out an invisible node) and Escape exits playback
      // back to the tree, not the whole loom.
      if (timeLapseOpen) {
        if (event.key === "Escape") setTimeLapseOpen(false);
        return;
      }
      // Same contract for the sibling diff: it replaces the tree, so the
      // tree's keys go dormant and Escape returns to the tree.
      if (diffOpen) {
        if (event.key === "Escape") setDiffOpen(false);
        return;
      }
      // Typing an anchor name owns the keyboard — its field handles its own
      // Enter (save) and Escape (cancel).
      if (isTyping(event.target)) return;
      // A plate mode (anchor naming, delete confirmation) is backed out of
      // first: Escape cancels it rather than closing the loom, and Enter must
      // not check out a node while a deletion is pending confirmation.
      if (mode) {
        if (event.key === "Escape") setMode(null);
        return;
      }
      if (event.key === "Escape") return close();
      if (!selectedId) return;
      const node = nodes[selectedId];
      if (!node) return;
      // A focused button answers its own Enter (plate/header actions) — it
      // must not also check the selection out.
      if (event.key === "Enter" && (event.target as HTMLElement | null)?.tagName === "BUTTON") return;
      if (event.key === "Enter") return void checkout(selectedId);
      if (event.key === "ArrowLeft" && node.parentId) return setSelectedId(node.parentId);
      if (event.key === "ArrowRight") {
        const child = node.preferredChildId ?? items.find((n) => n.parentId === node.id)?.id;
        if (child) setSelectedId(child);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const siblings = selectSiblings(nodes, selectedId);
        const index = siblings.findIndex((n) => n.id === selectedId);
        const next = siblings[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) setSelectedId(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Time-lapse replaces the tree with a full map view + floating scrubber;
  // closing it (✕ here, or the whole loom via esc) returns to the tree.
  if (timeLapseOpen) {
    return <TimeLapse onClose={() => setTimeLapseOpen(false)} />;
  }

  // The sibling diff likewise replaces the tree, keeping the map visible
  // beside it so either re-roll can be painted onto it.
  if (diffOpen && selectedId) {
    return <SiblingDiff nodeId={selectedId} onClose={() => setDiffOpen(false)} />;
  }

  const selected = selectedId ? nodes[selectedId] : undefined;
  const edgeClass = (child: TimelineNodeMeta): string => {
    if (child.status === "generating" || pending[child.id]) return styles.pendingEdge!;
    if (pastIds.has(child.id)) return styles.canonicalEdge!;
    if (pathIds.has(child.id)) return styles.futureEdge!;
    if (isGhost(child)) return styles.ghostEdge!;
    return "";
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} aria-hidden />
      <TreeCanvas
        className={styles.canvas}
        items={items}
        nodeWidth={NODE_WIDTH}
        nodeHeight={NODE_HEIGHT}
        gapX={GAP_X}
        gapY={GAP_Y}
        insets={INSETS}
        edgeShape={edgeShapeFor(theme.style)}
        focusId={currentNodeId}
        revealId={selectedId}
        edgeClassName={(_, child) => edgeClass(child)}
        renderNode={(node) => {
          const siblings = selectSiblings(nodes, node.id);
          return (
            <NodeCard
              node={node}
              gameId={gameId}
              palette={palette}
              polityNames={polityNames}
              isCurrent={node.id === currentNodeId}
              isSelected={node.id === selectedId}
              onPath={pathIds.has(node.id)}
              isFuture={pathIds.has(node.id) && !pastIds.has(node.id)}
              isGhost={isGhost(node)}
              progress={pending[node.id]}
              siblingIndex={siblings.findIndex((sibling) => sibling.id === node.id)}
              siblingCount={siblings.length}
              onSelect={() => select(node.id)}
              onCheckout={() => void checkout(node.id)}
              onRegenerate={() => regenerate(node.id)}
              onAnchor={() => select(node.id, "anchor")}
              onDelete={() => select(node.id, "delete")}
            />
          );
        }}
      />

      <header className={`${styles.header} pfPanel`}>
        <span className={styles.mark} aria-hidden>
          <GitBranch size={18} />
        </span>
        <div className={styles.heading}>
          <span className="pfKicker">
            Timeline · {items.length} turn{items.length === 1 ? "" : "s"} · {forkCount} fork
            {forkCount === 1 ? "" : "s"}
          </span>
          <h2 className={`${styles.title} pfTitle`}>The Loom</h2>
        </div>

        <ul className={styles.legend} aria-label="Legend">
          <li>
            <span className={`${styles.legendLine} ${styles.legendCanon}`} /> Present line
          </li>
          <li>
            <span className={`${styles.legendLine} ${styles.legendFuture}`} /> Remembered
          </li>
          <li>
            <span className={styles.legendLine} /> Branch
          </li>
        </ul>

        <div className={styles.keys} aria-label="Keyboard">
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> walk
          </span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> re-rolls
          </span>
          <span>
            <kbd>↵</kbd> check out
          </span>
        </div>

        <div className={styles.tools}>
          <Button
            variant="ghost"
            size="sm"
            disabled={!gameId || !currentNodeId}
            onClick={() => setTimeLapseOpen(true)}
            title="Play back the current path on the map"
          >
            <Play size={14} /> Time-lapse
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!gameId || !canCompare}
            onClick={() => setDiffOpen(true)}
            title={
              canCompare
                ? "Compare this turn against its other re-rolls"
                : "Select a turn that has been re-rolled to compare its versions"
            }
          >
            <GitCompareArrows size={14} /> Compare
          </Button>
          <span className={styles.toolRule} />
          <Button variant="ghost" icon onClick={close} title="Close the loom (Esc)" aria-label="Close the loom">
            <X size={18} />
          </Button>
        </div>
      </header>

      {selected ? (
        <SelectionPlate
          key={selected.id}
          node={selected}
          nodes={nodes}
          gameId={gameId}
          mode={mode}
          isCurrent={selected.id === currentNodeId}
          isGhost={isGhost(selected)}
          onPath={pathIds.has(selected.id)}
          isFuture={pathIds.has(selected.id) && !pastIds.has(selected.id)}
          progress={pending[selected.id]}
          canCompare={canCompare}
          onMode={setMode}
          onCheckout={() => void checkout(selected.id)}
          onCompare={() => setDiffOpen(true)}
          onRegenerate={() => regenerate(selected.id)}
          onDeleted={() => select(selected.parentId ?? currentNodeId)}
        />
      ) : null}
    </div>
  );
}

/** Where a node stands relative to the checkout, in words. */
const standing = (
  node: TimelineNodeMeta,
  flags: { isCurrent: boolean; isGhost: boolean; onPath: boolean; isFuture: boolean; generating: boolean },
): string => {
  if (flags.generating) return "Weaving";
  if (node.status === "failed") return "Failed";
  if (flags.isCurrent) return "Present";
  if (flags.isGhost) return "Scouted · not yet canon";
  if (flags.isFuture) return "Remembered ahead";
  if (flags.onPath) return "Present line";
  return "Alternate branch";
};

const countSubtree = (nodes: Record<string, TimelineNodeMeta>, rootId: string): number => {
  const children = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  let count = 0;
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    count += 1;
    stack.push(...(children.get(id) ?? []));
  }
  return count;
};

/**
 * The selected turn, spelled out: date, standing, full summary and every
 * action. Also hosts the inline anchor editor and the delete confirmation
 * (replacing window.prompt/confirm, which froze the page mid-preview).
 */
function SelectionPlate({
  node,
  nodes,
  gameId,
  mode,
  isCurrent,
  isGhost,
  onPath,
  isFuture,
  progress,
  canCompare,
  onMode,
  onCheckout,
  onCompare,
  onRegenerate,
  onDeleted,
}: {
  node: TimelineNodeMeta;
  nodes: Record<string, TimelineNodeMeta>;
  gameId: string | null;
  mode: PlateMode;
  isCurrent: boolean;
  isGhost: boolean;
  onPath: boolean;
  isFuture: boolean;
  progress: TurnProgress | undefined;
  canCompare: boolean;
  onMode: (mode: PlateMode) => void;
  onCheckout: () => void;
  onCompare: () => void;
  onRegenerate: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generating = Boolean(progress) || node.status === "generating";
  const siblings = selectSiblings(nodes, node.id);
  const siblingIndex = siblings.findIndex((sibling) => sibling.id === node.id);
  const label = standing(node, { isCurrent, isGhost, onPath, isFuture, generating });

  const saveAnchor = async (value: string) => {
    if (!gameId) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await api.setAnchor(gameId, node.id, value.trim().slice(0, 80));
      useLoomStore.setState((state) => ({ nodes: { ...state.nodes, [meta.id]: meta } }));
      onMode(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteBranch = async () => {
    if (!gameId) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSubtree(gameId, node.id);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const doomed = mode === "delete" ? countSubtree(nodes, node.id) : 0;

  return (
    <section
      className={[
        styles.plate,
        "pfPanel",
        isCurrent ? styles.plateCurrent : "",
        isGhost ? styles.plateGhost : "",
        node.status === "failed" ? styles.plateFailed : "",
        generating ? styles.plateGenerating : "",
        mode === "delete" ? styles.plateDanger : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Selected turn"
    >
      <div className={styles.plateIdentity}>
        <span className={`${styles.plateKicker} pfKicker`}>
          <span className={styles.plateDot} />
          Turn {node.depth} · {label}
          {siblings.length > 1 ? ` · re-roll ${siblingIndex + 1}/${siblings.length}` : ""}
        </span>
        <h3 className={`${styles.plateDate} pfTitle`}>
          {node.depth === 0 ? "Scenario start" : formatGameDate(node.gameDate)}
        </h3>
        {node.anchor ? (
          <span className={styles.plateAnchor} title="Anchor">
            <Bookmark size={12} /> {node.anchor}
          </span>
        ) : null}
      </div>

      {mode === "anchor" ? (
        <AnchorEditor
          initial={node.anchor}
          busy={busy}
          onSave={(value) => void saveAnchor(value)}
          onCancel={() => onMode(null)}
        />
      ) : mode === "delete" ? (
        <div className={styles.confirm}>
          <TriangleAlert size={18} className={styles.confirmIcon} />
          <p className={styles.confirmText}>
            Delete this turn{doomed > 1 ? ` and the ${doomed - 1} after it` : ""}? Branches can’t be
            restored once cut.
          </p>
          <div className={styles.plateActions}>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void deleteBranch()}>
              <Trash size={13} /> Delete {doomed > 1 ? `${doomed} turns` : "turn"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.plateSummary}>
            {generating
              ? progress?.lastEventTitle || "The world turns…"
              : node.status === "failed"
                ? "This turn failed to generate. Re-roll to try it again."
                : node.summary || "No summary recorded for this turn."}
          </p>
          <div className={styles.plateActions}>
            {isCurrent ? (
              <span className={styles.here}>
                <Check size={14} /> You are here
              </span>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={node.status !== "complete"}
                onClick={onCheckout}
                title="Make this the present (Enter)"
              >
                <CornerDownLeft size={14} /> Check out
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!canCompare}
              onClick={onCompare}
              title={canCompare ? "Compare this turn against its other re-rolls" : "This turn has no completed re-roll"}
            >
              <GitCompareArrows size={14} /> Compare
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMode("anchor")} title="Name this moment">
              {node.anchor ? <Bookmark size={14} /> : <BookmarkPlus size={14} />}
              {node.anchor ? "Rename" : "Anchor"}
            </Button>
            {node.depth > 0 && !generating ? (
              <Button variant="ghost" size="sm" onClick={onRegenerate} title="Regenerate as a sibling">
                <RefreshCw size={14} /> Re-roll
              </Button>
            ) : null}
            {node.depth > 0 && !isCurrent ? (
              <Button
                variant="ghost"
                size="sm"
                icon
                className={styles.dangerGhost}
                onClick={() => onMode("delete")}
                title="Delete this branch"
                aria-label="Delete this branch"
              >
                <Trash size={14} />
              </Button>
            ) : null}
          </div>
        </>
      )}
      {error ? <p className={styles.plateError}>{error}</p> : null}
    </section>
  );
}

/** Inline anchor naming (blank clears). Enter saves, Escape cancels. */
function AnchorEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      className={styles.anchorForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label className={styles.anchorField}>
        <Bookmark size={15} />
        <input
          autoFocus
          className={styles.anchorInput}
          maxLength={80}
          value={draft}
          disabled={busy}
          placeholder="Name this moment — e.g. Eve of the Anatolian War"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>
      <div className={styles.plateActions}>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          <Check size={14} /> {draft.trim() || !initial ? "Save" : "Clear"}
        </Button>
        {initial ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSave("")}>
            Remove
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NodeCard({
  node,
  gameId,
  palette,
  polityNames,
  isCurrent,
  isSelected,
  onPath,
  isFuture,
  isGhost,
  progress,
  siblingIndex,
  siblingCount,
  onSelect,
  onCheckout,
  onRegenerate,
  onAnchor,
  onDelete,
}: {
  node: TimelineNodeMeta;
  gameId: string | null;
  palette: Record<string, string>;
  polityNames: Record<string, string>;
  isCurrent: boolean;
  isSelected: boolean;
  onPath: boolean;
  isFuture: boolean;
  isGhost: boolean;
  progress: TurnProgress | undefined;
  siblingIndex: number;
  siblingCount: number;
  onSelect: () => void;
  onCheckout: () => void;
  onRegenerate: () => void;
  onAnchor: () => void;
  onDelete: () => void;
}) {
  const generating = Boolean(progress) || node.status === "generating";
  const failed = node.status === "failed";
  const classes = [
    styles.card,
    isCurrent ? styles.current : "",
    isSelected ? styles.selected : "",
    !onPath && !isCurrent ? styles.offPath : "",
    isFuture ? styles.future : "",
    isGhost ? styles.ghost : "",
    failed ? styles.failed : "",
    generating ? styles.generating : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.slot}>
      {node.anchor ? (
        <span className={styles.ribbon} title={`Anchor: ${node.anchor}`}>
          <Bookmark size={11} />
          <span className={styles.ribbonText}>{node.anchor}</span>
        </span>
      ) : null}
      {isSelected ? <span className={styles.lock} aria-hidden /> : null}
      <div
        className={classes}
        onClick={onSelect}
        onDoubleClick={onCheckout}
        aria-current={isCurrent ? "step" : undefined}
      >
        <div className={styles.cardTop}>
          <span className={`${styles.date} pfKicker`}>
            {generating ? (
              <>
                <LoaderCircle size={11} className={styles.spin} />
                {progress ? PHASE_LABELS[progress.phase] : "Weaving"}
              </>
            ) : failed ? (
              <>
                <TriangleAlert size={11} /> Failed
              </>
            ) : node.depth === 0 ? (
              "Scenario start"
            ) : (
              formatGameDate(node.gameDate)
            )}
          </span>
          {siblingCount > 1 ? (
            <span className={styles.branchTag} title={`Re-roll ${siblingIndex + 1} of ${siblingCount}`}>
              <GitBranch size={10} />
              {siblingIndex + 1}/{siblingCount}
            </span>
          ) : null}
        </div>
        <p className={styles.summary}>
          {generating
            ? progress?.lastEventTitle || "The world turns…"
            : failed
              ? "Generation failed — re-roll to retry."
              : node.summary || "—"}
        </p>
        {node.status === "complete" ? (
          <FingerprintBar gameId={gameId} nodeId={node.id} palette={palette} names={polityNames} />
        ) : (
          <span className={styles.fingerprintBlank} />
        )}
        <div className={styles.cardBottom}>
          <span className={styles.counts}>
            {isCurrent ? <span className={styles.presentTag}>Present</span> : null}
            {isGhost ? (
              <span className={styles.ghostTag} title="Scouted — not yet canon">
                <Ghost size={11} /> Scout
              </span>
            ) : null}
            {node.eventCount > 0 ? (
              <span title={`${node.eventCount} event${node.eventCount === 1 ? "" : "s"}`}>
                <Flag size={11} /> {node.eventCount}
              </span>
            ) : null}
            {node.conversationCount > 0 ? (
              <span title={`${node.conversationCount} conversation${node.conversationCount === 1 ? "" : "s"}`}>
                <MessagesSquare size={11} /> {node.conversationCount}
              </span>
            ) : null}
            {generating && progress ? <span>{progress.streamedChars.toLocaleString()} chars</span> : null}
          </span>
          <span
            className={styles.actions}
            onClick={(event: MouseEvent) => event.stopPropagation()}
            // dblclick bubbles separately — two quick clicks on an action must
            // not check the node out (the card root binds onDoubleClick).
            onDoubleClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <button
              className={styles.iconButton}
              title={node.anchor ? `Anchored: "${node.anchor}" — rename or clear` : "Anchor this node"}
              aria-label={node.anchor ? "Rename anchor" : "Anchor this node"}
              onClick={onAnchor}
            >
              {node.anchor ? <Bookmark size={13} /> : <BookmarkPlus size={13} />}
            </button>
            {node.depth > 0 && node.status !== "generating" ? (
              <button
                className={`${styles.iconButton} ${failed ? styles.iconButtonLit : ""}`}
                title={failed ? "Retry — regenerate this turn" : "Regenerate as sibling"}
                aria-label="Regenerate as sibling"
                onClick={onRegenerate}
              >
                <RefreshCw size={13} />
              </button>
            ) : null}
            {node.depth > 0 && !isCurrent ? (
              <button
                className={`${styles.iconButton} ${styles.iconDanger}`}
                title="Delete branch"
                aria-label="Delete branch"
                onClick={onDelete}
              >
                <Trash size={13} />
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A thin ownership bar: one flex segment per polity, sized by fingerprint
 *  weight. Fetches lazily on mount via the shared cache; renders an empty
 *  track while pending or on a fetch error — the card keeps its shape. */
function FingerprintBar({
  gameId,
  nodeId,
  palette,
  names,
}: {
  gameId: string | null;
  nodeId: string;
  palette: Record<string, string>;
  names: Record<string, string>;
}) {
  const fingerprint = useNodeFingerprint(gameId, nodeId, true);
  // Segments keep the server's order so a polity sits in the same place on
  // every card (siblings compare at a glance); the tooltip ranks by weight.
  const entries = fingerprint ? Object.entries(fingerprint.weights) : [];
  if (entries.length === 0) return <span className={styles.fingerprintBlank} />;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const title = [...entries]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([code, weight]) => `${names[code] ?? code} ${Math.round((weight / total) * 100)}%`)
    .join(" · ");
  return (
    <div className={styles.fingerprintBar} title={`Territory — ${title}`}>
      {entries.map(([code, weight]) => (
        <span
          key={code}
          className={styles.fingerprintSegment}
          style={{ flexGrow: weight, backgroundColor: palette[code] ?? "var(--pf-text-muted)" }}
        />
      ))}
    </div>
  );
}
