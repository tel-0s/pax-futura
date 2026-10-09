import type { ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: ReactNode;
}

export function Tabs({
  items,
  activeId,
  onSelect,
}: {
  items: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === activeId}
          className={`${styles.tab} ${item.id === activeId ? styles.active : ""}`}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
