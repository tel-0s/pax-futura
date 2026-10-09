import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  Globe,
  Handshake,
  RefreshCw,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { StatSheet, WorldState } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { SectionHead } from "./DossierParts.tsx";
import { cachedSheet, rememberSheet } from "./sheetCache.ts";
import styles from "./StatSheetSection.module.css";

type ScoreKey = "stability" | "economy" | "military" | "diplomacy" | "security";

const SCORES: Array<{ key: ScoreKey; label: string; hint: string }> = [
  { key: "stability", label: "Stability", hint: "Internal order — legitimacy, unrest, cohesion." },
  { key: "economy", label: "Economy", hint: "Productive strength and fiscal health." },
  { key: "military", label: "Military", hint: "Fighting power and readiness." },
  { key: "diplomacy", label: "Diplomacy", hint: "Standing, allies, and influence abroad." },
  { key: "security", label: "Security", hint: "Safety from external coercion or attack." },
];

/** Long LLM assessments fold behind "Read on" past roughly five lines. */
const CLAMP_CHARS = 340;

/** Grounded per-nation stat sheet: hard stats measured, soft scores anchored
 *  to the previous turn's sheet and this turn's extracted facts. */
export function StatSheetSection({
  gameId,
  nodeId,
  parentId,
  polity,
  world,
  palette,
}: {
  gameId: string;
  nodeId: string;
  /** The checked-out node's parent — its sheet (if already seen) supplies the deltas. */
  parentId: string | null;
  polity: string;
  world: WorldState | null;
  palette: Record<string, string>;
}) {
  const [sheet, setSheet] = useState<StatSheet | null>(() => cachedSheet(gameId, nodeId, polity) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // A slow assessment must not land on a dossier that has since moved on to
  // another nation or node.
  const identity = useRef("");
  const current = `${gameId}|${nodeId}|${polity}`;

  const load = async (force = false) => {
    const asked = current;
    setLoading(true);
    setError(null);
    try {
      const fresh = await api.getStatSheet(gameId, nodeId, polity, force);
      rememberSheet(gameId, nodeId, polity, fresh);
      if (identity.current === asked) setSheet(fresh);
    } catch (err) {
      if (identity.current === asked) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (identity.current === asked) setLoading(false);
    }
  };

  useEffect(() => {
    identity.current = current;
    setLoading(false);
    setError(null);
    setExpanded(false);
    const known = cachedSheet(gameId, nodeId, polity);
    setSheet(known ?? null);
    if (!known) void load();
    // load is re-created each render; the identity triple is the real dependency.
  }, [gameId, nodeId, polity]);

  const previous = parentId ? cachedSheet(gameId, parentId, polity) : undefined;

  const header = (
    <SectionHead icon={Sparkles} label="Assessment" provenance="estimated">
      <Button
        variant="ghost"
        size="sm"
        icon
        disabled={loading}
        onClick={() => void load(true)}
        title="Reassess this nation now (asks the archivist again)"
        aria-label="Reassess this nation"
      >
        <RefreshCw size={13} className={loading ? styles.spinning : undefined} />
      </Button>
    </SectionHead>
  );

  if (error && !sheet) {
    return (
      <section className={styles.section}>
        {header}
        <div className={styles.errorCard}>
          <CircleAlert size={18} aria-hidden />
          <p>The archivist could not assess {world?.polities[polity]?.name || polity}: {error}</p>
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw size={13} /> Retry
          </Button>
        </div>
      </section>
    );
  }

  if (!sheet) {
    return (
      <section className={styles.section} aria-busy>
        {header}
        <div className={styles.gauges}>
          {SCORES.map((score) => (
            <div key={score.key} className={styles.gauge}>
              <span className={styles.gaugeLabel}>{score.label}</span>
              <span className={`${styles.skeleton} ${styles.skeletonValue}`} />
              <span className={`${styles.track} ${styles.skeleton}`} />
            </div>
          ))}
        </div>
        <p className={styles.waiting}>Assessing {world?.polities[polity]?.name || polity}…</p>
      </section>
    );
  }

  const { economics, hard } = sheet;
  const long = sheet.assessment.length > CLAMP_CHARS;

  return (
    <>
      <section className={`${styles.section} ${loading ? styles.stale : ""}`}>
        {header}
        {error ? <p className={styles.inlineError}>Reassessment failed: {error}</p> : null}
        <div className={styles.gauges}>
          {SCORES.map((score) => (
            <Gauge
              key={score.key}
              label={score.label}
              hint={score.hint}
              value={sheet[score.key]}
              previous={previous?.[score.key]}
            />
          ))}
        </div>

        <div className={styles.economics}>
          <div className={styles.figure}>
            <span className={styles.figureLabel}>Output</span>
            <span className={styles.figureValue}>{formatNumber(economics.gdp)}</span>
            <span className={styles.figureUnit} title={economics.gdpUnit}>
              {economics.gdpUnit}
            </span>
          </div>
          <div className={styles.figure}>
            <span className={styles.figureLabel}>Growth</span>
            <span className={`${styles.figureValue} ${growthTone(economics.growthPct)}`}>
              {economics.growthPct > 0 ? <TrendingUp size={17} strokeWidth={2.2} aria-hidden /> : null}
              {economics.growthPct < 0 ? <TrendingDown size={17} strokeWidth={2.2} aria-hidden /> : null}
              {economics.growthPct > 0 ? "+" : ""}
              {economics.growthPct}%
            </span>
            <span className={styles.figureUnit}>per year</span>
          </div>
          <div className={styles.figure}>
            <span className={styles.figureLabel}>Inflation</span>
            <span className={`${styles.figureValue} ${inflationTone(economics.inflationPct)}`}>
              {economics.inflationPct}%
            </span>
            <span className={styles.figureUnit}>{inflationWord(economics.inflationPct)}</span>
          </div>
        </div>

        <div className={styles.prose}>
          <p className={`${styles.assessment} ${long && !expanded ? styles.clamped : ""}`}>{sheet.assessment}</p>
          {long ? (
            <button className={styles.readOn} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? "Show less" : "Read the full assessment"}
            </button>
          ) : null}
        </div>

        {sheet.highlights.length > 0 ? (
          <div className={styles.drivers}>
            <span className={`${styles.subKicker} pfKicker`}>Drivers</span>
            <ul className={styles.driverList}>
              {sheet.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <SectionHead icon={Globe} label="Relations" provenance="measured" />
        {hard.atWarWith.length === 0 && hard.treaties.length === 0 ? (
          <p className={styles.quiet}>At peace, and bound by no recorded treaty.</p>
        ) : null}
        {hard.atWarWith.length > 0 ? (
          <div className={styles.relationRow}>
            <span className={`${styles.relationLabel} ${styles.war}`}>
              <Swords size={13} aria-hidden /> At war
            </span>
            <div className={styles.enemies}>
              {hard.atWarWith.map((code) => {
                const enemy = world?.polities[code];
                return (
                  <span key={code} className={styles.enemy}>
                    <PolityFlag flag={enemy?.flag} color={palette[code]} size={15} />
                    {enemy?.name || code}
                  </span>
                );
              })}
            </div>
          </div>
        ) : hard.treaties.length > 0 ? (
          <p className={styles.quiet}>At peace with every power.</p>
        ) : null}
        {hard.treaties.length > 0 ? (
          <div className={styles.relationBlock}>
            <span className={styles.relationLabel}>
              <Handshake size={13} aria-hidden /> Treaties
              <span className={styles.count}>{hard.treaties.length}</span>
            </span>
            <ul className={styles.treaties}>
              {hard.treaties.map((treaty) => (
                <li key={treaty}>{treaty}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}

const formatNumber = (value: number): string =>
  Math.abs(value) >= 1000 ? value.toLocaleString("en-US") : String(value);

const growthTone = (pct: number): string =>
  (pct > 0 ? styles.good : pct < 0 ? styles.bad : styles.flat) ?? "";

const inflationTone = (pct: number): string =>
  (pct >= 10 ? styles.bad : pct >= 5 ? styles.warn : pct < 0 ? styles.cool : styles.flat) ?? "";

const inflationWord = (pct: number): string =>
  pct >= 25 ? "runaway" : pct >= 10 ? "severe" : pct >= 5 ? "elevated" : pct < 0 ? "deflation" : "contained";

/** Band a 0-100 score so weak spots read at a glance. */
const scoreBand = (value: number): string =>
  (value < 35 ? styles.low : value < 55 ? styles.mid : styles.high) ?? "";

function Gauge({
  label,
  hint,
  value,
  previous,
}: {
  label: string;
  hint: string;
  value: number;
  previous: number | undefined;
}) {
  const delta = previous === undefined ? 0 : value - previous;
  return (
    <div className={`${styles.gauge} ${scoreBand(value)}`} title={hint}>
      <span className={styles.gaugeLabel}>{label}</span>
      <span className={styles.gaugeReading}>
        {delta !== 0 ? (
          <span
            className={`${styles.delta} ${delta > 0 ? styles.good : styles.bad}`}
            title={`${delta > 0 ? "+" : ""}${delta} since last turn`}
          >
            {delta > 0 ? <ArrowUpRight size={11} aria-hidden /> : <ArrowDownRight size={11} aria-hidden />}
            {Math.abs(delta)}
          </span>
        ) : null}
        <span className={styles.gaugeValue}>{value}</span>
      </span>
      <span
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span className={styles.fill} style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}
