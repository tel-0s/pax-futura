import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, CircleAlert, ScrollText } from "lucide-react";
import { ERA_SPAN, type ChronicleResponse, type EraSummary } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { api } from "../../lib/api.ts";
import { describeSpan, formatGameDate, formatGameMonth } from "../../lib/dates.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { FactLine } from "./factLine.tsx";
import { parseDigestLine } from "../../lib/factLine.ts";
import styles from "./chronicle.module.css";

const EMPTY: ChronicleResponse = { eras: [], recent: [] };

type RecentTurn = ChronicleResponse["recent"][number];

/** Chapter numerals: the book themes read them as Roman, the consoles as an index. */
const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const roman = (value: number): string => {
  let rest = Math.max(1, Math.floor(value));
  let out = "";
  for (const [step, glyph] of ROMAN) {
    while (rest >= step) {
      out += glyph;
      rest -= step;
    }
  }
  return out;
};

const indexNumeral = (value: number): string => String(value).padStart(2, "0");

/** Era narratives arrive as plain text; blank-line breaks become paragraphs. */
const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Both numeral forms ride in the DOM; the theme decides which one shows. */
function NumeralText({ value }: { value: number }) {
  return (
    <>
      <span className={styles.numeralRoman}>{roman(value)}</span>
      <span className={styles.numeralIndex}>{indexNumeral(value)}</span>
    </>
  );
}

/** The large chapter mark beside a chapter heading. */
function Numeral({ value, pending = false }: { value: number; pending?: boolean }) {
  return (
    <span className={`${styles.numeral} ${pending ? styles.numeralPending : ""}`} aria-hidden>
      <NumeralText value={value} />
    </span>
  );
}

