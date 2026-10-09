import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowLeftRight,
  Bookmark,
  Castle,
  Equal,
  Eye,
  Feather,
  Flag,
  GitBranch,
  GitCompareArrows,
  Landmark,
  MapPinned,
  MessagesSquare,
  Plus,
  Swords,
  TriangleAlert,
  X,
} from "lucide-react";
import type { DivergenceReport, Theme, TimelineNodeMeta, WorldState } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { formatGameDate } from "../../lib/dates.ts";
import { focusCountry, focusRegion } from "../../lib/mapController.ts";
import { selectSiblings, useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { parseHex } from "../../theme/color.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
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

/** Hue in degrees, or null for greys/unparseable colours. */
const hueOf = (color: string): number | null => {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.04) return null;
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
};

/**
 * A is always the accent; B takes whichever of the theme's warning/info
 * colours sits furthest round the hue wheel from it, so the two tellings
 * never read as the same ink (blue deck → amber B, rubric atlas → blue B).
 */
const sideBColor = (theme: Theme): string => {
  const accent = hueOf(theme.color.accent.base);
  const distance = (color: string): number => {
    const hue = hueOf(color);
    if (accent === null || hue === null) return 0;
    const raw = Math.abs(accent - hue) % 360;
    return Math.min(raw, 360 - raw);
  };
  return distance(theme.color.semantic.info) > distance(theme.color.semantic.warning)
    ? "var(--pf-semantic-info)"
    : "var(--pf-semantic-warning)";
};

/** Which telling a delta line belongs to: present only in A, only in B, or
 *  different in both (null). Presentational only — matches the phrasing of
 *  engine/src/loom/compare.ts ("… in A only", "… in A …, gone/razed in B"). */
const leanOf = (line: string): Side | null => {
  if (/\bin A only\b/.test(line) || /\bin A\b[^,]*, (?:gone|razed) in B\b/.test(line)) return "a";
  if (/\bin B only\b/.test(line) || /\bin B\b[^,]*, (?:gone|razed) in A\b/.test(line)) return "b";
  return null;
};

