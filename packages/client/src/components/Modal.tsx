import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button.tsx";
import styles from "./Modal.module.css";

/** Open modals, bottom → top. */
const openModals: object[] = [];

/**
 * Centered dialog, portaled to <body>: panels use backdrop-filter and
 * clip-path for their material, either of which would otherwise trap a
 * fixed-position modal rendered from inside a drawer.
 */
export function Modal({
  title,
  kicker,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  // Escape closes only the TOPMOST modal (Import theme over Settings must not
  // take Settings down with it). The stack is module-level: mount order is
  // stacking order since every modal portals to the end of <body>.
  const token = useRef<object>({});
  useEffect(() => {
    const self = token.current;
    openModals.push(self);
    return () => {
      const index = openModals.lastIndexOf(self);
      if (index >= 0) openModals.splice(index, 1);
    };
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openModals[openModals.length - 1] !== token.current) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={`${styles.modal} ${styles[size]} pfPanel`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            {kicker ? <span className="pfKicker">{kicker}</span> : null}
            <h2 className={`${styles.title} pfTitle`}>{title}</h2>
          </div>
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={16} />
          </Button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
