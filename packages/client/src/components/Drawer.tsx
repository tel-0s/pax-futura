import type { ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./Drawer.module.css";
import { Button } from "./Button.tsx";

/**
 * A docked panel over the map. Left drawers start at the rail's edge (the
 * rail stays usable to switch drawers); right drawers hug the viewport edge.
 * The material — glass, paper, machined plate — comes from the theme skin.
 */
export function Drawer({
  side,
  title,
  kicker,
  icon,
  actions,
  wide = false,
  onClose,
  children,
}: {
  side: "left" | "right";
  title: ReactNode;
  /** Small label above the title (section code, count, context). */
  kicker?: ReactNode;
  icon?: ReactNode;
  /** Extra header controls rendered before the close button. */
  actions?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={`${styles.drawer} ${styles[side]} ${wide ? styles.wide : ""} pfPanel`} data-occludes={side}>
      <header className={styles.header}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <div className={styles.heading}>
          {kicker ? <span className={`${styles.kicker} pfKicker`}>{kicker}</span> : null}
          <h2 className={`${styles.title} pfTitle`}>{title}</h2>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          <X size={16} />
        </Button>
      </header>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