function Rule() {
  return (
    <div className={`${styles.rule} pfRule`} aria-hidden>
      <span className={`${styles.fleuron} pfFleuron`} />
    </div>
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
  const codexRef = useRef<HTMLDivElement>(null);

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
  const eraCount = chronicle.eras.length;
  const lastDepth = chronicle.recent.at(-1)?.depth ?? chronicle.eras.at(-1)?.endDepth;

  const jumpTo = (anchor: string) => {
    codexRef.current
      ?.querySelector(`[data-anchor="${anchor}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Drawer
      side="left"
      wide
      title="Chronicle"
      kicker={
        status === "ready" && !isEmpty
          ? `${eraCount} chapter${eraCount === 1 ? "" : "s"}${lastDepth ? ` · through turn ${lastDepth}` : ""}`
          : "Annals of the realm"
      }
      icon={<ScrollText size={16} />}
      onClose={() => setLeftDrawer(null)}
    >
      {status === "error" && error ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={15} aria-hidden /> {error}
        </p>
      ) : null}

      {status === "loading" ? (
        <div className={styles.loading} aria-busy="true" aria-label="Loading the chronicle">
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </div>
      ) : null}

      {isEmpty && status === "ready" ? (
        <div className={styles.empty}>
          <BookOpen size={24} aria-hidden />
          <p>
            Nothing chronicled yet. Recent turns appear here as you play, and every {ERA_SPAN} turns
            the archivist folds them into an era summary with its own open-threads ledger.
          </p>
        </div>
      ) : null}

      {!isEmpty ? (
        <div ref={codexRef} className={styles.codex}>
          {eraCount > 0 ? (
            <Contents eras={chronicle.eras} hasPresent={recent.length > 0} onJump={jumpTo} />
          ) : null}

          {recent.length > 0 ? (
            <PresentAge
              turns={recent}
              chapter={eraCount + 1}
              settledThrough={chronicle.eras.at(-1)?.endDepth ?? 0}
              latestDepth={chronicle.recent.at(-1)?.depth ?? 0}
            />
          ) : null}

          {[...chronicle.eras]
            .map((era, index) => ({ era, chapter: index + 1 }))
            .reverse()
            .map(({ era, chapter }) => (
              <EraChapter key={`${era.startNodeId}:${era.endNodeId}`} era={era} chapter={chapter} />
            ))}
        </div>
      ) : null}
    </Drawer>
  );
}

/** A book's table of contents, newest first, with dot leaders to the turn span. */
function Contents({
  eras,
  hasPresent,
  onJump,
}: {
  eras: EraSummary[];
  hasPresent: boolean;
  onJump: (anchor: string) => void;
}) {
  const chapters = eras.map((era, index) => ({ era, chapter: index + 1 })).reverse();
  return (
    <nav className={styles.contents} aria-label="Chapters">
      <span className={`${styles.contentsLabel} pfKicker`}>Contents</span>
      <ol className={styles.contentsList}>
        {hasPresent ? (
          <li>
            <button type="button" className={styles.contentsItem} onClick={() => onJump("present")}>
              <span className={styles.contentsNumeral}>
                <NumeralText value={eras.length + 1} />
              </span>
              <span className={styles.contentsTitle}>The Present Age</span>
              <span className={styles.leader} />
              <span className={styles.contentsRange}>now</span>
            </button>
          </li>
        ) : null}
        {chapters.map(({ era, chapter }) => (
          <li key={`${era.startNodeId}:${era.endNodeId}`}>
            <button type="button" className={styles.contentsItem} onClick={() => onJump(`era-${chapter}`)}>
              <span className={styles.contentsNumeral}>
                <NumeralText value={chapter} />
              </span>
              <span className={styles.contentsTitle}>{era.title}</span>
              <span className={styles.leader} />
              <span className={styles.contentsRange}>
                {era.startDepth}–{era.endDepth}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The unfinished chapter: turns not yet folded into an era, on a time rail. */
function PresentAge({
  turns,
  chapter,
  settledThrough,
  latestDepth,
}: {
  turns: RecentTurn[];
  chapter: number;
  settledThrough: number;
  latestDepth: number;
}) {
  const written = Math.max(0, Math.min(ERA_SPAN, latestDepth - settledThrough));
  const first = turns[0];
  const last = turns.at(-1);
  return (
    <section className={styles.chapter} data-anchor="present">
      <header className={styles.chapterHead}>
        <Numeral value={chapter} pending />
        <div className={styles.chapterHeading}>
          <span className="pfKicker">
            Chapter {roman(chapter)} · in the writing
          </span>
          <h3 className={`${styles.chapterTitle} pfTitle`}>The Present Age</h3>
          {first && last ? (
            <span className={styles.chapterDates}>
              {formatGameMonth(first.gameDate)}
              {first.gameDate !== last.gameDate ? ` – ${formatGameMonth(last.gameDate)}` : ""}
            </span>
          ) : null}
        </div>
      </header>
      <div
        className={styles.progress}
        title={`The archivist closes a chapter every ${ERA_SPAN} turns`}
      >
        <span className={styles.progressTrack} aria-hidden>
          {Array.from({ length: ERA_SPAN }, (_, index) => (
            <span key={index} className={`${styles.progressTick} ${index < written ? styles.progressDone : ""}`} />
          ))}
        </span>
        <span className={styles.progressLabel}>
          {written} of {ERA_SPAN} turns before this chapter is bound
        </span>
      </div>
      <Rule />
      <ol className={styles.timeline}>
        {[...turns].reverse().map((turn, index) => (
          <TurnEntry key={turn.depth} turn={turn} latest={index === 0 && turn.depth === latestDepth} />
        ))}
      </ol>
    </section>
  );
}

function TurnEntry({ turn, latest }: { turn: RecentTurn; latest: boolean }) {
  const marks = turn.lines.map((line) => parseDigestLine(line).confidence);
  const reported = marks.filter((mark) => mark === "reported").length;
  const rumors = marks.filter((mark) => mark === "rumor").length;
  return (
    <li className={`${styles.entry} ${latest ? styles.entryLatest : ""}`}>
      <header className={styles.entryHead}>
        <span className={styles.entryDate}>{formatGameDate(turn.gameDate)}</span>
        <span className={styles.entryTurn}>Turn {turn.depth}</span>
        {latest ? <Badge tone="accent">latest</Badge> : null}
      </header>
      {turn.summary ? <p className={styles.entrySummary}>{turn.summary}</p> : null}
      {turn.lines.length > 0 ? (
        <details className={styles.facts}>
          <summary className={styles.factsToggle}>
            <ChevronRight size={13} className={styles.chevron} aria-hidden />
            <span>
              {turn.lines.length} extracted fact{turn.lines.length === 1 ? "" : "s"}
            </span>
            {reported > 0 ? <span className={styles.tallyReported}>{reported} reported</span> : null}
            {rumors > 0 ? <span className={styles.tallyRumor}>{rumors} rumor{rumors === 1 ? "" : "s"}</span> : null}
          </summary>
          <ul className={styles.factList}>
            {turn.lines.map((line, index) => (
              <FactLine key={index} line={line} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/** Open-thread lines lead with their parties ("SERAPH->FRA: …") or arc name. */
const THREAD_PARTIES = /^(?:Commitment\s+)?([A-Z][A-Z0-9/]{1,15})->([A-Z][A-Z0-9/]{1,15}):\s*/;
const THREAD_ARC = /^Arc\s+"([^"]+)"\s*(?:—|-|:)?\s*/;

function ThreadText({ text }: { text: string }) {
  const parties = THREAD_PARTIES.exec(text);
  if (parties) {
    return (
      <>
        <span className={styles.threadParties}>
          {parties[1]} → {parties[2]}
        </span>{" "}
        {text.slice(parties[0].length)}
      </>
    );
  }
  const arc = THREAD_ARC.exec(text);
  if (arc) {
    const rest = text.slice(arc[0].length);
    return (
      <>
        <span className={styles.threadArc}>{arc[1]}</span>
        {rest ? ` — ${rest}` : ""}
      </>
    );
  }
  return <>{text}</>;
}

function EraChapter({ era, chapter }: { era: EraSummary; chapter: number }) {
  const span = describeSpan(era.startDate, era.endDate);
  return (
    <article className={styles.chapter} data-anchor={`era-${chapter}`}>
      <header className={styles.chapterHead}>
        <Numeral value={chapter} />
        <div className={styles.chapterHeading}>
          <span className="pfKicker">
            Chapter {roman(chapter)} · turns {era.startDepth}–{era.endDepth}
          </span>
          <h3 className={`${styles.chapterTitle} pfTitle`}>{era.title}</h3>
          <span className={styles.chapterDates}>
            {formatGameMonth(era.startDate)} – {formatGameMonth(era.endDate)}
            {span ? ` · ${span}` : ""}
          </span>
        </div>
      </header>
      {era.degraded ? (
        <p className={styles.draftNote}>
          <Badge tone="warning">provisional</Badge> The archivist's fair copy is still pending — this
          placeholder is rewritten on the next extraction.
        </p>
      ) : null}
      <Rule />
      <div className={styles.prose}>
        {paragraphs(era.summary).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      {era.openThreads.length > 0 ? (
        <section className={styles.ledger} aria-label="Open threads">
          <header className={styles.ledgerHead}>
            <span className="pfKicker">Open threads</span>
            <span className={styles.count}>{era.openThreads.length}</span>
          </header>
          {/* The open-threads ledger is the chapter's action list — numbered
              markers keep it scannable against the narrative above it. */}
          <ol className={styles.ledgerList}>
            {era.openThreads.map((thread, index) => (
              <li key={index} className={styles.thread}>
                <span className={styles.threadText}>
                  <ThreadText text={thread} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
