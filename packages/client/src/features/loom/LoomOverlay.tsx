import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import type { TimelineNodeMeta } from "@pax/domain";
import { TreeCanvas } from "../../components/tree/TreeCanvas.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { selectCurrentPath, selectSiblings, useLoomStore } from "../../stores/loom.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { useSessionStore } from "../../stores/session.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { TimeLapse } from "./TimeLapse.tsx";
import { SiblingDiff } from "./SiblingDiff.tsx";
import { useNodeFingerprint } from "./fingerprintCache.ts";
import styles from "./LoomOverlay.module.css";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 92;

/**
 * The navigable timeline tree. The map stays live underneath the scrim and
 * previews the selected node, so branching feels consequential. Click =
 * select + preview; double-click/Enter = check out; ↻ = regenerate a sibling.
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
  // Fingerprint bars need a palette, but each node has its own (unfetched)
  // world snapshot — colors are stable per polity code regardless of which
  // snapshot supplies them, so the currently-loaded world is close enough.
  const palette = useMemo(
    () => (world ? buildPolityPalette(selectTheme(themes, themeId), world) : {}),
    [themes, themeId, world],
  );

  const [selectedId, setSelectedId] = useState(currentNodeId);
  const [timeLapseOpen, setTimeLapseOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const items = useMemo(() => Object.values(nodes), [nodes]);
  const pathIds = useMemo(
    () => new Set(selectCurrentPath({ nodes, currentNodeId }).map((node) => node.id)),
    [nodes, currentNodeId],
  );

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
      if (event.key === "Escape") return close();
      if (!selectedId) return;
      const node = nodes[selectedId];
      if (!node) return;
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

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <span className={styles.title}>Loom</span>
        <span className={styles.hint}>click: preview · double-click/enter: check out · esc: close</span>
        <Button
          variant="ghost"
          disabled={!gameId || !currentNodeId}
          onClick={() => setTimeLapseOpen(true)}
          title="Play back the current path on the map"
        >
          ⏵ Time-lapse
        </Button>
        <Button
          variant="ghost"
          disabled={!gameId || !canCompare}
          onClick={() => setDiffOpen(true)}
          title={
            canCompare
              ? "Compare this turn against its other re-rolls"
              : "Select a turn that has been re-rolled to compare its versions"
          }
        >
          ⇄ Compare
        </Button>
        <Button variant="ghost" onClick={close}>
          ✕
        </Button>
      </header>
      <TreeCanvas
        items={items}
        nodeWidth={NODE_WIDTH}
        nodeHeight={NODE_HEIGHT}
        focusId={currentNodeId}
        edgeClassName={(_, child) => (pathIds.has(child.id) ? styles.canonicalEdge! : "")}
        renderNode={(node) => (
          <NodeCard
            node={node}
            gameId={gameId}
            palette={palette}
            isCurrent={node.id === currentNodeId}
            isSelected={node.id === selectedId}
            onPath={pathIds.has(node.id)}
            isPending={Boolean(pending[node.id])}
            siblingCount={selectSiblings(nodes, node.id).length}
            onSelect={() => setSelectedId(node.id)}
            onCheckout={() => void checkout(node.id)}
            onRegenerate={() => gameId && void api.regenerate(gameId, node.id).catch(() => {})}
            onAnchor={() => {
              if (!gameId) return;
              const next = window.prompt(
                node.anchor ? "Rename anchor (blank to clear):" : "Name this anchor:",
                node.anchor,
              );
              if (next === null) return;
              void api
                .setAnchor(gameId, node.id, next.trim().slice(0, 80))
                .then((meta) =>
                  useLoomStore.setState((state) => ({ nodes: { ...state.nodes, [meta.id]: meta } })),
                )
                .catch((error) => alert(error.message));
            }}
            onDelete={() => {
              if (!gameId) return;
              if (confirm("Delete this branch and everything after it?")) {
                void api.deleteSubtree(gameId, node.id).catch((error) => alert(error.message));
              }
            }}
          />
        )}
      />
    </div>
  );
}

function NodeCard({
  node,
  gameId,
  palette,
  isCurrent,
  isSelected,
  onPath,
  isPending,
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
  isCurrent: boolean;
  isSelected: boolean;
  onPath: boolean;
  isPending: boolean;
  siblingCount: number;
  onSelect: () => void;
  onCheckout: () => void;
  onRegenerate: () => void;
  onAnchor: () => void;
  onDelete: () => void;
}) {
  const classes = [
    styles.card,
    isCurrent ? styles.current : "",
    isSelected ? styles.selected : "",
    !onPath && !isCurrent ? styles.offPath : "",
    node.status === "failed" ? styles.failed : "",
    isPending || node.status === "generating" ? styles.generating : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} onClick={onSelect} onDoubleClick={onCheckout}>
      <div className={styles.cardTop}>
        <span className={styles.date}>{node.depth === 0 ? "Start" : node.gameDate}</span>
        <span className={styles.cardTopRight}>
          {siblingCount > 1 ? <Badge tone="accent">⑂ {siblingCount}</Badge> : null}
          <button
            className={`${styles.anchorButton} ${node.anchor ? styles.anchorSet : ""}`}
            title={
              node.anchor ? `Anchored: "${node.anchor}" — click to rename or clear` : "Anchor this node"
            }
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              onAnchor();
            }}
            // dblclick bubbles separately — two quick clicks here must not
            // check the node out (the card root binds onDoubleClick).
            onDoubleClick={(event: MouseEvent) => event.stopPropagation()}
          >
            {node.anchor ? `🔖 ${truncate(node.anchor, 24)}` : "🔖"}
          </button>
        </span>
      </div>
      <div className={styles.summary}>
        {node.status === "generating" ? "Generating…" : node.status === "failed" ? "Generation failed" : node.summary || "—"}
      </div>
      {node.status === "complete" ? (
        <FingerprintBar gameId={gameId} nodeId={node.id} palette={palette} />
      ) : null}
      <div className={styles.cardBottom}>
        <span className={styles.badges}>
          {node.eventCount > 0 ? `⚑ ${node.eventCount}` : ""}
          {node.conversationCount > 0 ? ` 💬 ${node.conversationCount}` : ""}
        </span>
        <span
          className={styles.actions}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {node.depth > 0 && node.status !== "generating" ? (
            <button className={styles.iconButton} title="Regenerate as sibling" onClick={onRegenerate}>
              ↻
            </button>
          ) : null}
          {node.depth > 0 && !isCurrent ? (
            <button className={styles.iconButton} title="Delete branch" onClick={onDelete}>
              ✕
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** A thin ownership bar: one flex segment per polity, sized by fingerprint
 *  weight. Fetches lazily on mount via the shared cache; renders nothing
 *  while pending or on a fetch error — the card just keeps its plain shape. */
function FingerprintBar({
  gameId,
  nodeId,
  palette,
}: {
  gameId: string | null;
  nodeId: string;
  palette: Record<string, string>;
}) {
  const fingerprint = useNodeFingerprint(gameId, nodeId, true);
  const entries = fingerprint ? Object.entries(fingerprint.weights) : [];
  if (entries.length === 0) return null;
  return (
    <div className={styles.fingerprintBar} title="Ownership fingerprint">
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

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
