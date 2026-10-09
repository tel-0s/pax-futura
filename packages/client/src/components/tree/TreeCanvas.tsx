import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { hierarchy, tree } from "d3-hierarchy";
import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "../Button.tsx";
import styles from "./TreeCanvas.module.css";

export interface TreeCanvasItem {
  id: string;
  parentId: string | null;
}

/**
 * How parent→child connectors are drawn: smooth bezier (glass/editorial),
 * square genealogy elbows (atlas), 45°-routed traces (machined), or straight
 * vector fans (CRT). The geometry lives here; colour lives in the caller's CSS.
 */
export type TreeEdgeShape = "curve" | "elbow" | "chamfer" | "fan";

interface TreeCanvasProps<T extends TreeCanvasItem> {
  items: T[];
  nodeWidth: number;
  nodeHeight: number;
  gapX?: number;
  gapY?: number;
  renderNode: (item: T) => ReactNode;
  /** Style hook per edge; e.g. canonical vs sibling. Lands on the edge's <g>,
   *  whose paths carry data-edge="halo" | "line" | "flow" for styling. */
  edgeClassName?: (parent: T, child: T) => string;
  edgeShape?: TreeEdgeShape | undefined;
  /** Node id to center on first layout (and on "recenter"). */
  focusId?: string | null | undefined;
  /** Node id to keep in view: when it changes and sits off-screen (or under
   *  the floating chrome), the canvas glides it back into the visible band. */
  revealId?: string | null | undefined;
  /** Floating chrome over the canvas edges, px — centering and reveal aim for
   *  the band between them so nodes don't land under a header or a plate. */
  insets?: { top: number; bottom: number } | undefined;
  /** Skin hook for the canvas root (backdrop grid, zoom-level styling). The
   *  root also exposes --pf-tree-x/-y/-scale and data-zoom="near|mid|far". */
  className?: string | undefined;
}

interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const GLIDE_MS = 380;
const FOCUS_ACROSS = 0.6;
/** A press that travels further than this is a pan, not a click. */
const DRAG_SLOP = 4;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

const edgePath = (shape: TreeEdgeShape, x1: number, y1: number, x2: number, y2: number): string => {
  const mid = (x1 + x2) / 2;
  const dy = y2 - y1;
  if (Math.abs(dy) < 0.5) return `M ${x1} ${y1} H ${x2}`;
  switch (shape) {
    case "elbow":
      return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
    case "chamfer": {
      const cut = Math.min(Math.abs(dy) / 2, (x2 - x1) / 4, 14);
      const s = Math.sign(dy);
      return `M ${x1} ${y1} H ${mid - cut} L ${mid} ${y1 + s * cut} V ${y2 - s * cut} L ${mid + cut} ${y2} H ${x2}`;
    }
    case "fan": {
      const lead = Math.min(16, (x2 - x1) / 4);
      return `M ${x1} ${y1} H ${x1 + lead} L ${x2 - lead} ${y2} H ${x2}`;
    }
    default:
      return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  }
};

/**
 * The shared tree renderer behind the loom view: d3-hierarchy tidy-tree
 * layout rotated to horizontal (time flows left to right), HTML cards for
 * real content, one SVG layer for edges, and a hand-rolled pan/zoom
 * transform with on-canvas zoom controls.
 */
