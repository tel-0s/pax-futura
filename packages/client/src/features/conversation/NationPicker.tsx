import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Plus, Search } from "lucide-react";
import type { Polity } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { Popover } from "../../components/Popover.tsx";
import styles from "./Cast.module.css";

/** Same shape the server accepts for a custom polity code. */
const CODE_PATTERN = /^[A-Z0-9]{2,8}$/;

interface Option {
  code: string;
  polity: Polity | null;
}

const rank = (polity: Polity, query: string): number => {
  const code = polity.code.toLowerCase();
  const name = polity.name.toLowerCase();
  if (code === query) return 0;
  if (name.startsWith(query) || code.startsWith(query)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  return 3;
};

/**
 * Pick a foreign court to open a diplomatic channel with: every polity in the
 * checked-out world (bar the player's own), searchable by name, code or
 * alias, plus a free-text code for landless or not-yet-mapped powers. Arrow
 * keys walk the list, Enter opens. A court that already has a channel is
 * marked "open" — picking it re-focuses that channel.
 */
export function NationPicker({
  polities,
  palette,
  playerCode,
  openCodes,
  onPick,
  variant = "seat",
  align = "end",
  side = "bottom",
}: {
  polities: Readonly<Record<string, Polity>> | undefined;
  palette: Readonly<Record<string, string>>;
  playerCode: string | undefined;
  openCodes: Set<string>;
  onPick: (code: string) => void;
  variant?: "seat" | "button";
  align?: "start" | "end" | "center";
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  const courts = useMemo(
    () =>
      Object.values(polities ?? {})
        .filter((polity) => polity.code !== playerCode)
        .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code)),
    [polities, playerCode],
  );

  const needle = query.trim().toLowerCase();
  const options = useMemo<Option[]>(() => {
    const matches = needle
      ? courts
          .filter(
            (polity) =>
              polity.code.toLowerCase().includes(needle) ||
              polity.name.toLowerCase().includes(needle) ||
              polity.aliases.some((alias) => alias.toLowerCase().includes(needle)),
          )
          .sort((a, b) => rank(a, needle) - rank(b, needle))
      : courts;
    const typed = needle.toUpperCase();
    const free: Option[] =
      CODE_PATTERN.test(typed) && !polities?.[typed] && typed !== playerCode
        ? [{ code: typed, polity: null }]
        : [];
    const courtOptions = matches.map((polity) => ({ code: polity.code, polity }));
    // A typed code outranks incidental mid-word hits ("ITA" inside
    // "Britain"); a real prefix match still comes first.
    const strong = matches.some((polity) => rank(polity, needle) <= 1);
    return strong ? [...courtOptions, ...free] : [...free, ...courtOptions];
  }, [courts, needle, polities, playerCode]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (code: string) => {
    close();
    onPick(code);
  };

  const toggle = () => (open ? close() : setOpen(true));

  const trigger =
    variant === "seat" ? (
      <button
        type="button"
        className={`${styles.seat} ${open ? styles.seatOpen : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open a diplomatic channel"
        title="Open a channel with a foreign court"
        onClick={toggle}
      >
        <Globe size={15} />
      </button>
    ) : (
      <Button aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Globe size={14} /> Write to a foreign court
      </Button>
    );

  return (
    <Popover open={open} onClose={close} trigger={trigger} align={align} side={side} width={300}>
      <div className={styles.picker}>
        <div className={styles.pickerHead}>
          <span className="pfKicker">Foreign courts</span>
          <span className={styles.pickerNote}>{courts.length} known</span>
        </div>
        <label className={styles.search}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            autoFocus
            placeholder="Name or code…"
            aria-label="Search nations"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = options[cursor];
                if (option) pick(option.code);
              }
            }}
          />
        </label>
        <div className={styles.pickList} ref={list} role="listbox" aria-label="Nations">
          {options.map((option, index) => (
            <button
              key={option.polity ? option.code : `free:${option.code}`}
              type="button"
              role="option"
              aria-selected={index === cursor}
              data-index={index}
              className={`${styles.pickRow} ${styles.pickCompact} ${index === cursor ? styles.pickCursor : ""}`}
              onMouseMove={() => setCursor(index)}
              onClick={() => pick(option.code)}
            >
              {option.polity ? (
                <>
                  <PolityFlag flag={option.polity.flag} color={palette[option.code]} size={20} />
                  <span className={styles.pickText}>
                    <span className={styles.pickName}>
                      {option.polity.name || option.code}
                      {openCodes.has(option.code) ? <span className={styles.pickOpen}>open</span> : null}
                    </span>
                  </span>
                  <span className={styles.pickCode}>{option.code}</span>
                </>
              ) : (
                <>
                  <span className={styles.pickPlus}>
                    <Plus size={13} />
                  </span>
                  <span className={styles.pickText}>
                    <span className={styles.pickName}>Open “{option.code}”</span>
                    <span className={styles.pickHint}>a landless or unmapped power</span>
                  </span>
                </>
              )}
            </button>
          ))}
          {options.length === 0 ? (
            <p className={styles.pickEmpty}>
              No court answers to that. Type a 2–8 letter code to reach a landless power.
            </p>
          ) : null}
        </div>
      </div>
    </Popover>
  );
}
