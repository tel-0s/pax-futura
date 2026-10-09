import type { ReactNode } from "react";
import styles from "./Drawer.module.css";
import { Button } from "./Button.tsx";

export function Drawer({
  side,
  title,
  onClose,
  children,
}: {
  side: "left" | "right";
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={`${styles.drawer} ${styles[side]}`}>
      <header className={styles.header}>
        <span>{title}</span>
        <Button variant="ghost" onClick={onClose} aria-label="Close panel">
          ✕
        </Button>
      </header>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
