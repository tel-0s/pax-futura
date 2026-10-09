import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  GitBranch,
  Landmark,
  LoaderCircle,
  MapPin,
  Scale,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import {
  COUNTRY_ENTRIES,
  DIFFICULTIES,
  REGION_ENTRIES,
  regionDisplayName,
  type DifficultyId,
  type Impacts,
  type WorldState,
} from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { api } from "../../lib/api.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { GmUnitSection, GmMarkerSection, GmRawSection } from "./GmOps.tsx";
import { GmPublish } from "./GmPublish.tsx";
import { GmReassess } from "./GmReassess.tsx";
import { GmSection, OwnerTag, usePolityPalette } from "./GmSection.tsx";
import styles from "./gm.module.css";

/** Partial impacts: the server schema defaults the untouched op arrays.
 *  Resolves true when the edit landed (a new GM node), false otherwise. */
export type GmSubmit = (impacts: Partial<Impacts>, note: string) => Promise<boolean>;

type GmTab = "map" | "realms" | "forces" | "rules" | "raw" | "publish";

const TABS: Array<{ id: GmTab; label: string }> = [
  { id: "map", label: "Map" },
  { id: "realms", label: "Realms" },
  { id: "forces", label: "Forces" },
  { id: "rules", label: "Rules" },
  { id: "raw", label: "Raw" },
  { id: "publish", label: "Publish" },
];

/** The bench reopens on the tool you last used (per page session). */
let lastTab: GmTab = "map";

type Status = { tone: "busy" | "done" | "error"; text: string } | null;

const STATUS_CLASS: Record<"busy" | "done" | "error", string | undefined> = {
  busy: styles.statusBusy,
  done: styles.statusDone,
  error: styles.statusError,
};

/**
 * The game-master drawer: direct world surgery for debugging and worldcrafting.
 * Every apply becomes a same-date child node on the loom (deterministic, no
 * LLM), so GM edits are branchable and undoable like any turn.
 */
