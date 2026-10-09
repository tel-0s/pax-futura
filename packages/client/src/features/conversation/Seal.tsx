import { memo, useId, type CSSProperties } from "react";
import { Feather, Scale, Swords, VenetianMask, type LucideIcon } from "lucide-react";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import type { Correspondent, SealRole } from "./correspondents.ts";
import styles from "./Seal.module.css";

const GLYPHS: Record<SealRole, LucideIcon> = {
  chancellor: Scale,
  marshal: Swords,
  spymaster: VenetianMask,
  advisor: Feather,
};

/** An 18-lobed wax rosette in a 64-unit box (the parchment seal's edge). */
const WAX_PATH = (() => {
  const lobes = 18;
  const valley = 28.4;
  const crest = 33.2;
  const point = (radius: number, angle: number) =>
    `${(32 + radius * Math.cos(angle)).toFixed(2)} ${(32 + radius * Math.sin(angle)).toFixed(2)}`;
  let path = `M${point(valley, 0)}`;
  for (let lobe = 0; lobe < lobes; lobe++) {
    const from = (lobe / lobes) * Math.PI * 2;
    const to = ((lobe + 1) / lobes) * Math.PI * 2;
    path += ` Q${point(crest, (from + to) / 2)} ${point(valley, to)}`;
  }
  return `${path}Z`;
})();

/** Baseline circle for the ring legend: starts at 9 o'clock, runs clockwise. */
const LEGEND_RADIUS = 22.6;
const LEGEND_ARC = `M${32 - LEGEND_RADIUS} 32 a${LEGEND_RADIUS} ${LEGEND_RADIUS} 0 1 1 ${LEGEND_RADIUS * 2} 0 a${LEGEND_RADIUS} ${LEGEND_RADIUS} 0 1 1 ${-LEGEND_RADIUS * 2} 0`;
const LEGEND_LENGTH = Math.round(2 * Math.PI * LEGEND_RADIUS) - 3;

/**
 * A minister's seal: the role's glyph on a disc of the role's tint. Every
 * shape is drawn and the theme shows one — a HUD ring (command deck,
 * daylight), a wax rosette (parchment), a machined plate (seraphim), a
 * terminal box (phosphor). From 44px up the ring carries the office and name
 * as a legend, like a real matrix seal.
 */
export const Seal = memo(function Seal({
  role,
  legend = "",
  size = 30,
}: {
  role: SealRole;
  legend?: string;
  size?: number;
}) {
  const rawId = useId();
  const arcId = `seal-arc-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const Glyph = GLYPHS[role];
  const ringed = size >= 44 && legend !== "";
  const text = ringed ? (legend.length < 18 ? `${legend} · ${legend} · ` : `${legend} · `) : "";
  const fontSize = Math.min(6.2, LEGEND_LENGTH / (text.length * 0.62 || 1));
  return (
    <span className={`${styles.seal} ${styles[role]}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 64 64" className={styles.art}>
        <circle className={styles.shapeRing} cx="32" cy="32" r="30" />
        <path className={styles.shapeWax} d={WAX_PATH} />
        <path className={styles.shapePlate} d="M3 3H47L61 17V61H17L3 47Z" />
        <path className={styles.plateTab} d="M51 61H61V51Z" />
        <rect className={styles.shapeBox} x="3" y="3" width="58" height="58" />
        <circle className={styles.inner} cx="32" cy="32" r={ringed ? 19.6 : 24} />
        {ringed ? (
          <>
            <path id={arcId} d={LEGEND_ARC} fill="none" stroke="none" />
            <text className={styles.legend} style={{ fontSize }}>
              <textPath href={`#${arcId}`} textLength={LEGEND_LENGTH} lengthAdjust="spacing">
                {text}
              </textPath>
            </text>
          </>
        ) : null}
      </svg>
      <Glyph
        className={styles.glyph}
        size={Math.round(size * (ringed ? 0.3 : 0.48))}
        strokeWidth={ringed ? 1.6 : 1.85}
      />
    </span>
  );
});

/** A foreign court's mark: its flag in a medallion ringed with its map color. */
export const FlagMark = memo(function FlagMark({
  flag,
  color,
  size = 30,
}: {
  flag: string;
  color: string | undefined;
  size?: number;
}) {
  const style = { width: size, height: size, "--pf-seal-tint": color } as CSSProperties;
  return (
    <span className={styles.flagMark} style={style} aria-hidden>
      <PolityFlag flag={flag} color={color} size={Math.round(size * (flag ? 0.66 : 0.6))} />
    </span>
  );
});

/** Seal for ministers and the advisor, flag medallion for foreign envoys. */
export function CorrespondentMark({ who, size = 30 }: { who: Correspondent; size?: number }) {
  return who.seal ? (
    <Seal role={who.seal} legend={who.legend} size={size} />
  ) : (
    <FlagMark flag={who.flag} color={who.color} size={size} />
  );
}
