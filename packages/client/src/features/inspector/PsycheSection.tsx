import { useEffect, useRef, useState } from "react";
import { Brain, EyeOff, Flame, Target } from "lucide-react";
import type { PsycheSheet } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { SectionHead } from "./DossierParts.tsx";
import styles from "./PsycheSection.module.css";

/** Opinion of the player, −3..+3, in words. */
const OPINION_WORDS: Record<number, string> = {
  [-3]: "Hostile",
  [-2]: "Antagonistic",
  [-1]: "Wary",
  0: "Indifferent",
  1: "Cordial",
  2: "Friendly",
  3: "Devoted",
};

const STEPS = [-3, -2, -1, 0, 1, 2, 3] as const;

/**
 * Session memory of psyches already read, keyed like the stat sheets. A
 * psyche is fixed for a (node, polity) pair, so a revisit needs no request.
 * `null` is a real answer (never profiled) and is cached too.
 */
const psyches = new Map<string, PsycheSheet | null>();

/**
 * A foreign leader's disposition — the persistent "mind" the extractor keeps
 * for each nation (rollup.psyches), read from the nearest profiled ancestor.
 * Only meaningful for foreign powers: the player has no opinion of itself.
 */
export function PsycheSection({
  gameId,
  nodeId,
  polity,
  playerName,
}: {
  gameId: string;
  nodeId: string;
  polity: string;
  playerName: string;
}) {
  const key = `${gameId}|${nodeId}|${polity}`;
  const [sheet, setSheet] = useState<PsycheSheet | null | undefined>(() => psyches.get(key));
  const [error, setError] = useState("");
  // A slow read must not land on a dossier that has moved on.
  const identity = useRef(key);

  useEffect(() => {
    identity.current = key;
    setError("");
    if (psyches.has(key)) {
      setSheet(psyches.get(key));
      return;
    }
    setSheet(undefined);
    api
      .getPsyche(gameId, nodeId, polity)
      .then((result) => {
        psyches.set(key, result);
        if (identity.current === key) setSheet(result);
      })
      .catch((cause: unknown) => {
        if (identity.current === key) setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [key, gameId, nodeId, polity]);

  const empty =
    sheet &&
    !sheet.temperament &&
    sheet.ambitions.length === 0 &&
    sheet.grudges.length === 0 &&
    sheet.opinionOfPlayer === 0 &&
    !sheet.opinionReason;

  return (
    <section className={styles.section}>
      <SectionHead icon={Brain} label="Disposition" provenance="estimated" />
      {error ? (
        <p className={styles.quiet}>The intelligence file could not be read: {error}</p>
      ) : sheet === undefined ? (
        <div className={styles.loading} aria-busy>
          <span className={styles.skeleton} />
          <span className={`${styles.skeleton} ${styles.skeletonShort}`} />
        </div>
      ) : sheet === null || empty ? (
        <p className={styles.unprofiled}>
          <EyeOff size={14} aria-hidden />
          Not yet profiled by your intelligence service.
        </p>
      ) : (
        <>
          {sheet.temperament ? <p className={styles.temperament}>{sheet.temperament}</p> : null}
          <Opinion value={sheet.opinionOfPlayer} reason={sheet.opinionReason} playerName={playerName} />
          {sheet.ambitions.length > 0 ? (
            <Motives icon={Target} label="Ambitions" items={sheet.ambitions} tone="ambition" />
          ) : null}
          {sheet.grudges.length > 0 ? (
            <Motives icon={Flame} label="Grudges" items={sheet.grudges} tone="grudge" />
          ) : null}
        </>
      )}
    </section>
  );
}

/** A diverging seven-cell scale centred on indifference. */
function Opinion({ value, reason, playerName }: { value: number; reason: string; playerName: string }) {
  const clamped = Math.max(-3, Math.min(3, Math.round(value)));
  const tone = clamped > 0 ? styles.warm : clamped < 0 ? styles.cold : styles.neutral;
  return (
    <div className={`${styles.opinion} ${tone}`}>
      <div className={styles.opinionHead}>
        <span className={styles.opinionLabel}>Toward your realm</span>
        <span className={styles.opinionWord}>
          {OPINION_WORDS[clamped]}
          <span className={styles.opinionValue}>
            {clamped > 0 ? "+" : ""}
            {clamped}
          </span>
        </span>
      </div>
      <div
        className={styles.scale}
        role="meter"
        aria-label={`Opinion of ${playerName}`}
        aria-valuemin={-3}
        aria-valuemax={3}
        aria-valuenow={clamped}
        aria-valuetext={OPINION_WORDS[clamped]}
      >
        {STEPS.map((step) => {
          const lit = step === 0 ? clamped === 0 : clamped > 0 ? step > 0 && step <= clamped : step < 0 && step >= clamped;
          return (
            <span
              key={step}
              className={[styles.cell, step === 0 ? styles.centre : "", lit ? styles.lit : ""].filter(Boolean).join(" ")}
            />
          );
        })}
      </div>
      <div className={styles.scaleEnds} aria-hidden>
        <span>Hostile</span>
        <span>Devoted</span>
      </div>
      {reason ? <p className={styles.reason}>{reason}</p> : null}
    </div>
  );
}

function Motives({
  icon: Icon,
  label,
  items,
  tone,
}: {
  icon: typeof Target;
  label: string;
  items: string[];
  tone: "ambition" | "grudge";
}) {
  return (
    <div className={`${styles.motives} ${tone === "grudge" ? styles.grudges : styles.ambitions}`}>
      <span className={styles.motivesLabel}>
        <Icon size={13} aria-hidden /> {label}
      </span>
      <ul className={styles.motiveList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
