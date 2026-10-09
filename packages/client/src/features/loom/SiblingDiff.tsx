import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DivergenceReport, TimelineNodeMeta, WorldState } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { focusCountry, focusRegion } from "../../lib/mapController.ts";
import { selectSiblings, useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useWorldStore } from "../../stores/world.ts";
import { Button } from "../../components/Button.tsx";
import styles from "./SiblingDiff.module.css";

type Side = "a" | "b";

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const label = (node: TimelineNodeMeta | undefined, side: Side): string =>
  node ? `${side.toUpperCase()} · ${node.anchor || node.summary || node.gameDate}` : side.toUpperCase();

const hasDeltas = (report: DivergenceReport): boolean =>
  report.regionChanges.length > 0 ||
  report.polityDiffs.length > 0 ||
  report.unitDiffs.length > 0 ||
  report.markerDiffs.length > 0;

/**
 * Two re-rolls of the same turn, side by side: the deterministic world delta
 * plus the archivist's point-of-divergence account. The map stays live beside
 * the panel and can be painted with either sibling's world, so "what actually
 * changed" is legible on the map, not just in prose.
 */
export function SiblingDiff({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const gameId = useSessionStore((state) => state.gameId);
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);

  // Only complete siblings have a world to diff; the node itself is A. The
  // default B is the NEXT re-roll in creation order (ids are ULIDs), wrapping
  // around, so "compare" on the first of three opens the pair beside it.
  const others = useMemo(() => {
    const all = selectSiblings(nodes, nodeId);
    const index = all.findIndex((sibling) => sibling.id === nodeId);
    return [...all.slice(index + 1), ...all.slice(0, Math.max(index, 0))].filter(
      (sibling) => sibling.id !== nodeId && sibling.status === "complete",
    );
  }, [nodes, nodeId]);

  const [otherId, setOtherId] = useState<string | null>(others[0]?.id ?? null);
  // A branch can vanish under us (deleted over SSE) — fall back to whatever
  // sibling is still there rather than diffing against a ghost.
  useEffect(() => {
    setOtherId((current) =>
      current && others.some((sibling) => sibling.id === current) ? current : (others[0]?.id ?? null),
    );
  }, [others]);

  const [report, setReport] = useState<DivergenceReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const reports = useRef(new Map<string, DivergenceReport>());

  useEffect(() => {
    if (!gameId || !otherId) return;
    const key = `${nodeId}|${otherId}`;
    const cached = reports.current.get(key);
    if (cached) {
      setReport(cached);
      setStatus("ready");
      return;
    }
    let live = true;
    setStatus("loading");
    setReport(null);
    setError(null);
    api
      .getDiff(gameId, nodeId, otherId)
      .then((data) => {
        if (!live) return;
        reports.current.set(key, data);
        setReport(data);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Could not compare these branches");
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [gameId, nodeId, otherId]);

  // Map painting. The overlay already previewed the selected node before we
  // opened, so A is what the map is showing on arrival.
  const [painted, setPainted] = useState<Side>("a");
  const paintedRef = useRef<Side>("a");
  const worlds = useRef(new Map<string, WorldState>());
  // Flipped on unmount: an in-flight sibling fetch resolving AFTER close must
  // never write into the world store — it would clobber the live restore.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const paint = useCallback(
    async (side: Side) => {
      const id = side === "a" ? nodeId : otherId;
      if (!gameId || !id) return;
      setPainted(side);
      paintedRef.current = side;
      let world = worlds.current.get(id);
      if (!world) {
        try {
          world = await api.getWorld(gameId, id);
          worlds.current.set(id, world);
        } catch {
          return;
        }
      }
      // A slower fetch must not overwrite a newer choice — or outlive us.
      if (!alive.current || paintedRef.current !== side) return;
      useWorldStore.setState({ forNodeId: id, world, loading: false });
    },
    [gameId, nodeId, otherId],
  );

  // Changing the compared sibling while B is painted would leave the map
  // showing the OLD sibling under a card claiming the new one — snap back to A.
  useEffect(() => {
    if (paintedRef.current !== "a") {
      setPainted("a");
      paintedRef.current = "a";
      void paint("a");
    }
  }, [otherId, paint]);

  // Whatever closes us — ✕, Escape, or the whole loom — the live world must be
  // what the map shows next. Unmount-only via ref so a turn completing while
  // we're open doesn't yank the map out from under a painted sibling.
  const restoreLive = useCallback(() => {
    if (gameId && currentNodeId) void useWorldStore.getState().load(gameId, currentNodeId);
  }, [gameId, currentNodeId]);
  const restoreRef = useRef(restoreLive);
  restoreRef.current = restoreLive;
  useEffect(() => () => restoreRef.current(), []);

  const a = nodes[nodeId];
  const b = otherId ? nodes[otherId] : undefined;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>⇄ Compare re-rolls</span>
        <Button variant="ghost" onClick={onClose} title="Back to the tree (esc)">
          ✕
        </Button>
      </header>

      <div className={styles.versions}>
        <VersionCard node={a} side="a" active={painted === "a"} onView={() => void paint("a")} />
        <VersionCard node={b} side="b" active={painted === "b"} onView={() => void paint("b")} />
      </div>

      {others.length > 1 ? (
        <label className={styles.picker}>
          Compare against
          <select
            className={styles.select}
            value={otherId ?? ""}
            onChange={(event) => setOtherId(event.target.value)}
          >
            {others.map((sibling) => (
              <option key={sibling.id} value={sibling.id}>
                {truncate(sibling.anchor || sibling.summary || sibling.gameDate, 60)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className={styles.body}>
        {others.length === 0 ? <p className={styles.empty}>This turn has no completed sibling to compare.</p> : null}
        {status === "loading" && others.length > 0 ? <p className={styles.empty}>Comparing…</p> : null}
        {status === "error" && error ? <p className={styles.error}>{error}</p> : null}

        {status === "ready" && report ? <ReportView report={report} /> : null}
      </div>
    </div>
  );
}

function VersionCard({
  node,
  side,
  active,
  onView,
}: {
  node: TimelineNodeMeta | undefined;
  side: Side;
  active: boolean;
  onView: () => void;
}) {
  return (
    <article className={`${styles.version} ${active ? styles.versionActive : ""}`}>
      <span className={styles.versionHead}>
        <span className={styles.sideTag}>{side.toUpperCase()}</span>
        <span className={styles.date}>{node?.gameDate ?? "—"}</span>
      </span>
      <p className={styles.versionSummary}>{node?.summary || "(no summary)"}</p>
      <button className={styles.viewButton} onClick={onView} disabled={!node} title={`Paint ${label(node, side)} on the map`}>
        {active ? "◉ Showing" : `View ${side.toUpperCase()}`}
      </button>
    </article>
  );
}

function ReportView({ report }: { report: DivergenceReport }) {
  const { narrative } = report;
  if (!narrative && !hasDeltas(report)) {
    return <p className={styles.empty}>These branches agree completely.</p>;
  }

  return (
    <>
      {narrative ? (
        <section className={styles.section}>
          <h3 className={styles.narrativeTitle}>{narrative.title}</h3>
          {narrative.narrative
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className={styles.paragraph}>
                {paragraph}
              </p>
            ))}
          {narrative.keyDifferences.length > 0 ? (
            <ul className={styles.keyDifferences}>
              {narrative.keyDifferences.map((difference, index) => (
                <li key={index}>{difference}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {report.regionChanges.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Territory</h3>
          <ul className={styles.rows}>
            {report.regionChanges.map((change) => (
              <li key={change.regionId}>
                <button
                  className={styles.regionRow}
                  title="Focus the map here"
                  onClick={() => {
                    if (!focusRegion(change.regionId)) focusCountry(change.regionId);
                  }}
                >
                  <span className={styles.regionName}>{change.regionName || change.regionId}</span>
                  <span className={styles.owners}>
                    {change.a ?? "unowned"} <span className={styles.versus}>vs</span> {change.b ?? "unowned"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <LineSection title="Powers" lines={report.polityDiffs} />
      <LineSection title="Forces" lines={report.unitDiffs} />
      <LineSection title="Structures" lines={report.markerDiffs} />
    </>
  );
}

function LineSection({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.lines}>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
