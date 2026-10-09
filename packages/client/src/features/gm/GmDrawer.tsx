import { useRef, useState } from "react";
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
import { Field } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { GmUnitSection, GmMarkerSection, GmRawSection } from "./GmOps.tsx";
import { GmPublish } from "./GmPublish.tsx";
import { GmReassess } from "./GmReassess.tsx";
import styles from "./gm.module.css";

/** Partial impacts: the server schema defaults the untouched op arrays. */
export type GmSubmit = (impacts: Partial<Impacts>, note: string) => Promise<void>;

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

  // Every apply invalidates the world store (world: null) for the round-trip;
  // rendering the last snapshot through the gap keeps the sections mounted so
  // half-typed edits in OTHER sections survive an apply.
  const lastWorld = useRef(liveWorld);
  if (liveWorld) lastWorld.current = liveWorld;
  const world = liveWorld ?? lastWorld.current;

  if (!gameId || !nodeId || !world) return null;

  const submit: GmSubmit = async (impacts, note) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.gmEdit(gameId, nodeId, { note, impacts: impacts as Impacts });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer side="left" title="Game master" onClose={() => setLeftDrawer(null)}>
      <div className={styles.wrap}>
        <p className={styles.hint}>
          Each apply lands as a “GM” node on the loom — delete the node to undo.
        </p>
        <DifficultySection gameId={gameId} />
        <GmReassess gameId={gameId} nodeId={nodeId} submit={submit} busy={busy} />
        <RegionSection world={world} submit={submit} busy={busy} />
        <PolitySection world={world} submit={submit} busy={busy} />
        <GmUnitSection world={world} submit={submit} busy={busy} />
        <GmMarkerSection world={world} submit={submit} busy={busy} />
        <GmRawSection submit={submit} busy={busy} />
        <GmPublish gameId={gameId} nodeId={nodeId} />
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

  const known = isKnownDifficulty(choice);
  const description = DIFFICULTIES.find((level) => level.id === choice)?.description;

  const apply = async () => {
    if (busy || !known) return;
    setBusy(true);
    try {
      const updated = await api.setDifficulty(gameId, { difficulty: choice });
      useSessionStore.getState().setMeta(updated);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Simulation strictness</h3>
      <label className={styles.selectRow}>
        <span>Level</span>
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          {DIFFICULTIES.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label}
            </option>
          ))}
          {known ? null : <option value={choice}>{choice} (unrecognized)</option>}
        </select>
      </label>
      <p className={styles.hint}>{description ?? `Saved as “${choice}” — pick a level to replace it.`}</p>
      <p className={styles.hint}>Takes effect from the next turn; past nodes keep the level they ran under.</p>
      <Button variant="primary" disabled={busy || !known || choice === stored} onClick={() => void apply()}>
        Apply strictness
      </Button>
    </section>
  );
}

const ALL_REGION_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ...COUNTRY_ENTRIES,
  ...REGION_ENTRIES,
];

/** Assign (or clear) ownership of any map region, searched by code or name. */
function RegionSection({ world, submit, busy }: GmSectionProps) {
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("");
  const [owner, setOwner] = useState("");

  const q = query.trim().toLowerCase();
  const suggestions =
    q.length >= 2 && !regionId
      ? ALL_REGION_ENTRIES.filter(
          ([id, name]) => id.toLowerCase().includes(q) || name.toLowerCase().includes(q),
        ).slice(0, 8)
      : [];

  const chosen = regionId || (q ? query.trim() : "");
  const currentOwner = chosen ? world.regionOwnership[chosen] : undefined;

  const apply = () =>
    void submit(
      { regionTransfers: [{ regionId: chosen, regionName: regionDisplayName(chosen), fromCode: currentOwner ?? "", toCode: owner || null, note: "GM edit" }] },
      owner ? `${regionDisplayName(chosen)} -> ${owner}` : `${regionDisplayName(chosen)} unowned`,
    );

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Region ownership</h3>
      <Field
        label="Region (code or name)"
        placeholder="USA, Normandie, FRA.11_1…"
        value={regionId || query}
        onChange={(event) => {
          setQuery(event.target.value);
          setRegionId("");
        }}
      />
      {suggestions.length > 0 ? (
        <div className={styles.suggestions}>
          {suggestions.map(([id, name]) => (
            <button key={id} className={styles.suggestion} onClick={() => setRegionId(id)}>
              {name} <span className={styles.code}>{id}</span>
            </button>
          ))}
        </div>
      ) : null}
      {chosen ? (
        <p className={styles.hint}>
          {regionDisplayName(chosen)} — currently {currentOwner ?? "unowned"}
        </p>
      ) : null}
      <label className={styles.selectRow}>
        <span>New owner</span>
        <select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">(unowned)</option>
          {Object.values(world.polities).map((polity) => (
            <option key={polity.code} value={polity.code}>
              {polity.name || polity.code}
            </option>
          ))}
        </select>
      </label>
      <Button variant="primary" disabled={busy || !chosen} onClick={apply}>
        Apply transfer
      </Button>
    </section>
  );
}

/** Edit an existing polity or register a new one (impacts: polityChanges). */
function PolitySection({ world, submit, busy }: GmSectionProps) {
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [tags, setTags] = useState("");
  const [reputation, setReputation] = useState("");
  const [note, setNote] = useState("");

  const targetCode = code === "__new__" ? newCode.trim().toUpperCase() : code;
  const valid = code === "__new__" ? /^[A-Z]{2,8}$/.test(targetCode) : Boolean(code);

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
    <section className={styles.section}>
      <h3 className={styles.heading}>Polity</h3>
      <label className={styles.selectRow}>
        <span>Target</span>
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
      {code === "__new__" ? (
        <Field label="Code (2-8 uppercase)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
      ) : null}
      <Field label="Name (empty = unchanged)" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Color hex (empty = unchanged)" placeholder="#FF812A" value={color} onChange={(e) => setColor(e.target.value)} />
      <Field label="Tags, comma-separated (empty = unchanged)" value={tags} onChange={(e) => setTags(e.target.value)} />
      <Field label="Reputation 0-100 (empty = unchanged)" type="number" value={reputation} onChange={(e) => setReputation(e.target.value)} />
      <Field label="Note (empty = unchanged)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button variant="primary" disabled={busy || !valid} onClick={apply}>
        Apply polity change
      </Button>
    </section>
  );
}
