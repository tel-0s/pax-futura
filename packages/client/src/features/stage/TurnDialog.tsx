import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FastForward, Ghost, ListTodo, SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api } from "../../lib/api.ts";
import { formatGameDate, formatGameMonth, parseGameDate } from "../../lib/dates.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./TurnDialog.module.css";

const INTERVALS = [
  { label: "1 day", amount: "1", unit: "day", days: 1 },
  { label: "1 week", amount: "1", unit: "week", days: 7 },
  { label: "1 month", amount: "1", unit: "month", days: 30 },
  { label: "3 months", amount: "3", unit: "months", days: 90 },
  { label: "6 months", amount: "6", unit: "months", days: 180 },
  { label: "1 year", amount: "1", unit: "year", days: 365 },
];

/** Tile index of the Custom… toggle (after the fixed intervals). */
const CUSTOM_INDEX = INTERVALS.length;
/** Grid columns — arrow keys walk the tiles as laid out. */
const COLUMNS = 4;

const CUSTOM_UNITS = [
  { label: "days", days: 1 },
  { label: "weeks", days: 7 },
  { label: "months", days: 30 },
  { label: "years", days: 365 },
];

/** TurnInput.jumpDays is capped server-side; clamp rather than 400. */
const MAX_JUMP_DAYS = 36500;

/** Scouting is a habit, not a per-turn whim — remember the last choice. */
const SCOUT_KEY = "pax-scout-first";
/** So is the cadence: the last interval run gets the focus next time (T, Enter). */
const LAST_JUMP_KEY = "pax-last-jump";

/**
 * Game date + N days, as an ISO-ish game date. The model picks the actual
 * stop date (anywhere up to the end of the span), so this is the latest the
 * turn can land — a preview, never a promise. setUTCFullYear keeps years
 * below 100 and BC years intact (Date.UTC would remap 0–99 to 1900–1999).
 */
