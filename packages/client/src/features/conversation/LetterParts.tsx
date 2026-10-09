import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Correspondent, SealRole } from "./correspondents.ts";
import { CorrespondentMark } from "./Seal.tsx";
import styles from "./Letters.module.css";

const TINTS: Record<SealRole, string | undefined> = {
  chancellor: styles.tintChancellor,
  marshal: styles.tintMarshal,
  spymaster: styles.tintSpymaster,
  advisor: styles.tintAdvisor,
};

/**
 * A letter's tint — the minister's seal color, or the envoy's map color —
 * for the rule under its signature and its edge rail.
 */
export const letterTint = (who: Correspondent): { className: string; style: CSSProperties | undefined } => ({
  className: who.seal ? (TINTS[who.seal] ?? "") : "",
  style: !who.seal && who.color ? ({ "--pf-letter-tint": who.color } as CSSProperties) : undefined,
});

/** The sender line of an incoming letter: seal or flag, signature, office. */
export function LetterHead({
  who,
  status,
  children,
}: {
  who: Correspondent;
  /** Replaces the office line while a reply is being written. */
  status?: string;
  /** Right-aligned tools (sibling arrows, regenerate). */
  children?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <CorrespondentMark who={who} size={28} />
      <span className={styles.from}>
        <span className={styles.fromName}>{who.fullName}</span>
        <span className={`${styles.fromRole} ${status ? styles.fromStatus : ""}`}>{status ?? who.role}</span>
      </span>
      {children ? <span className={styles.tools}>{children}</span> : null}
    </header>
  );
}

/**
 * Branch indicator: this is how players find edited/regenerated
 * alternatives, so it must read as a control, not as metadata — it stays
 * visible while the other tools wait for hover.
 */
export function SiblingNav({
  index,
  count,
  onFlip,
}: {
  index: number;
  count: number;
  onFlip: (direction: 1 | -1) => void;
}) {
  return (
    <span className={styles.siblings} title={`${count} versions of this message — flip to see the other branches`}>
      <button type="button" aria-label="Previous version" onClick={() => onFlip(-1)} disabled={index === 0}>
        <ChevronLeft size={13} />
      </button>
      <span className={styles.siblingCount}>
        {index + 1}/{count}
      </span>
      <button type="button" aria-label="Next version" onClick={() => onFlip(1)} disabled={index === count - 1}>
        <ChevronRight size={13} />
      </button>
    </span>
  );
}

/** A quiet icon control, revealed on hover/focus of its letter or note. */
export function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.tool} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** First page of an empty channel: who you're writing to, before a word is sent. */
export function Letterhead({ who }: { who: Correspondent }) {
  return (
    <div className={styles.letterhead}>
      <CorrespondentMark who={who} size={64} />
      <span className={styles.letterheadName}>{who.fullName}</span>
      <span className={`${styles.letterheadRole} pfKicker`}>{who.role}</span>
      {who.hint ? <span className={styles.letterheadHint}>{who.hint}</span> : null}
      <span className={`${styles.letterheadRule} pfRule`}>
        <span className="pfFleuron" />
      </span>
      <span className={styles.letterheadPrompt}>
        {who.kind === "envoy"
          ? "The channel is open. Your first letter sets the tone."
          : who.kind === "council"
            ? `${who.fullName} awaits your question.`
            : "Your advisor awaits your question."}
      </span>
    </div>
  );
}
