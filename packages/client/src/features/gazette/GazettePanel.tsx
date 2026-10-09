import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Newspaper, RotateCw, TriangleAlert, X } from "lucide-react";
import type { Theme } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { formatGameDate, parseGameDate } from "../../lib/dates.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useGazetteStore } from "./gazetteStore.ts";
import styles from "./gazette.module.css";

/**
 * How the front page is printed. The engine already writes the copy in the
 * game's period voice; the SHEET is dressed by the theme — keyed on the
 * theme's material (texture/ornament), not its id, so a custom theme built
 * from a preset inherits that preset's press.
 */
type Press = "chronicle" | "briefing" | "bulletin" | "editorial" | "wire";

const pressFor = (theme: Theme): Press => {
  if (theme.style.texture === "scanlines") return "wire";
  if (theme.style.ornament === "double-rule") return "chronicle";
  if (theme.style.ornament === "hazard") return "bulletin";
  if (theme.style.ornament === "hairline") return "editorial";
  if (theme.style.ornament === "brackets") return "briefing";
  return theme.meta.scheme === "light" ? "editorial" : "briefing";
};

const ROMAN: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const toRoman = (value: number): string => {
  if (value <= 0 || value >= 4000) return String(value);
  let rest = value;
  let out = "";
  for (const [size, glyph] of ROMAN) {
    while (rest >= size) {
      out += glyph;
      rest -= size;
    }
  }
  return out;
};

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Per-press furniture: the small print around the copy. */
const furniture = (press: Press, issue: number, year: number | null) => {
  switch (press) {
    case "chronicle":
      return {
        issue: `No. ${toRoman(Math.max(1, issue))}`,
        flag: year && year > 0 ? `Anno Domini ${toRoman(year)}` : "Of the Realm",
        stamp: "",
        loading: "The scribes are at their desks…",
        colophon: "Set down faithfully by the chronicler of the realm",
      };
    case "briefing":
      return {
        issue: `DIS-${pad(issue, 4)}`,
        flag: "Top secret // Eyes only",
        stamp: "Classified",
        loading: "Compiling the intelligence summary…",
        colophon: "Distribution: head of state · cabinet · general staff — destroy after reading",
      };
    case "bulletin":
      return {
        issue: `BLT-${pad(issue, 3)}`,
        flag: "Field bulletin",
        stamp: "Priority",
        loading: "Receiving field reports…",
        colophon: "// End of bulletin",
      };
    case "wire":
      return {
        issue: `ZCZC PXF${pad(issue, 3)}`,
        flag: "Flash",
        stamp: "",
        loading: "Awaiting wire…",
        colophon: "NNNN",
      };
    default:
      return {
        issue: `No. ${issue}`,
        flag: "Late edition",
        stamp: "",
        loading: "Setting the type…",
        colophon: "Printed from the record of this turn",
      };
  }
};

/** Long leads set in two columns; a couple of sentences read better full-width. */
const LONG_LEAD = 320;
/** Mastheads past this many characters set a size smaller. */
const LONG_MASTHEAD = 28;

/** The turn's front page: a full-bleed themed overlay, styled by the engine
 *  in period voice. Cached per node — reopening the same turn is instant. */
