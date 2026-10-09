import { useEffect, useState } from "react";
import { Check, FastForward, ListTodo, Pencil, Trash } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { useLoomStore } from "../../stores/loom.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./OrdersDrawer.module.css";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
/** Save-edit chord label: ⌘ on Apple keyboards, Ctrl elsewhere (both work). */
const MOD_KEY = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl";

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

  const save = (orderId: string) => {
    if (!editText.trim()) return;
    void update(gameId, nodeId, orderId, editText.trim());
    setEditingId(null);
  };

  return (
    <Drawer
      side="left"
      title="Order queue"
      kicker={
        orders.length > 0
          ? `${orders.length} dispatch${orders.length === 1 ? "" : "es"} · next turn`
          : "Dispatches for next turn"
      }
      icon={<ListTodo size={16} />}
      onClose={() => setLeftDrawer(null)}
    >
      {orders.length === 0 ? (
        <div className={styles.empty}>
          <ListTodo size={24} aria-hidden />
          <p>
            No orders queued. Write orders in the command line below — they accumulate here until you
            advance time.
          </p>
        </div>
      ) : (
        <ol className={styles.list}>
          {orders.map((order, index) => (
            <li key={order.id} className={`${styles.slip} ${editingId === order.id ? styles.slipEditing : ""}`}>
              <span className={styles.number} aria-label={`Order ${index + 1}`}>
                <span className={styles.numberLabel}>No.</span>
                <span className={styles.numberIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.numberRoman}>{ROMAN[index + 1] ?? index + 1}</span>
              </span>
              {editingId === order.id ? (
                <div className={styles.editBox}>
                  <textarea
                    className={styles.editArea}
                    rows={4}
                    autoFocus
                    aria-label={`Edit order ${index + 1}`}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        save(order.id);
                      }
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                  <div className={styles.editActions}>
                    <span className={styles.editHint}>
                      <kbd>{MOD_KEY}</kbd>
                      <kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" disabled={!editText.trim()} onClick={() => save(order.id)}>
                      <Check size={13} /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={styles.text}>{order.text || order.title}</p>
                  <span className={styles.actions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      title="Edit order"
                      aria-label={`Edit order ${index + 1}`}
                      onClick={() => {
                        setEditingId(order.id);
                        setEditText(order.text || order.title);
                      }}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      className={styles.remove}
                      title="Remove order"
                      aria-label={`Remove order ${index + 1}`}
                      onClick={() => void remove(gameId, nodeId, order.id)}
                    >
                      <Trash size={13} />
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {orders.length > 0 ? (
        <aside className={styles.dispatchHint}>
          <span className={styles.hintIcon} aria-hidden>
            <FastForward size={15} />
          </span>
          <p>
            These ride out together when you press <strong>Advance time</strong> <kbd>T</kbd> at the
            bottom right. Until then, each can be edited or withdrawn.
          </p>
        </aside>
      ) : null}
    </Drawer>
  );
}
