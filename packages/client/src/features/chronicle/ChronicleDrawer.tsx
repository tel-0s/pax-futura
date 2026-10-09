import { useEffect, useRef, useState } from "react";
import { ERA_SPAN, type ChronicleResponse } from "@pax/domain";
import { Drawer } from "../../components/Drawer.tsx";
import { api } from "../../lib/api.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./chronicle.module.css";

const EMPTY: ChronicleResponse = { eras: [], recent: [] };

/** The intel mark the engine's digest renderer puts at the head of a line. */
const CONFIDENCE_MARK = /^\((reported|rumor)\) /;

/** One digest line, with its "(reported)"/"(rumor)" head lifted into a badge.
 *  The prefix is the engine's wire format — keep the words, only style them. */
function DigestLine({ line }: { line: string }) {
  const match = CONFIDENCE_MARK.exec(line);
  if (!match) return <>{line}</>;
  return (
    <>
      <span className={match[1] === "rumor" ? styles.rumor : styles.reported}>{`(${match[1]})`}</span>{" "}
      {line.slice(match[0].length)}
    </>
  );
}

/** The campaign's history along the checked-out branch, newest first: the
 *  unsummarized tail, then one card per settled era. */
export function ChronicleDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodeId = useLoomStore((state) => state.currentNodeId);
  // Extraction and era summarization land AFTER the node activates; the
  // facts.updated SSE bumps this counter so an open drawer refetches.
  const factsVersion = useLoomStore((state) => state.factsVersion);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const [chronicle, setChronicle] = useState<ChronicleResponse>(EMPTY);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const shownNodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId || !nodeId) return;
    let live = true;
    // A node switch resets the view (another branch's history must never show
    // under this node's heading); a factsVersion bump for the SAME node is a
    // silent background refresh — keep the current content visible.
    if (shownNodeRef.current !== nodeId) {
      setStatus("loading");
      setChronicle(EMPTY);
    }
    shownNodeRef.current = nodeId;
    setError(null);
    api
      .getChronicle(gameId, nodeId)
      .then((data) => {
        if (!live) return;
        setChronicle(data);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Could not load the chronicle");
        setStatus("error");
      });
    // A stale response from the previous node must not overwrite the new one.
    return () => {
      live = false;
    };
  }, [gameId, nodeId, factsVersion]);

  if (!gameId || !nodeId) return null;

  const recent = chronicle.recent.filter((turn) => turn.summary || turn.lines.length > 0);
  const isEmpty = chronicle.eras.length === 0 && recent.length === 0;

  return (
    <Drawer side="left" title="Chronicle" onClose={() => setLeftDrawer(null)}>
      {status === "error" && error ? <p className={styles.error}>{error}</p> : null}
      {status === "loading" ? <p className={styles.empty}>Loading…</p> : null}

      {isEmpty && status === "ready" ? (
        <p className={styles.empty}>
          Nothing chronicled yet. Recent turns appear here as you play, and every {ERA_SPAN} turns
          the archivist folds them into an era summary with its own open-threads ledger.
        </p>
      ) : null}

      {recent.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Recent history</h3>
          <ol className={styles.turns}>
            {[...recent].reverse().map((turn) => (
              <li key={turn.depth} className={styles.turn}>
                <span className={styles.turnHead}>
                  Turn {turn.depth} · {turn.gameDate}
                </span>
                {turn.summary ? <p className={styles.turnSummary}>{turn.summary}</p> : null}
                {turn.lines.length > 0 ? (
                  <details className={styles.digestDetails}>
                    <summary className={styles.digestToggle}>
                      {turn.lines.length} extracted fact{turn.lines.length === 1 ? "" : "s"}
                    </summary>
                    <ul className={styles.digest}>
                      {turn.lines.map((line, index) => (
                        <li key={index}>
                          <DigestLine line={line} />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {chronicle.eras.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Eras</h3>
          <div className={styles.eras}>
            {[...chronicle.eras].reverse().map((era) => (
              <article key={`${era.startNodeId}:${era.endNodeId}`} className={styles.era}>
                <h4 className={styles.eraTitle}>{era.title}</h4>
                <span className={styles.eraRange}>
                  {era.startDate} → {era.endDate} · turns {era.startDepth}–{era.endDepth}
                </span>
                <p className={styles.eraSummary}>{era.summary}</p>
                {era.openThreads.length > 0 ? (
                  <>
                    <h5 className={styles.threadsTitle}>Open threads</h5>
                    <ul className={styles.threads}>
                      {era.openThreads.map((thread, index) => (
                        <li key={index}>{thread}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </Drawer>
  );
}
