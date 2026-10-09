import styles from "./BrandMark.module.css";

/**
 * The Pax Futura mark: a hexagonal seal enclosing a timeline that branches —
 * one trunk, a canonical path and a sibling — the loom in four strokes.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg className={styles.mark} width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path className={styles.seal} d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25z" />
      <path className={styles.sealInner} d="M16 5.6 25 10.8v10.4L16 26.4 7 21.2V10.8z" />
      <path className={styles.trunk} d="M16 23.5V16l5-5.5" />
      <path className={styles.branch} d="M16 16l-5-5.5" />
      <circle className={styles.node} cx="16" cy="23.5" r="1.8" />
      <circle className={styles.nodeHot} cx="21" cy="10.5" r="2.2" />
      <circle className={styles.node} cx="11" cy="10.5" r="1.6" />
    </svg>
  );
}