export function GmDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodeId = useLoomStore((state) => state.currentNodeId);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const liveWorld = useWorldStore((state) => state.world);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<GmTab>(lastTab);
  const [status, setStatus] = useState<Status>(null);

  // Every apply invalidates the world store (world: null) for the round-trip;
  // rendering the last snapshot through the gap keeps the sections mounted so
  // half-typed edits in OTHER sections survive an apply. (Tabs only hide their
  // panels for the same reason — switching tabs never discards a draft.)
  const lastWorld = useRef(liveWorld);
  if (liveWorld) lastWorld.current = liveWorld;
  const world = liveWorld ?? lastWorld.current;

  // A confirmation fades on its own; errors stay until dismissed or replaced.
  useEffect(() => {
    if (status?.tone !== "done") return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!gameId || !nodeId || !world) return null;

  const submit: GmSubmit = async (impacts, note) => {
    if (busy) return false;
    setBusy(true);
    setStatus({ tone: "busy", text: `Applying ${note}…` });
    try {
      await api.gmEdit(gameId, nodeId, { note, impacts: impacts as Impacts });
      setStatus({ tone: "done", text: `Applied ${note} — a new GM node is checked out on the loom.` });
      return true;
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const select = (id: string) => {
    lastTab = id as GmTab;
    setTab(id as GmTab);
  };

  return (
    <Drawer
      side="left"
      wide
      icon={<WandSparkles size={16} />}
      kicker="World surgery"
      title="Game master"
      onClose={() => setLeftDrawer(null)}
    >
      <div className={styles.wrap}>
        <div className={styles.bench}>
          <p className={styles.lede}>
            <GitBranch size={13} aria-hidden />
            <span>
              Each apply lands as a <strong>GM</strong> node on the loom — delete the node to undo.
            </span>
          </p>
          <Tabs items={TABS} activeId={tab} onSelect={select} />
          {status ? (
            <div className={`${styles.status} ${STATUS_CLASS[status.tone]}`} role="status">
              {status.tone === "busy" ? (
                <LoaderCircle size={14} className={styles.spin} aria-hidden />
              ) : status.tone === "done" ? (
                <Check size={14} aria-hidden />
              ) : (
                <CircleAlert size={14} aria-hidden />
              )}
              <span className={styles.statusText}>{status.text}</span>
              {status.tone !== "busy" ? (
                <button className={styles.statusClose} onClick={() => setStatus(null)} aria-label="Dismiss">
                  <X size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.panel} hidden={tab !== "map"}>
          <RegionSection world={world} submit={submit} busy={busy} />
          <GmReassess gameId={gameId} nodeId={nodeId} submit={submit} busy={busy} />
        </div>
        <div className={styles.panel} hidden={tab !== "realms"}>
          <PolitySection world={world} submit={submit} busy={busy} />
        </div>
        <div className={styles.panel} hidden={tab !== "forces"}>
          <GmUnitSection world={world} submit={submit} busy={busy} />
          <GmMarkerSection world={world} submit={submit} busy={busy} />
        </div>
        <div className={styles.panel} hidden={tab !== "rules"}>
          <DifficultySection gameId={gameId} />
        </div>
        <div className={styles.panel} hidden={tab !== "raw"}>
          <GmRawSection submit={submit} busy={busy} />
        </div>
        <div className={styles.panel} hidden={tab !== "publish"}>
          <GmPublish gameId={gameId} nodeId={nodeId} />
        </div>
      </div>
    </Drawer>
  );
}

export interface GmSectionProps {
  world: WorldState;
  submit: GmSubmit;
  busy: boolean;
}

/** Pre-ladder saves stored these; they still resolve in the prompt pack. */
const LEGACY_ALIASES: Record<string, DifficultyId> = {
  easy: "permissive",
  hard: "challenging",
};

const isKnownDifficulty = (value: string): value is DifficultyId =>
  DIFFICULTIES.some((level) => level.id === value);

/**
 * Simulation strictness is a live game setting, not world state, so it is
 * saved straight to the game row instead of becoming a loom node.
 */
function DifficultySection({ gameId }: { gameId: string }) {
  const meta = useSessionStore((state) => state.meta);
  const stored = meta?.difficulty ?? "standard";
  const [choice, setChoice] = useState(LEGACY_ALIASES[stored] ?? stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const known = isKnownDifficulty(choice);
  const chosenIndex = DIFFICULTIES.findIndex((level) => level.id === choice);
  const storedIndex = DIFFICULTIES.findIndex((level) => level.id === (LEGACY_ALIASES[stored] ?? stored));
  const level = chosenIndex >= 0 ? DIFFICULTIES[chosenIndex] : undefined;

  const apply = async () => {
    if (busy || !known) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.setDifficulty(gameId, { difficulty: choice });
      useSessionStore.getState().setMeta(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GmSection
      icon={Scale}
      title="Simulation strictness"
      hint="How hard the world pushes back. Every level lets you attempt anything — only the outcomes differ."
    >
      <div className={styles.ladderHead}>
        <span className={`${styles.ladderName} pfTitle`}>{level?.label ?? choice}</span>
        <span className={styles.ladderRung}>{chosenIndex >= 0 ? `rung ${chosenIndex + 1} / ${DIFFICULTIES.length}` : "unrecognized"}</span>
      </div>
      <div className={styles.ladder} role="radiogroup" aria-label="Simulation strictness">
        {DIFFICULTIES.map((rung, index) => {
          const height = 14 + index * 7;
          return (
            <button
              key={rung.id}
              role="radio"
              aria-checked={rung.id === choice}
              title={`${rung.label} — ${rung.description}`}
              className={[
                styles.rung,
                chosenIndex >= 0 && index <= chosenIndex ? styles.rungOn : "",
                rung.id === choice ? styles.rungChosen : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setChoice(rung.id)}
            >
              <span className={styles.rungTrack}>
                <span className={styles.rungBar} style={{ height: `${height}px` }} />
                {index === storedIndex ? (
                  <span className={styles.rungInForce} style={{ bottom: `${height + 5}px` }} title="In force now" />
                ) : null}
              </span>
              <span className={styles.rungLabel}>{rung.label}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.ladderText}>
        {level?.description ?? `Saved as “${choice}” — pick a level to replace it.`}
      </p>
      <p className={styles.hint}>
        {choice === stored
          ? "In force now. Changes take effect from the next turn; past nodes keep the level they ran under."
          : `In force: ${DIFFICULTIES[storedIndex]?.label ?? stored}. Takes effect from the next turn; past nodes keep the level they ran under.`}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy || !known || choice === stored} onClick={() => void apply()}>
          {busy ? "Saving…" : "Apply strictness"}
        </Button>
      </div>
    </GmSection>
  );
}

const ALL_REGION_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ...COUNTRY_ENTRIES,
  ...REGION_ENTRIES,
];

const COUNTRY_KEY = /^[A-Z]{3}$/;

/** Who paints a region id today: its own override, else its country's. */
const ownerOf = (world: WorldState, id: string): string | undefined => {
  const direct = world.regionOwnership[id];
  if (direct || COUNTRY_KEY.test(id)) return direct ?? (world.polities[id] ? id : undefined);
  const country = id.split(".")[0] ?? "";
  return world.regionOwnership[country] ?? (world.polities[country] ? country : undefined);
};

/** Assign (or clear) ownership of any map region, searched by code or name. */
function RegionSection({ world, submit, busy }: GmSectionProps) {
  const selection = useUiStore((state) => state.selection);
  const palette = usePolityPalette(world);
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("");
  const [owner, setOwner] = useState("");
  const [cursor, setCursor] = useState(0);

  const q = query.trim().toLowerCase();
  const suggestions =
    q.length >= 2 && !regionId
      ? ALL_REGION_ENTRIES.filter(
          ([id, name]) => id.toLowerCase().includes(q) || name.toLowerCase().includes(q),
        ).slice(0, 8)
      : [];

  const chosen = regionId || (q ? query.trim() : "");
  const currentOwner = chosen ? world.regionOwnership[chosen] : undefined;
  // What the map shows there now (an override or the country's self-owner) —
  // display only; the transfer's fromCode stays the explicit override.
  const paintedOwner = chosen ? ownerOf(world, chosen) : undefined;

  // Quick picks from the last map click: the province, and its country.
  const pickProvince = selection.regionId;
  const pickCountry =
    selection.regionId?.split(".")[0] ??
    (selection.polityCode && COUNTRY_KEY.test(selection.polityCode) ? selection.polityCode : undefined);

  const pick = (id: string) => {
    setRegionId(id);
    setQuery("");
    setCursor(0);
  };

  const apply = () =>
    void submit(
      { regionTransfers: [{ regionId: chosen, regionName: regionDisplayName(chosen), fromCode: currentOwner ?? "", toCode: owner || null, note: "GM edit" }] },
      owner ? `${regionDisplayName(chosen)} -> ${owner}` : `${regionDisplayName(chosen)} unowned`,
    );

  return (
    <GmSection
      icon={MapPin}
      title="Region ownership"
      hint="Grant any country or province to a power — or return it to terra incognita."
    >
      {(pickProvince || pickCountry) && !regionId ? (
        <div className={styles.picks}>
          <span className={styles.picksLabel}>From map</span>
          {pickProvince ? (
            <button className={styles.pick} onClick={() => pick(pickProvince)}>
              {regionDisplayName(pickProvince)}
            </button>
          ) : null}
          {pickCountry ? (
            <button className={styles.pick} onClick={() => pick(pickCountry)}>
              {regionDisplayName(pickCountry)}
            </button>
          ) : null}
        </div>
      ) : null}

      {regionId ? (
        <div className={styles.chosen}>
          <MapPin size={15} className={styles.chosenIcon} aria-hidden />
          <span className={styles.chosenBody}>
            <span className={styles.chosenName}>{regionDisplayName(regionId)}</span>
            <span className={styles.chosenMeta}>
              <code>{regionId}</code> · held by <OwnerTag code={paintedOwner} world={world} palette={palette} />
            </span>
          </span>
          <Button variant="ghost" size="sm" icon title="Choose another region" aria-label="Clear region" onClick={() => setRegionId("")}>
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className={styles.search}>
          <label className={styles.fieldLabel} htmlFor="gm-region-search">
            Region — code or name
          </label>
          <div className={styles.searchBox}>
            <Search size={14} className={styles.searchIcon} aria-hidden />
            <input
              id="gm-region-search"
              className={styles.searchInput}
              placeholder="USA, Normandie, FRA.11_1…"
              value={query}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="gm-region-results"
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (!suggestions.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCursor((cursor + 1) % suggestions.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor((cursor - 1 + suggestions.length) % suggestions.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const hit = suggestions[cursor];
                  if (hit) pick(hit[0]);
                }
              }}
            />
            {query ? (
              <button className={styles.searchClear} onClick={() => setQuery("")} aria-label="Clear search">
                <X size={13} />
              </button>
            ) : null}
          </div>
          {suggestions.length > 0 ? (
            <ul id="gm-region-results" className={styles.results} role="listbox">
              {suggestions.map(([id, name], index) => (
                <li key={id} role="option" aria-selected={index === cursor}>
                  <button
                    className={`${styles.result} ${index === cursor ? styles.resultActive : ""}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => pick(id)}
                  >
                    <span className={styles.resultName}>{name}</span>
                    <code className={styles.resultId}>{id}</code>
                    <OwnerTag code={ownerOf(world, id)} world={world} palette={palette} short />
                  </button>
                </li>
              ))}
            </ul>
          ) : q.length >= 2 ? (
            <p className={styles.hint}>
              No catalog match — “{query.trim()}” will be used as a raw region id.
            </p>
          ) : null}
        </div>
      )}

      <label className={styles.selectField}>
        <span className={styles.fieldLabel}>New owner</span>
        <select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">(unowned — terra incognita)</option>
          {Object.values(world.polities).map((polity) => (
            <option key={polity.code} value={polity.code}>
              {polity.name || polity.code}
            </option>
          ))}
        </select>
      </label>

      {chosen ? (
        <div className={styles.transfer} aria-label="Transfer preview">
          <span className={styles.transferRegion}>{regionDisplayName(chosen)}</span>
          <OwnerTag code={paintedOwner} world={world} palette={palette} />
          <ArrowRight size={14} className={styles.transferArrow} aria-hidden />
          <OwnerTag code={owner || null} world={world} palette={palette} />
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button variant="primary" disabled={busy || !chosen} onClick={apply}>
          Apply transfer
        </Button>
      </div>
    </GmSection>
  );
}

/** Edit an existing polity or register a new one (impacts: polityChanges). */
function PolitySection({ world, submit, busy }: GmSectionProps) {
  const selected = useUiStore((state) => state.selection.polityCode);
  const palette = usePolityPalette(world);
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [tags, setTags] = useState("");
  const [reputation, setReputation] = useState("");
  const [note, setNote] = useState("");

  const isNew = code === "__new__";
  const targetCode = isNew ? newCode.trim().toUpperCase() : code;
  const valid = isNew ? /^[A-Z]{2,8}$/.test(targetCode) : Boolean(code);
  const current = !isNew && code ? world.polities[code] : undefined;
  const colorValid = /^#?[0-9a-fA-F]{6}$/.test(color.trim());
  const swatch = colorValid
    ? `#${color.trim().replace(/^#/, "")}`
    : current
      ? (palette[current.code] ?? "")
      : "";
  const pickSelected = selected && world.polities[selected] && selected !== code ? world.polities[selected] : undefined;

  const apply = () =>
    void submit(
      {
        polityChanges: [
          {
            code: targetCode,
            name: name.trim(),
            color: color.trim(),
            aliases: [],
            note: note.trim(),
            reputation: reputation === "" ? null : Math.max(0, Math.min(100, Number(reputation))),
            tags: tags.trim() === "" ? null : tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
          },
        ],
      },
      `polity ${targetCode}`,
    );

  return (
    <GmSection
      icon={Landmark}
      title="Polities"
      hint="Amend a power's record or register a new one. Blank fields stay unchanged."
    >
      {pickSelected ? (
        <div className={styles.picks}>
          <span className={styles.picksLabel}>From map</span>
          <button className={styles.pick} onClick={() => setCode(pickSelected.code)}>
            <PolityFlag flag={pickSelected.flag} color={palette[pickSelected.code]} size={13} />
            {pickSelected.name || pickSelected.code}
          </button>
        </div>
      ) : null}
      <label className={styles.selectField}>
        <span className={styles.fieldLabel}>Target</span>
        <select value={code} onChange={(event) => setCode(event.target.value)}>
          <option value="">Select…</option>
          {Object.values(world.polities).map((polity) => (
            <option key={polity.code} value={polity.code}>
              {polity.name || polity.code}
            </option>
          ))}
          <option value="__new__">New polity…</option>
        </select>
      </label>

      {current ? (
        <div className={styles.record}>
          <PolityFlag flag={current.flag} color={palette[current.code]} size={26} />
          <span className={styles.recordBody}>
            <span className={styles.recordName}>{current.name || current.code}</span>
            <span className={styles.recordMeta}>
              <code>{current.code}</code>
              {current.reputation !== null ? ` · repute ${current.reputation}` : ""}
              {current.tags.length ? ` · ${current.tags.join(", ")}` : ""}
            </span>
          </span>
        </div>
      ) : null}

      {code ? (
        <>
          {isNew ? (
            <div className={styles.grid2}>
              <Field label="Code (2–8 caps)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          ) : (
            <Field label="Name" placeholder={current?.name} value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <div className={styles.grid2}>
            <div className={styles.colorField}>
              <span className={styles.fieldLabel}>Color hex</span>
              <span className={styles.colorRow}>
                <span
                  className={`${styles.colorSwatch} ${swatch ? "" : styles.colorSwatchEmpty}`}
                  style={swatch ? { background: swatch } : undefined}
                  aria-hidden
                />
                <input
                  className={styles.input}
                  placeholder={current?.color || "#FF812A"}
                  value={color}
                  spellCheck={false}
                  onChange={(e) => setColor(e.target.value)}
                />
              </span>
            </div>
            <Field
              label="Reputation 0–100"
              type="number"
              min={0}
              max={100}
              placeholder={current?.reputation !== null && current ? String(current.reputation) : ""}
              value={reputation}
              onChange={(e) => setReputation(e.target.value)}
            />
          </div>
          <Field
            label="Tags, comma-separated"
            placeholder={current?.tags.join(", ")}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <TextAreaField
            label="Note"
            rows={3}
            placeholder={current?.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      ) : (
        <p className={styles.quiet}>Pick a power to amend, or register a new one.</p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy || !valid} onClick={apply}>
          {isNew ? "Register polity" : "Apply polity change"}
        </Button>
      </div>
    </GmSection>
  );
}
