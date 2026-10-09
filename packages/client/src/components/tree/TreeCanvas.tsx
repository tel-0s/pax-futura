import { useMemo, useRef, useState, type ReactNode, type WheelEvent, type MouseEvent } from "react";
import { hierarchy, tree } from "d3-hierarchy";
import styles from "./TreeCanvas.module.css";

export interface TreeCanvasItem {
  id: string;
  parentId: string | null;
}

interface TreeCanvasProps<T extends TreeCanvasItem> {
  items: T[];
  nodeWidth: number;
  nodeHeight: number;
  gapX?: number;
  gapY?: number;
  renderNode: (item: T) => ReactNode;
  /** Style hook per edge; e.g. canonical vs sibling. */
  edgeClassName?: (parent: T, child: T) => string;
  /** Node id to center on first layout. */
  focusId?: string | null | undefined;
}

interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

/**
 * The shared tree renderer behind the loom view and conversation trees:
 * d3-hierarchy tidy-tree layout rotated to horizontal (time flows left to
 * right), HTML cards for real content, one SVG layer for edges, and a
 * hand-rolled pan/zoom transform.
 */
export function TreeCanvas<T extends TreeCanvasItem>({
  items,
  nodeWidth,
  nodeHeight,
  gapX = 48,
  gapY = 16,
  renderNode,
  edgeClassName,
  focusId,
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

  const [transform, setTransform] = useState(() => ({ x: 80, y: 0, scale: 1 }));
  const [centeredOnce, setCenteredOnce] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Center the focused node on first layout (not on every change).
  if (!centeredOnce && focusId && container.current) {
    const target = layout.placed.find((entry) => entry.item.id === focusId);
    if (target) {
      const rect = container.current.getBoundingClientRect();
      setTransform({
        x: rect.width / 2 - target.x - nodeWidth / 2,
        y: rect.height / 2 - target.y,
        scale: 1,
      });
      setCenteredOnce(true);
    }
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setTransform((prev) => {
      const scale = Math.min(2, Math.max(0.25, prev.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
      const ratio = scale / prev.scale;
      return {
        scale,
        x: pointerX - (pointerX - prev.x) * ratio,
        y: pointerY - (pointerY - prev.y) * ratio,
      };
    });
  };

  const onMouseDown = (event: MouseEvent) => {
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
    setTransform((prev) => ({
      ...prev,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };
  const endDrag = () => {
    dragging.current = null;
  };

  return (
    <div
      ref={container}
      className={styles.canvas}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        className={styles.world}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        <svg className={styles.edges}>
          {layout.edges.map(({ from, to }) => {
            const x1 = from.x + nodeWidth;
            const y1 = from.y + nodeHeight / 2;
            const x2 = to.x;
            const y2 = to.y + nodeHeight / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${from.item.id}-${to.item.id}`}
                className={`${styles.edge} ${edgeClassName?.(from.item, to.item) ?? ""}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              />
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
    </div>
  );
}
