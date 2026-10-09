import { useEffect } from "react";
import { Button } from "../../components/Button.tsx";
import { useGazetteStore } from "./gazetteStore.ts";
import styles from "./gazette.module.css";

/** The turn's front page: a full-bleed themed overlay, styled by the engine
 *  in period voice. Cached per node — reopening the same turn is instant. */
export function GazettePanel({
  gameId,
  nodeId,
  onClose,
}: {
  gameId: string;
  nodeId: string;
  onClose: () => void;
}) {
  const gazette = useGazetteStore((state) => state.byNode[nodeId]);
  const loading = useGazetteStore((state) => state.loading[nodeId]);
  const error = useGazetteStore((state) => state.error[nodeId]);
  const fetchGazette = useGazetteStore((state) => state.fetch);

  useEffect(() => {
    void fetchGazette(gameId, nodeId);
  }, [gameId, nodeId, fetchGazette]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [lead, ...rest] = gazette?.articles ?? [];

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <button className={styles.close} onClick={onClose} aria-label="Close gazette">
          ✕
        </button>

        <header className={styles.masthead}>
          <h1 className={styles.title}>{gazette?.masthead ?? "The Gazette"}</h1>
          <div className={styles.byline}>
            <span>{gazette?.dateline}</span>
            {gazette?.motto ? <span className={styles.motto}>{gazette.motto}</span> : null}
          </div>
        </header>
        <div className={styles.rule} />

        {loading && !gazette ? <p className={styles.status}>Setting the type…</p> : null}
        {error ? <p className={styles.status}>{error}</p> : null}

        {lead ? (
          <article className={styles.lead}>
            <span className={styles.kicker}>{lead.kind}</span>
            <h2 className={styles.leadHeadline}>{lead.headline}</h2>
            <p className={styles.leadBody}>{lead.body}</p>
          </article>
        ) : null}

        {rest.length > 0 ? (
          <div className={styles.columns}>
            {rest.map((article, index) => (
              <article key={index} className={styles.article}>
                <span className={styles.kicker}>{article.kind}</span>
                <h3 className={styles.headline}>{article.headline}</h3>
                <p className={styles.body}>{article.body}</p>
              </article>
            ))}
          </div>
        ) : null}

        {gazette ? (
          <footer className={styles.footer}>
            <Button
              variant="ghost"
              disabled={Boolean(loading)}
              onClick={() => void fetchGazette(gameId, nodeId, true)}
            >
              ↻ Fresh edition
            </Button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
