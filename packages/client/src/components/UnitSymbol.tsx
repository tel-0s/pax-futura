import type { ReactNode } from "react";
import type { UnitType } from "@pax/domain";
import styles from "./UnitSymbol.module.css";

/**
 * A NATO-flavoured unit counter: a frame tinted with the owner's color and
 * the branch symbol inside (infantry ✕, armor track, artillery dot, air
 * rotor, naval keel, garrison battlements). Pure SVG + theme tokens, so the
 * same mark reads on the deck, the CRT and the parchment.
 */
export function UnitSymbol({
  type,
  color,
  size = 24,
}: {
  type: UnitType;
  color?: string | undefined;
  size?: number;
}) {
  return (
    <svg
      className={styles.symbol}
      viewBox="0 0 24 16"
      width={size}
      height={(size * 16) / 24}
      aria-hidden
    >
      <rect x="1" y="1" width="22" height="14" rx="1" className={styles.frame} style={color ? { fill: color } : undefined} />
      <rect x="1" y="1" width="22" height="14" rx="1" className={styles.edge} />
      <g className={styles.glyph}>{GLYPHS[type] ?? GLYPHS.infantry}</g>
    </svg>
  );
}

const GLYPHS: Record<UnitType, ReactNode> = {
  infantry: <path d="M1.5 1.5 22.5 14.5M1.5 14.5 22.5 1.5" />,
  armor: <rect x="6" y="5" width="12" height="6" rx="3" />,
  artillery: <circle cx="12" cy="8" r="2.4" className="pfFillGlyph" />,
  air: <path d="M5 8c2-4.5 5-4.5 7 0 2 4.5 5 4.5 7 0-2-4.5-5-4.5-7 0-2 4.5-5 4.5-7 0z" />,
  naval: <path d="M12 3.5v8M9.5 5.5h5M7 9.5c1 2.6 3 3.5 5 3.5s4-.9 5-3.5" />,
  garrison: <path d="M6 12.5V6h2v2h2.5V6h3v2H16V6h2v6.5z" />,
};