/** Line text with "in A"/"in B" inked in the side colours and "->" as an arrow. */
const inkLine = (line: string): ReactNode[] =>
  line
    .replace(/ -> /g, " → ")
    .split(/\b(in [AB])\b/)
    .map((part, index) =>
      part === "in A" || part === "in B" ? (
        <span key={index}>
          in <b className={part.endsWith("A") ? styles.inkA : styles.inkB}>{part.slice(-1)}</b>
        </span>
      ) : (
        part
      ),
    );

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
  const themeId = useUiStore((state) => state.themeId);
  const themes = useThemesStore((state) => state.themes);
  const world = useWorldStore((state) => state.world);
  const theme = useMemo(() => selectTheme(themes, themeId), [themes, themeId]);
  // Owner swatches + names come from whichever sibling world is painted —
  // polity codes, colours and names are shared by both tellings.
  const palette = useMemo(() => (world ? buildPolityPalette(theme, world) : {}), [theme, world]);
  const names = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(world?.polities ?? {}).map(([code, polity]) => [code, polity.name || code]),
      ),
    [world],
  );

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
  const siblingOrder = useMemo(() => selectSiblings(nodes, nodeId).map((sibling) => sibling.id), [nodes, nodeId]);

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
  const sideVars = { "--pf-diff-b": sideBColor(theme) } as CSSProperties;
  const rollOf = (node: TimelineNodeMeta | undefined): string =>
    node ? `Re-roll ${siblingOrder.indexOf(node.id) + 1} of ${siblingOrder.length}` : "";

  return (
    <div className={`${styles.panel} pfPanel`} style={sideVars}>
      <header className={styles.header}>
        <span className={styles.mark} aria-hidden>
          <GitCompareArrows size={18} />
        </span>
        <div className={styles.heading}>
          <span className="pfKicker">Compare re-rolls · Turn {a?.depth ?? "—"}</span>
          <h2 className={`${styles.title} pfTitle`}>Point of divergence</h2>
        </div>
        <Button variant="ghost" icon onClick={onClose} title="Back to the tree (esc)" aria-label="Back to the tree">
          <X size={18} />
        </Button>
      </header>

      <div className={styles.versions}>
        <VersionCard
          node={a}
          side="a"
          roll={rollOf(a)}
          isPresent={a?.id === currentNodeId}
          active={painted === "a"}
          onView={() => void paint("a")}
        />
        <span className={styles.versus} aria-hidden>
          vs
        </span>
        <VersionCard
          node={b}
          side="b"
          roll={rollOf(b)}
          isPresent={b?.id === currentNodeId}
          active={painted === "b"}
          onView={() => void paint("b")}
        />
      </div>

      {others.length > 1 ? (
        <label className={styles.picker}>
          <span className="pfKicker">Compare against</span>
          <select
            className={styles.select}
            value={otherId ?? ""}
            onChange={(event) => setOtherId(event.target.value)}
          >
            {others.map((sibling) => (
              <option key={sibling.id} value={sibling.id}>
                {`${rollOf(sibling)} — ${truncate(sibling.anchor || sibling.summary || sibling.gameDate, 60)}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className={styles.body}>
        {others.length === 0 ? (
          <EmptyState icon={<GitBranch size={24} />}>This turn has no completed sibling to compare.</EmptyState>
        ) : null}
        {status === "loading" && others.length > 0 ? <Loading /> : null}
        {status === "error" && error ? (
          <EmptyState icon={<TriangleAlert size={24} />} tone="danger">
            {error}
          </EmptyState>
        ) : null}

        {status === "ready" && report ? <ReportView report={report} palette={palette} names={names} /> : null}
      </div>
    </div>
  );
}

function VersionCard({
  node,
  side,
  roll,
  isPresent,
  active,
  onView,
}: {
  node: TimelineNodeMeta | undefined;
  side: Side;
  roll: string;
  isPresent: boolean;
  active: boolean;
  onView: () => void;
}) {
  return (
    <article
      className={[styles.version, side === "a" ? styles.sideA : styles.sideB, active ? styles.versionActive : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.versionHead}>
        <span className={styles.sideTag}>{side.toUpperCase()}</span>
        <span className={styles.versionMeta}>
          <span className={styles.date}>{node ? formatGameDate(node.gameDate) : "—"}</span>
          <span className={styles.roll}>
            {roll}
            {isPresent ? " · present" : ""}
          </span>
        </span>
      </span>
      {node?.anchor ? (
        <span className={styles.versionAnchor}>
          <Bookmark size={11} /> {node.anchor}
        </span>
      ) : null}
      <p className={styles.versionSummary}>{node?.summary || "(no summary)"}</p>
      <span className={styles.versionFoot}>
        <span className={styles.counts}>
          {node && node.eventCount > 0 ? (
            <span title={`${node.eventCount} events`}>
              <Flag size={11} /> {node.eventCount}
            </span>
          ) : null}
          {node && node.conversationCount > 0 ? (
            <span title={`${node.conversationCount} conversations`}>
              <MessagesSquare size={11} /> {node.conversationCount}
            </span>
          ) : null}
        </span>
        <button
          className={styles.viewButton}
          onClick={onView}
          disabled={!node}
          aria-pressed={active}
          title={`Paint ${label(node, side)} on the map`}
        >
          {active ? <Eye size={13} /> : <MapPinned size={13} />}
          {active ? "On the map" : "Show on map"}
        </button>
      </span>
    </article>
  );
}

function EmptyState({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <div className={`${styles.empty} ${tone === "danger" ? styles.emptyDanger : ""}`}>
      <span className={styles.emptyIcon}>{icon}</span>
      <p className={styles.emptyText}>{children}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className={styles.loading} aria-live="polite">
      <span className="pfKicker">Comparing the two tellings…</span>
      <span className={styles.skeleton} />
      <span className={styles.skeleton} />
      <span className={`${styles.skeleton} ${styles.skeletonShort}`} />
    </div>
  );
}

function SectionHead({ icon, title, count }: { icon: ReactNode; title: string; count?: number }) {
  return (
    <h3 className={styles.sectionHead}>
      <span className={styles.sectionIcon}>{icon}</span>
      <span className="pfKicker">{title}</span>
      {count !== undefined ? <span className={styles.countPill}>{count}</span> : null}
    </h3>
  );
}

function OwnerChip({
  code,
  palette,
  names,
}: {
  code: string | null;
  palette: Record<string, string>;
  names: Record<string, string>;
}) {
  if (!code) return <span className={`${styles.owner} ${styles.unowned}`}>unowned</span>;
  return (
    <span className={styles.owner} title={code}>
      <span className={styles.swatch} style={{ backgroundColor: palette[code] ?? "var(--pf-text-muted)" }} />
      <span className={styles.ownerName}>{names[code] ?? code}</span>
    </span>
  );
}

function ReportView({
  report,
  palette,
  names,
}: {
  report: DivergenceReport;
  palette: Record<string, string>;
  names: Record<string, string>;
}) {
  const { narrative } = report;
  if (!narrative && !hasDeltas(report)) {
    return <EmptyState icon={<Equal size={24} />}>These branches agree completely.</EmptyState>;
  }

  return (
    <>
      {narrative ? (
        <section className={`${styles.section} ${styles.narrative}`}>
          <SectionHead icon={<Feather size={13} />} title="The archivist’s account" />
          <h4 className={styles.narrativeTitle}>{narrative.title}</h4>
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
            <ol className={styles.keyDifferences}>
              {narrative.keyDifferences.map((difference, index) => (
                <li key={index}>{difference}</li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {report.regionChanges.length > 0 ? (
        <section className={styles.section}>
          <SectionHead icon={<MapPinned size={13} />} title="Territory" count={report.regionChanges.length} />
          <div className={styles.regionHead} aria-hidden>
            <span>Region</span>
            <span className={styles.inkA}>A holds</span>
            <span className={styles.inkB}>B holds</span>
          </div>
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
                  <OwnerChip code={change.a} palette={palette} names={names} />
                  <OwnerChip code={change.b} palette={palette} names={names} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <LineSection icon={<Landmark size={13} />} title="Powers" lines={report.polityDiffs} />
      <LineSection icon={<Swords size={13} />} title="Forces" lines={report.unitDiffs} />
      <LineSection icon={<Castle size={13} />} title="Structures" lines={report.markerDiffs} />
    </>
  );
}

function LineSection({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className={styles.section}>
      <SectionHead icon={icon} title={title} count={lines.length} />
      <ul className={styles.lines}>
        {lines.map((line, index) => {
          const lean = leanOf(line);
          return (
            <li key={index} className={styles.line}>
              <span
                className={`${styles.lean} ${lean === "a" ? styles.leanA : lean === "b" ? styles.leanB : ""}`}
                title={lean ? `Only in ${lean.toUpperCase()}` : "Differs between the two"}
              >
                {lean ? (
                  <>
                    <Plus size={10} strokeWidth={3} />
                    {lean.toUpperCase()}
                  </>
                ) : (
                  <ArrowLeftRight size={11} />
                )}
              </span>
              <span className={styles.lineText}>{inkLine(line)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