const addDays = (value: string | undefined, days: number): string | null => {
  const parts = parseGameDate(value);
  if (!parts) return null;
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** "9 Jul 1228" — the tile-sized form of a game date. */
const shortDate = (value: string | null): string => {
  const parts = parseGameDate(value);
  return parts ? `${parts.day} ${formatGameMonth(value)}` : "";
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Fast-forward: pick how much time the next simulation covers. */
export function TurnDialog({
  gameId,
  parentId,
  onClose,
  onScout,
}: {
  gameId: string;
  parentId: string;
  onClose: () => void;
  /** Called with the in-flight request when the turn was launched as a scout. */
  onScout: (request: Promise<unknown>) => void;
}) {
  const orders = useOrdersStore((state) => state.orders);
  const parent = useLoomStore((state) => state.nodes[parentId]);
  const openLeftDrawer = useUiStore((state) => state.openLeftDrawer);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(2);
  const [customUnit, setCustomUnit] = useState(7);
  const [scoutFirst, setScoutFirst] = useState(() => localStorage.getItem(SCOUT_KEY) === "1");
  const [selected, setSelected] = useState(() => {
    const last = Number(localStorage.getItem(LAST_JUMP_KEY));
    const index = INTERVALS.findIndex((interval) => interval.days === last);
    return index >= 0 ? index : 2;
  });
  const [hovered, setHovered] = useState<number | null>(null);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const amountInput = useRef<HTMLInputElement>(null);

  // Land on the last-used cadence so "T, Enter" repeats the previous jump.
  useEffect(() => {
    // Mount-only (empty deps): later focus moves are the player's.
    tiles.current[selected]?.focus();
  }, []);

  useEffect(() => {
    if (customOpen) amountInput.current?.select();
  }, [customOpen]);

  const chooseScout = (next: boolean) => {
    localStorage.setItem(SCOUT_KEY, next ? "1" : "0");
    setScoutFirst(next);
  };

  const run = (jumpDays: number) => {
    localStorage.setItem(LAST_JUMP_KEY, String(jumpDays));
    onClose();
    const request = api.executeTurn(gameId, parentId, {
      jumpDays,
      stopPolicy: "toDate",
      // commit:false persists the node without moving the checkout or the
      // preferred path — the player accepts or discards it afterwards.
      ...(scoutFirst ? { commit: false } : {}),
    });
    // Fire and forget: progress streams into the composer via SSE; failures
    // surface as failed loom nodes with a retry path. A scout's result needs a
    // decision, so the stage follows that request instead.
    if (scoutFirst) onScout(request);
    else void request.catch(() => {});
  };

  const customDays = Math.min(
    MAX_JUMP_DAYS,
    Math.max(1, Math.round((Number.isFinite(customAmount) ? customAmount : 1) * customUnit)),
  );

  const focusTile = (index: number) => {
    const next = Math.max(0, Math.min(CUSTOM_INDEX, index));
    tiles.current[next]?.focus();
  };

  // Number keys pick a tile, arrows walk the grid, Enter (native on the
  // focused button) runs it. Never while typing in the custom amount.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= CUSTOM_INDEX + 1) {
      event.preventDefault();
      focusTile(digit - 1);
      if (digit - 1 === CUSTOM_INDEX) setCustomOpen(true);
      return;
    }
    const tileIndex = tiles.current.findIndex((tile) => tile === target);
    if (tileIndex < 0) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    focusTile(tileIndex + step);
  };

  const shown = hovered ?? selected;
  const previewDays =
    shown === CUSTOM_INDEX ? (customOpen ? customDays : null) : (INTERVALS[shown]?.days ?? null);
  const arrival = previewDays === null ? null : addDays(parent?.gameDate, previewDays);
  const spanLabel =
    shown === CUSTOM_INDEX
      ? customOpen
        ? plural(customDays, "day")
        : "a span of your choosing"
      : (INTERVALS[shown]?.label ?? "");

  return (
    <Modal
      kicker="Fast-forward"
      title="Advance time"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className={styles.hints} aria-hidden>
            <kbd>1</kbd>–<kbd>7</kbd> choose <span className={styles.hintSep} />
            <kbd>←</kbd>
            <kbd>→</kbd> move <span className={styles.hintSep} />
            <kbd>Enter</kbd> {scoutFirst ? "scout" : "advance"} <span className={styles.hintSep} />
            <kbd>Esc</kbd> cancel
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className={`${styles.sheet} ${scoutFirst ? styles.scouting : ""}`} onKeyDown={onKeyDown}>
        <div className={styles.chronometer}>
          <div className={styles.endpoint}>
            <span className="pfKicker">Now · Turn {parent?.depth ?? 0}</span>
            <span className={styles.date}>{formatGameDate(parent?.gameDate)}</span>
          </div>
          <div className={styles.track} aria-hidden>
            <span className={styles.trackLine} />
            <span className={styles.trackLabel}>{spanLabel}</span>
          </div>
          <div className={`${styles.endpoint} ${styles.arrival}`}>
            <span className="pfKicker">{scoutFirst ? "Scout up to" : "Simulate up to"}</span>
            <span
              key={arrival ?? "none"}
              className={`${styles.date} ${styles.arrivalDate}`}
              aria-live="polite"
            >
              {arrival ? formatGameDate(arrival) : "—"}
            </span>
          </div>
        </div>

        <div className={styles.grid} role="group" aria-label="Interval">
          {INTERVALS.map((interval, index) => {
            const until = shortDate(addDays(parent?.gameDate, interval.days));
            return (
              <button
                key={interval.days}
                ref={(node) => {
                  tiles.current[index] = node;
                }}
                className={`${styles.tile} ${selected === index ? styles.tileSelected : ""} pfChamfer`}
                onClick={() => run(interval.days)}
                onFocus={() => setSelected(index)}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                aria-label={`${scoutFirst ? "Scout" : "Advance"} ${interval.label}${until ? `, until ${until}` : ""}`}
              >
                <kbd className={styles.tileKey}>{index + 1}</kbd>
                <span className={styles.tileFigure}>
                  <span className={styles.tileAmount}>{interval.amount}</span>
                  <span className={styles.tileUnit}>{interval.unit}</span>
                </span>
                <span className={styles.tileDate}>{until ? `→ ${until}` : " "}</span>
              </button>
            );
          })}
          <button
            ref={(node) => {
              tiles.current[CUSTOM_INDEX] = node;
            }}
            className={`${styles.tile} ${styles.tileCustom} ${customOpen ? styles.tileOpen : ""} ${selected === CUSTOM_INDEX ? styles.tileSelected : ""} pfChamfer`}
            onClick={() => setCustomOpen(!customOpen)}
            onFocus={() => setSelected(CUSTOM_INDEX)}
            onMouseEnter={() => setHovered(CUSTOM_INDEX)}
            onMouseLeave={() => setHovered(null)}
            aria-expanded={customOpen}
          >
            <kbd className={styles.tileKey}>{CUSTOM_INDEX + 1}</kbd>
            <SlidersHorizontal size={22} className={styles.customIcon} />
            <span className={styles.customText}>
              <span className={styles.tileUnit}>Custom…</span>
              <span className={styles.tileDate}>any span, up to a century</span>
            </span>
          </button>
        </div>

        {customOpen ? (
          <div className={styles.custom}>
            <input
              ref={amountInput}
              className={styles.amount}
              type="number"
              min={1}
              aria-label="Amount"
              value={customAmount}
              onChange={(event) => setCustomAmount(Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") run(customDays);
              }}
            />
            <div className={styles.units} role="radiogroup" aria-label="Unit">
              {CUSTOM_UNITS.map((unit) => (
                <button
                  key={unit.label}
                  role="radio"
                  aria-checked={customUnit === unit.days}
                  className={`${styles.unit} ${customUnit === unit.days ? styles.unitActive : ""}`}
                  onClick={() => setCustomUnit(unit.days)}
                >
                  {unit.label}
                </button>
              ))}
            </div>
            <span className={styles.customPreview}>
              {plural(customDays, "day")}
              {addDays(parent?.gameDate, customDays) ? (
                <> → {shortDate(addDays(parent?.gameDate, customDays))}</>
              ) : null}
            </span>
            <Button variant="primary" onClick={() => run(customDays)}>
              {scoutFirst ? <Ghost size={15} /> : <FastForward size={15} />}
              {scoutFirst ? "Scout" : "Advance"} {plural(customDays, "day")}
            </Button>
          </div>
        ) : null}

        <div className={styles.lower}>
          <section className={styles.card} aria-label="Queued orders">
            <header className={styles.cardHead}>
              <ListTodo size={14} className={styles.cardIcon} />
              <span className="pfKicker">Orders on the table</span>
              <span className={styles.count}>{orders.length}</span>
              <button
                className={styles.link}
                onClick={() => {
                  onClose();
                  openLeftDrawer("orders");
                }}
              >
                {orders.length > 0 ? "Review" : "Write orders"}
              </button>
            </header>
            {orders.length > 0 ? (
              <ol className={styles.orderList}>
                {orders.slice(0, 3).map((order) => (
                  <li key={order.id} className={styles.order} title={order.text || order.title}>
                    {order.title}
                  </li>
                ))}
                {orders.length > 3 ? (
                  <li className={styles.more}>+ {plural(orders.length - 3, "more order")}</li>
                ) : null}
              </ol>
            ) : (
              <>
                <p className={styles.empty}>No orders queued — the world will move on its own.</p>
                <p className={styles.emptyHint}>
                  Orders written in the command line are carried out as the span unfolds.
                </p>
              </>
            )}
          </section>

          <button
            role="switch"
            aria-checked={scoutFirst}
            className={`${styles.card} ${styles.scout} ${scoutFirst ? styles.scoutOn : ""}`}
            onClick={() => chooseScout(!scoutFirst)}
          >
            <span className={styles.switch} aria-hidden>
              <span className={styles.knob} />
            </span>
            <span className={styles.scoutText}>
              <span className={styles.scoutTitle}>
                <Ghost size={14} /> Scout first
              </span>
              <span className={styles.scoutHelp}>
                Run the turn without committing it. Preview the outcome on the map, then accept it
                into the timeline or discard it.
              </span>
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
