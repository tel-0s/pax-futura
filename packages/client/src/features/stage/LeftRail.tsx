import { useUiStore, type LeftDrawer } from "../../stores/ui.ts";
import styles from "./LeftRail.module.css";

const RAIL_ITEMS: Array<{ id: Exclude<LeftDrawer, null>; icon: string; label: string }> = [
  { id: "orders", icon: "🗒", label: "Order queue" },
  { id: "inspector", icon: "⌖", label: "Inspector" },
  { id: "forces", icon: "⚔", label: "Forces" },
  { id: "events", icon: "📜", label: "Chronicle" },
  { id: "search", icon: "⌕", label: "Search" },
  { id: "gm", icon: "✎", label: "Game master" },
];

/** Icon rail; exactly one left drawer opens at a time (exclusive occupancy). */
export function LeftRail() {
  const leftDrawer = useUiStore((state) => state.leftDrawer);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);

  return (
    <nav className={styles.rail}>
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.id}
          title={item.label}
          className={`${styles.item} ${leftDrawer === item.id ? styles.active : ""}`}
          onClick={() => setLeftDrawer(item.id)}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