export function TreeCanvas<T extends TreeCanvasItem>({
  items,
  nodeWidth,
  nodeHeight,
  gapX = 48,
  gapY = 16,
  renderNode,
  edgeClassName,
  edgeShape = "curve",
  focusId,
  revealId,
  insets,
  className,
}: TreeCanvasProps<T>) {
  const layout = useMemo(() => {
    if (items.length === 0) return { placed: [] as Placed<T>[], edges: [] };
    const byId = new Map(items.map((item) => [item.id, item]));
    const root = hierarchy<T>(
      items.find((item) => item.parentId === null || !byId.has(item.parentId!))!,
      (item) => items.filter((candidate) => candidate.parentId === item.id),
    );
    tree<T>().nodeSize([nodeHeight + gapY, nodeWidth + gapX])(root);

    // d3's vertical layout: x = breadth, y = depth. Swap for horizontal flow.
    const placed: Placed<T>[] = root
      .descendants()
      .map((node) => ({ item: node.data, x: node.y ?? 0, y: node.x ?? 0 }));
    const edges = root.links().map((link) => ({
      from: { item: link.source.data, x: link.source.y ?? 0, y: link.source.x ?? 0 },
      to: { item: link.target.data, x: link.target.y ?? 0, y: link.target.x ?? 0 },
    }));
    return { placed, edges };
  }, [items, nodeWidth, nodeHeight, gapX, gapY]);

  const [transform, setTransform] = useState<Transform>(() => ({ x: 80, y: 0, scale: 1 }));
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [gliding, setGliding] = useState(false);
  const glideTimer = useRef<number | undefined>(undefined);
  const centered = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragMoved = useRef(false);
  const insetTop = insets?.top ?? 0;
  const insetBottom = insets?.bottom ?? 0;

  /** The transform that puts a placed node in the middle of the visible band
   *  (`across` = horizontal position as a fraction of the width). */
  const centerOn = useCallback(
    (target: Placed<T>, scale: number, across = 0.5): Transform | null => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return null;
      const bandMid = insetTop + (rect.height - insetTop - insetBottom) / 2;
      return {
        x: rect.width * across - (target.x + nodeWidth / 2) * scale,
        y: bandMid - (target.y + nodeHeight / 2) * scale,
        scale,
      };
    },
    [insetTop, insetBottom, nodeWidth, nodeHeight],
  );

  /** Animated transform change (recenter, reveal, zoom buttons) — never used
   *  for drag/wheel, which must track the pointer 1:1. */
  const glideTo = useCallback((next: Transform | null) => {
    if (!next) return;
    setGliding(true);
    setTransform(next);
    window.clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => setGliding(false), GLIDE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(glideTimer.current), []);

  // Center the focused node on first layout (not on every change). A layout
  // effect, not a render-phase check: the container ref is still null during
  // the first render, so a render-phase version never centered until some
  // unrelated re-render happened to come along. Focus sits a little right of
  // center — time flows rightward, and the focus is usually the newest turn,
  // so the extra room goes to its history.
  useLayoutEffect(() => {
    if (centered.current || !focusId) return;
    const target = layout.placed.find((entry) => entry.item.id === focusId);
    const next = target ? centerOn(target, 1, FOCUS_ACROSS) : null;
    if (!next) return;
    setTransform(next);
    centered.current = true;
  }, [focusId, layout, centerOn]);

  // Keep the revealed node (the selection) in view as it moves — keyboard
  // walks can step off-screen. Reads the live transform; deliberately not
  // keyed on it, so panning away from the selection doesn't snap back.
  useEffect(() => {
    if (!revealId || !centered.current) return;
    const target = layout.placed.find((entry) => entry.item.id === revealId);
    const rect = container.current?.getBoundingClientRect();
    if (!target || !rect) return;
    const { x, y, scale } = transformRef.current;
    const margin = 24;
    const left = x + target.x * scale;
    const top = y + target.y * scale;
    const inView =
      left >= margin &&
      left + nodeWidth * scale <= rect.width - margin &&
      top >= insetTop + margin &&
      top + nodeHeight * scale <= rect.height - insetBottom - margin;
    if (!inView) glideTo(centerOn(target, scale));
    // Keyed on the id alone: reveal when the selection moves, not on layout churn.
  }, [revealId]);

  const zoomAt = (factor: number, pointerX: number, pointerY: number, prev: Transform): Transform => {
    const scale = clampScale(prev.scale * factor);
    const ratio = scale / prev.scale;
    return {
      scale,
      x: pointerX - (pointerX - prev.x) * ratio,
      y: pointerY - (pointerY - prev.y) * ratio,
    };
  };

  // Wheel = zoom at the pointer. A native non-passive listener: React's
  // onWheel is passive, so its preventDefault() was a silent no-op. Pinch
  // gestures arrive as ctrl+wheel with small deltas, so the factor scales
  // with the delta rather than stepping a fixed 10%.
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const delta = Math.max(-120, Math.min(120, event.deltaY));
      const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
      setTransform((prev) => zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top, prev));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    dragMoved.current = false;
    dragging.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
  };
  const onMouseMove = (event: MouseEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!dragMoved.current && Math.hypot(dx, dy) < DRAG_SLOP) return;
    dragMoved.current = true;
    setTransform((prev) => ({ ...prev, x: drag.originX + dx, y: drag.originY + dy }));
  };
  const endDrag = () => {
    dragging.current = null;
  };
  // A pan that started on a card must not also select it on release.
  const onClickCapture = (event: MouseEvent) => {
    if (dragMoved.current) {
      event.stopPropagation();
      dragMoved.current = false;
    }
  };

  const zoomBy = (factor: number) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    glideTo(zoomAt(factor, rect.width / 2, insetTop + (rect.height - insetTop - insetBottom) / 2, transform));
  };

  const recenter = () => {
    const target = layout.placed.find((entry) => entry.item.id === focusId);
    if (target) glideTo(centerOn(target, Math.max(transform.scale, 0.6), FOCUS_ACROSS));
  };

  const fitAll = () => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || layout.placed.length === 0) return;
    const xs = layout.placed.map((entry) => entry.x);
    const ys = layout.placed.map((entry) => entry.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) + nodeWidth - minX;
    const height = Math.max(...ys) + nodeHeight - minY;
    const bandHeight = rect.height - insetTop - insetBottom;
    const scale = clampScale(Math.min((rect.width - 64) / width, (bandHeight - 48) / height, 1));
    glideTo({
      scale,
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: insetTop + (bandHeight - height * scale) / 2 - minY * scale,
    });
  };

  const zoom = transform.scale < 0.45 ? "far" : transform.scale < 0.8 ? "mid" : "near";
  const skinVars = {
    "--pf-tree-x": `${transform.x}px`,
    "--pf-tree-y": `${transform.y}px`,
    "--pf-tree-scale": String(transform.scale),
  } as CSSProperties;

  return (
    <div
      ref={container}
      className={[styles.canvas, className].filter(Boolean).join(" ")}
      style={skinVars}
      data-zoom={zoom}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      <div
        className={`${styles.world} ${gliding ? styles.gliding : ""}`}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        <svg className={styles.edges}>
          {layout.edges.map(({ from, to }) => {
            const d = edgePath(
              edgeShape,
              from.x + nodeWidth,
              from.y + nodeHeight / 2,
              to.x,
              to.y + nodeHeight / 2,
            );
            return (
              <g
                key={`${from.item.id}-${to.item.id}`}
                className={`${styles.edge} ${edgeClassName?.(from.item, to.item) ?? ""}`}
              >
                <path data-edge="halo" d={d} />
                <path data-edge="line" d={d} />
                <path data-edge="flow" d={d} />
              </g>
            );
          })}
        </svg>
        {layout.placed.map(({ item, x, y }) => (
          <div
            key={item.id}
            className={styles.node}
            style={{ left: x, top: y, width: nodeWidth, height: nodeHeight }}
          >
            {renderNode(item)}
          </div>
        ))}
      </div>

      <div
        className={styles.controls}
        // Controls sit on the canvas: a press here must not start a pan.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Button variant="ghost" size="sm" icon title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} />
        </Button>
        <span className={styles.zoomReadout}>{Math.round(transform.scale * 100)}%</span>
        <Button variant="ghost" size="sm" icon title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} />
        </Button>
        <span className={styles.controlRule} />
        <Button
          variant="ghost"
          size="sm"
          icon
          title="Center on the present"
          aria-label="Center on the present"
          disabled={!focusId}
          onClick={recenter}
        >
          <Crosshair size={15} />
        </Button>
        <Button variant="ghost" size="sm" icon title="Fit the whole tree" aria-label="Fit the whole tree" onClick={fitAll}>
          <Maximize size={14} />
        </Button>
      </div>
    </div>
  );
}
