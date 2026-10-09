import { Crosshair, ListTodo, ScrollText, Search, Swords, WandSparkles, type LucideIcon } from "lucide-react";
import { useOrdersStore } from "../../stores/orders.ts";
import { useUiStore, type LeftDrawer } from "../../stores/ui.ts";
import styles from "./LeftRail.module.css";

export const RAIL_ITEMS: Array<{
  id: Exclude<LeftDrawer, null>;
  icon: LucideIcon;
  label: string;
  hotkey: string;
}> = [
  { id: "orders", icon: ListTodo, label: "Order queue", hotkey: "O" },
  { id: "inspector", icon: Crosshair, label: "Dossier", hotkey: "I" },
  { id: "forces", icon: Swords, label: "Forces", hotkey: "F" },
  { id: "events", icon: ScrollText, label: "Chronicle", hotkey: "C" },
  { id: "search", icon: Search, label: "Search", hotkey: "/" },
  { id: "gm", icon: WandSparkles, label: "Game master", hotkey: "G" },
];

/** Icon rail; exactly one left drawer opens at a time (exclusive occupancy). */
export function LeftRail() {
  const leftDrawer = useUiStore((state) => state.leftDrawer);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const queued = useOrdersStore((state) => state.orders.length);

  return (
    <nav className={styles.rail} aria-label="Panels" data-occludes="left">
      {RAIL_ITEMS.map((item, index) => {
        const Icon = item.icon;
        const active = leftDrawer === item.id;
        return (
          <div key={item.id} className={styles.slot}>
            {index === RAIL_ITEMS.length - 1 ? <span className={styles.rule} /> : null}
            <button
              aria-label={item.label}
              aria-pressed={active}
              title={item.label}
              className={`${styles.item} ${active ? styles.active : ""}`}
              onClick={() => setLeftDrawer(item.id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              {item.id === "orders" && queued > 0 ? <span className={styles.count}>{queued}</span> : null}
            </button>
            <span className={styles.tip} role="tooltip">
              {item.label}
              <kbd>{item.hotkey}</kbd>
            </span>
          </div>
        );
      })}
    </nav>
  );
}
