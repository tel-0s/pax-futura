import styles from "./PolityFlag.module.css";

/**
 * A polity's banner: an emoji flag, an uploaded image (data URL), or — when it
 * has neither — an escutcheon filled with its map color, so every nation has
 * a mark wherever it's named.
 */
export function PolityFlag({
  flag,
  color,
  size = 20,
  title,
}: {
  flag?: string | null | undefined;
  color?: string | undefined;
  size?: number;
  title?: string | undefined;
}) {
  const dimension = { width: size, height: size, fontSize: size * 0.82 };
  if (flag && flag.startsWith("data:")) {
    return (
      <span className={styles.flag} style={dimension} title={title}>
        <img src={flag} alt="" className={styles.image} />
      </span>
    );
  }
  if (flag) {
    return (
      <span className={`${styles.flag} ${styles.emoji}`} style={dimension} title={title}>
        {flag}
      </span>
    );
  }
  return (
    <span className={styles.flag} style={dimension} title={title}>
      <svg viewBox="0 0 20 22" className={styles.shield} aria-hidden>
        <path
          d="M2 2h16v8.5c0 5-3.6 8.4-8 10-4.4-1.6-8-5-8-10z"
          style={{ fill: color ?? "currentColor" }}
        />
        <path d="M2 2h16v8.5c0 5-3.6 8.4-8 10-4.4-1.6-8-5-8-10z" className={styles.shieldEdge} />
      </svg>
    </span>
  );
}