export function GazettePanel({
  gameId,
  nodeId,
  onClose,
}: {
  gameId: string;
  nodeId: string;
  onClose: () => void;
}) {
  const gazette = useGazetteStore((state) => state.byNode[nodeId]);
  const loading = useGazetteStore((state) => state.loading[nodeId]);
  const error = useGazetteStore((state) => state.error[nodeId]);
  const fetchGazette = useGazetteStore((state) => state.fetch);
  const node = useLoomStore((state) => state.nodes[nodeId]);
  const themes = useThemesStore((state) => state.themes);
  const themeId = useUiStore((state) => state.themeId);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchGazette(gameId, nodeId);
  }, [gameId, nodeId, fetchGazette]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Take focus so Page Down / arrows scroll the paper, not the stage.
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);

  const press = pressFor(selectTheme(themes, themeId));
  const year = parseGameDate(node?.gameDate)?.year ?? null;
  const print = furniture(press, node?.depth ?? 0, year);
  const [lead, ...rest] = gazette?.articles ?? [];
  const when = formatGameDate(node?.gameDate);
  const dateline = gazette?.dateline ? formatGameDate(gazette.dateline) : when;
  const refresh = () => void fetchGazette(gameId, nodeId, true);

  // Portaled like Modal: the stage canvas sits under the top bar's stacking
  // context, and the front page should cover the whole screen.
  return createPortal(
    // mousedown, not click: a text selection dragged out of the sheet must not
    // close the paper on mouseup.
    <div className={styles.scrim} onMouseDown={onClose}>
      <button
        className={styles.close}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
        aria-label="Close gazette"
        title="Close (Esc)"
      >
        <X size={18} />
      </button>
      <div
        ref={sheet}
        tabIndex={-1}
        className={styles.sheet}
        data-press={press}
        role="dialog"
        aria-modal="true"
        aria-label={gazette?.masthead ?? "The Gazette"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.masthead}>
          <div className={styles.topline}>
            <span className={styles.issue}>{print.issue}</span>
            <span className={styles.flag}>{print.flag}</span>
            {/* A bare-date dateline already says when; the corner says which turn. */}
            <span className={styles.when}>{dateline === when ? `Turn ${node?.depth ?? 0}` : when}</span>
          </div>
          {print.stamp && gazette ? (
            <span className={styles.stamp} aria-hidden>
              {print.stamp}
            </span>
          ) : null}
          <h1
            className={`${styles.title} ${(gazette?.masthead.length ?? 0) > LONG_MASTHEAD ? styles.titleLong : ""}`}
          >
            {gazette?.masthead ?? "The Gazette"}
          </h1>
          <div className={styles.dateline}>
            <span className={styles.datelineText}>{dateline}</span>
            {gazette?.motto ? <span className={styles.motto}>{gazette.motto}</span> : null}
          </div>
        </header>
        <div className={styles.rule} aria-hidden />

        {loading && !gazette ? (
          <div className={styles.press} role="status">
            <span className={styles.pressLabel}>
              <Newspaper size={16} /> {print.loading}
            </span>
            <div className={styles.skeleton} aria-hidden>
              <span className={styles.skelHeadline} />
              <span className={styles.skelHeadlineShort} />
              <div className={styles.skelColumns}>
                {[0, 1, 2].map((column) => (
                  <div key={column} className={styles.skelColumn}>
                    {[92, 100, 86, 97, 64].map((width, line) => (
                      <span key={line} className={styles.skelLine} style={{ width: `${width}%` }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {error && !gazette ? (
          <div className={styles.problem} role="alert">
            <TriangleAlert size={24} className={styles.problemIcon} />
            <p className={styles.problemTitle}>The presses jammed.</p>
            <p className={styles.problemText}>{error}</p>
            <Button disabled={Boolean(loading)} onClick={refresh}>
              <RotateCw size={14} /> Try again
            </Button>
          </div>
        ) : null}

        {lead ? (
          <article className={styles.lead}>
            <span className={styles.kicker}>
              <span className={styles.index}>01</span>
              <span className={styles.kind}>{lead.kind}</span>
            </span>
            <h2 className={styles.leadHeadline}>{lead.headline}</h2>
            {lead.body ? (
              <p className={`${styles.leadBody} ${lead.body.length > LONG_LEAD ? styles.leadLong : ""}`}>
                {lead.body}
              </p>
            ) : null}
          </article>
        ) : null}

        {rest.length > 0 ? (
          <div className={styles.columns} data-count={rest.length}>
            {rest.map((article, index) => (
              <article key={index} className={styles.article}>
                <span className={styles.kicker}>
                  <span className={styles.index}>{pad(index + 2, 2)}</span>
                  <span className={styles.kind}>{article.kind}</span>
                </span>
                <h3 className={styles.headline}>{article.headline}</h3>
                {article.body ? <p className={styles.body}>{article.body}</p> : null}
              </article>
            ))}
          </div>
        ) : null}

        {gazette ? (
          <footer className={styles.footer}>
            <span className={styles.colophon}>{print.colophon}</span>
            {error ? <span className={styles.footError}>{error}</span> : null}
            <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={refresh}>
              <RotateCw size={13} className={loading ? styles.spinning : undefined} /> Fresh edition
            </Button>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
