import { useMemo } from "react";
import type { TimelineNodeMeta } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { selectCurrentPath, selectSiblings, useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useWorldStore } from "../../stores/world.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { dominantOwnerColor, useNodeFingerprint } from "./fingerprintCache.ts";
import styles from "./LoomStrip.module.css";

const VISIBLE = 12;

/** The permanent handle into branching: the current path as clickable dots,
 *  sibling counts stacked beneath, and the door into the full loom. */
export function LoomStrip() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const setLoomOpen = useUiStore((state) => state.setLoomOpen);
  const themeId = useUiStore((state) => state.themeId);
  const themes = useThemesStore((state) => state.themes);
  const world = useWorldStore((state) => state.world);
  // Same approximation as the loom overlay: fingerprints are per-node but the
  // palette is per-code, so whatever world happens to be loaded is fine.
  const palette = useMemo(
    () => (world ? buildPolityPalette(selectTheme(themes, themeId), world) : {}),
    [themes, themeId, world],
  );

  const path = useMemo(
    () => selectCurrentPath({ nodes, currentNodeId }).slice(-VISIBLE),
    [nodes, currentNodeId],
  );

  if (path.length === 0) return null;

  return (
    <div className={styles.strip}>
      <div className={styles.dots}>
        {path.map((node, index) => {
          const siblingCount = selectSiblings(nodes, node.id).length;
          const isCurrent = node.id === currentNodeId;
          return (
            <span key={node.id} className={styles.slot}>
              {index > 0 ? <span className={styles.edge} /> : null}
              <Dot
                node={node}
                gameId={gameId}
                palette={palette}
                isCurrent={isCurrent}
                siblingCount={siblingCount}
                onClick={() => {
                  if (!gameId || isCurrent || node.status !== "complete") return;
                  void api.setActiveNode(gameId, node.id).then(() => {
                    useLoomStore.getState().setCurrent(node.id);
                  });
                }}
              />
              {siblingCount > 1 ? <span className={styles.siblingCount}>{siblingCount}</span> : null}
            </span>
          );
        })}
      </div>
      <button className={styles.open} onClick={() => setLoomOpen(true)} title="Open loom (L)">
        ⤢ loom
      </button>
    </div>
  );
}

/** One path dot. Anchored and current nodes fetch their fingerprint and tint
 *  the glyph with the dominant owner's color — plain path dots don't, to
 *  keep the strip's steady-state cost near zero. */
function Dot({
  node,
  gameId,
  palette,
  isCurrent,
  siblingCount,
  onClick,
}: {
  node: TimelineNodeMeta;
  gameId: string | null;
  palette: Record<string, string>;
  isCurrent: boolean;
  siblingCount: number;
  onClick: () => void;
}) {
  const wantsColor = node.status === "complete" && (isCurrent || Boolean(node.anchor));
  const fingerprint = useNodeFingerprint(gameId, node.id, wantsColor);
  const dominant = wantsColor ? dominantOwnerColor(fingerprint, palette) : null;

  return (
    <button
      className={`${styles.dot} ${isCurrent ? styles.current : ""} ${node.status === "failed" ? styles.failed : ""} ${node.anchor ? styles.anchored : ""}`}
      style={dominant ? { color: dominant } : undefined}
      title={`${node.depth === 0 ? "Start" : node.gameDate} — ${node.summary || "…"}${siblingCount > 1 ? ` (${siblingCount} branches)` : ""}${node.anchor ? ` · 🔖 ${node.anchor}` : ""}`}
      onClick={onClick}
    >
      {node.depth === 0 ? "◉" : "○"}
    </button>
  );
}
