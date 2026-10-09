import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { useLoomStore } from "../../stores/loom.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./OrdersDrawer.module.css";

/** The order queue: everything submitted for the next turn, editable until
 *  the fast-forward consumes it. */
export function OrdersDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodeId = useLoomStore((state) => state.currentNodeId);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const { orders, load, remove, update } = useOrdersStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    if (gameId && nodeId) void load(gameId, nodeId);
  }, [gameId, nodeId, load]);

  if (!gameId || !nodeId) return null;

  return (
    <Drawer side="left" title={`Order queue (${orders.length})`} onClose={() => setLeftDrawer(null)}>
      {orders.length === 0 ? (
        <p className={styles.empty}>
          No orders queued. Write orders in the composer below — they accumulate here until you
          fast-forward time (⏩).
        </p>
      ) : (
        <ul className={styles.list}>
          {orders.map((order, index) => (
            <li key={order.id} className={styles.item}>
              {editingId === order.id ? (
                <div className={styles.editBox}>
                  <textarea
                    className={styles.editArea}
                    rows={3}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                  />
                  <div className={styles.editActions}>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!editText.trim()}
                      onClick={() => {
                        void update(gameId, nodeId, order.id, editText.trim());
                        setEditingId(null);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={styles.index}>{index + 1}</span>
                  <span className={styles.text}>{order.text || order.title}</span>
                  <span className={styles.actions}>
                    <button
                      className={styles.iconButton}
                      title="Edit order"
                      onClick={() => {
                        setEditingId(order.id);
                        setEditText(order.text || order.title);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className={styles.iconButton}
                      title="Remove order"
                      onClick={() => void remove(gameId, nodeId, order.id)}
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
