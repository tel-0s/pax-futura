import { useEffect, useState } from "react";
import type { StatSheet } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import styles from "./StatSheetSection.module.css";

/** Grounded per-nation stat sheet: hard stats measured, soft scores anchored
 *  to the previous turn's sheet and this turn's extracted facts. */
export function StatSheetSection({
  gameId,
  nodeId,
  polity,
}: {
  gameId: string;
  nodeId: string;
  polity: string;
}) {
  const [sheet, setSheet] = useState<StatSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setSheet(await api.getStatSheet(gameId, nodeId, polity, force));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSheet(null);
    setError(null);
    void load();
    // load is re-created each render; the identity triple is the real dependency.
  }, [gameId, nodeId, polity]);

  if (loading && !sheet) return <p className={styles.note}>Assessing {polity}…</p>;
  if (error) {
    return (
      <div>
        <p className={styles.note}>{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (!sheet) return null;

  return (
    <div className={styles.sheet}>
      <Meter label="Stability" value={sheet.stability} />
      <Meter label="Economy" value={sheet.economy} />
      <Meter label="Military" value={sheet.military} />
      <Meter label="Diplomacy" value={sheet.diplomacy} />
      <Meter label="Security" value={sheet.security} />
      <p className={styles.assessment}>{sheet.assessment}</p>
      <ul className={styles.highlights}>
        {sheet.highlights.map((highlight) => (
          <li key={highlight}>{highlight}</li>
        ))}
      </ul>
      <div className={styles.economics}>
        <span className={styles.econItem}>
          <span className={styles.econLabel}>GDP</span>
          {formatNumber(sheet.economics.gdp)} <span className={styles.econUnit}>{sheet.economics.gdpUnit}</span>
        </span>
        <span className={styles.econItem}>
          <span className={styles.econLabel}>Growth</span>
          {sheet.economics.growthPct > 0 ? "+" : ""}
          {sheet.economics.growthPct}%
        </span>
        <span className={styles.econItem}>
          <span className={styles.econLabel}>Inflation</span>
          {sheet.economics.inflationPct}%
        </span>
      </div>
      <div className={styles.footer}>
        <span className={styles.hard}>
          {sheet.hard.regionsOwned > 0 ? `${sheet.hard.regionsOwned} regions · ` : ""}
          {sheet.hard.unitCount} units ({sheet.hard.totalStrength})
          {sheet.hard.atWarWith.length > 0 ? ` · at war: ${sheet.hard.atWarWith.join(", ")}` : ""}
        </span>
        <Button variant="ghost" disabled={loading} onClick={() => void load(true)} title="Reassess">
          ↻
        </Button>
      </div>
    </div>
  );
}

const formatNumber = (value: number): string =>
  Math.abs(value) >= 1000 ? value.toLocaleString("en-US") : String(value);

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.meter}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${value}%` }} />
      </span>
      <span className={styles.meterValue}>{value}</span>
    </div>
  );
}
