import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Popover.module.css";

/**
 * An anchored floating panel: rendered inside a positioned wrapper around its
 * trigger, dismissed by Escape or a pointer-down anywhere outside.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = "end",
  side = "bottom",
  width,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className={styles.anchor}>
      {trigger}
      {open ? (
        <div
          className={`${styles.panel} ${styles[align]} ${styles[side]} pfPanel`}
          style={width ? { width } : undefined}
          role="dialog"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
