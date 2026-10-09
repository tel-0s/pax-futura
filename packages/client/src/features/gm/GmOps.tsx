import { useMemo, useRef, useState } from "react";
import { Braces, Castle, Search, Swords, Trash, WandSparkles } from "lucide-react";
import { ImpactsSchema, UNIT_TYPES, type UnitType, type WorldState } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Field } from "../../components/Field.tsx";
import { structureIcon } from "../../components/StructureIcon.tsx";
import { UnitSymbol } from "../../components/UnitSymbol.tsx";
import type { GmSectionProps, GmSubmit } from "./GmDrawer.tsx";
import { GmSection, OwnerTag, usePolityPalette } from "./GmSection.tsx";
import styles from "./gm.module.css";

/** Rosters past this length get a filter box. */
const FILTER_AT = 8;

const matches = (needle: string, ...haystack: string[]): boolean =>
  !needle || haystack.some((value) => value.toLowerCase().includes(needle));

function OwnerSelect({
  world,
  value,
  onChange,
  emptyLabel,
}: {
  world: WorldState;
  value: string;
  onChange: (code: string) => void;
  emptyLabel: string;
}) {
  return (
    <label className={styles.selectField}>
      <span className={styles.fieldLabel}>Owner</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {Object.values(world.polities).map((p) => (
          <option key={p.code} value={p.code}>
            {p.name ? `${p.name} (${p.code})` : p.code}
          </option>
        ))}
      </select>
    </label>
  );
}

function RosterFilter({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className={`${styles.searchBox} ${styles.filterBox}`}>
      <Search size={13} className={styles.searchIcon} aria-hidden />
      <input
        className={styles.searchInput}
        placeholder={label}
        aria-label={label}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Spawn or remove units directly (impacts: unitOps). */
export function GmUnitSection({ world, submit, busy }: GmSectionProps) {
  const palette = usePolityPalette(world);
  const [name, setName] = useState("");
  const [type, setType] = useState<UnitType>("infantry");
  const [owner, setOwner] = useState("");
  const [strength, setStrength] = useState("100");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [filter, setFilter] = useState("");

  const coordsOk = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) && lng !== "" && lat !== "";
  const needle = filter.trim().toLowerCase();
  const roster = world.units.filter((unit) => matches(needle, unit.name, unit.ownerCode, unit.type));

  const spawn = () =>
    void submit(
      {
        unitOps: [
          {
            op: "spawn",
            unit: {
              name: name.trim() || "Unit",
              type,
              ownerCode: owner,
              strength: Math.max(0, Math.min(1000, Number(strength) || 100)),
              lng: Number(lng),
              lat: Number(lat),
              regionId: "",
              status: "idle",
              note: "GM spawn",
            },
          },
        ],
      },
      `spawn ${name.trim() || "unit"} (${owner})`,
    );

  return (
    <GmSection
      icon={Swords}
      title="Units"
      aside={<span className={styles.count}>{world.units.length}</span>}
      hint="Field a unit at exact coordinates, or strike one from the map."
    >
      <div className={styles.formCard}>
        <div className={styles.grid2}>
          <Field label="Name" placeholder="3rd Lancers" value={name} onChange={(e) => setName(e.target.value)} />
          <label className={styles.selectField}>
            <span className={styles.fieldLabel}>Type</span>
            <span className={styles.typeSelect}>
              <UnitSymbol type={type} color={owner ? palette[owner] : undefined} size={22} />
              <select value={type} onChange={(e) => setType(e.target.value as UnitType)}>
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <OwnerSelect world={world} value={owner} onChange={setOwner} emptyLabel="Select…" />
        <div className={styles.grid3}>
          <Field label="Strength" type="number" value={strength} onChange={(e) => setStrength(e.target.value)} />
          <Field label="Lng" type="number" placeholder="2.35" value={lng} onChange={(e) => setLng(e.target.value)} />
          <Field label="Lat" type="number" placeholder="48.85" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" disabled={busy || !owner || !coordsOk} onClick={spawn}>
            Spawn unit
          </Button>
        </div>
      </div>
      {world.units.length > 0 ? (
        <div className={styles.roster}>
          {world.units.length > FILTER_AT ? (
            <RosterFilter value={filter} onChange={setFilter} label="Filter units by name, owner, or type" />
          ) : null}
          <ul className={styles.list}>
            {roster.map((unit) => (
              <li key={unit.id} className={styles.listItem}>
                <UnitSymbol type={unit.type} color={palette[unit.ownerCode]} size={20} />
                <span className={styles.itemName} title={unit.name}>
                  {unit.name}
                </span>
                <OwnerTag code={unit.ownerCode} world={world} palette={palette} short />
                <span className={styles.itemFigure}>{unit.strength}</span>
                <button
                  className={styles.removeButton}
                  title="Remove unit (lands as a GM node)"
                  aria-label={`Remove ${unit.name}`}
                  disabled={busy}
                  onClick={() =>
                    void submit(
                      { unitOps: [{ op: "remove", unitId: unit.id, note: "GM removal" }] },
                      `remove ${unit.name}`,
                    )
                  }
                >
                  <Trash size={13} />
                </button>
              </li>
            ))}
            {roster.length === 0 ? <li className={styles.listEmpty}>No unit matches “{filter.trim()}”.</li> : null}
          </ul>
        </div>
      ) : null}
    </GmSection>
  );
}

/** Build or remove map markers (impacts: markerOps). */
export function GmMarkerSection({ world, submit, busy }: GmSectionProps) {
  const palette = usePolityPalette(world);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("landmark");
  const [owner, setOwner] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [filter, setFilter] = useState("");

  const coordsOk = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) && lng !== "" && lat !== "";
  const needle = filter.trim().toLowerCase();
  const roster = world.markers.filter((marker) => matches(needle, marker.name, marker.kind, marker.ownerCode));
  const KindIcon = structureIcon(kind.trim().toLowerCase() || "landmark");

  const build = () =>
    void submit(
      {
        markerOps: [
          {
            op: "build",
            marker: {
              name: name.trim(),
              kind: kind.trim().toLowerCase() || "landmark",
              ownerCode: owner,
              lng: Number(lng),
              lat: Number(lat),
              note: "GM build",
              foundedAt: "",
            },
          },
        ],
      },
      `build ${name.trim()}`,
    );

  return (
    <GmSection
      icon={Castle}
      title="Structures"
      aside={<span className={styles.count}>{world.markers.length}</span>}
      hint="Raise a named work — fort, port, embassy, anything — or raze one."
    >
      <div className={styles.formCard}>
        <div className={styles.grid2}>
          <Field label="Name" placeholder="Fort Sumter" value={name} onChange={(e) => setName(e.target.value)} />
          <div className={styles.kindField}>
            <Field label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} />
            <KindIcon size={15} className={styles.kindIcon} aria-hidden />
          </div>
        </div>
        <OwnerSelect world={world} value={owner} onChange={setOwner} emptyLabel="(none)" />
        <div className={styles.grid2}>
          <Field label="Lng" type="number" placeholder="2.35" value={lng} onChange={(e) => setLng(e.target.value)} />
          <Field label="Lat" type="number" placeholder="48.85" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" disabled={busy || !name.trim() || !coordsOk} onClick={build}>
            Build structure
          </Button>
        </div>
      </div>
      {world.markers.length > 0 ? (
        <div className={styles.roster}>
          {world.markers.length > FILTER_AT ? (
            <RosterFilter value={filter} onChange={setFilter} label="Filter structures by name, kind, or owner" />
          ) : null}
          <ul className={styles.list}>
            {roster.map((marker) => {
              const Icon = structureIcon(marker.kind);
              return (
                <li key={marker.id} className={styles.listItem}>
                  <span className={styles.itemGlyph}>
                    <Icon size={13} />
                  </span>
                  <span className={styles.itemName} title={marker.name}>
                    {marker.name}
                  </span>
                  <span className={styles.itemKind}>{marker.kind}</span>
                  {marker.ownerCode ? (
                    <OwnerTag code={marker.ownerCode} world={world} palette={palette} short />
                  ) : null}
                  <button
                    className={styles.removeButton}
                    title="Raze structure (lands as a GM node)"
                    aria-label={`Remove ${marker.name}`}
                    disabled={busy}
                    onClick={() =>
                      void submit(
                        { markerOps: [{ op: "remove", markerId: marker.id, name: marker.name, note: "GM removal" }] },
                        `remove ${marker.name}`,
                      )
                    }
                  >
                    <Trash size={13} />
                  </button>
                </li>
              );
            })}
            {roster.length === 0 ? <li className={styles.listEmpty}>No structure matches “{filter.trim()}”.</li> : null}
          </ul>
        </div>
      ) : null}
    </GmSection>
  );
}

const RAW_EXAMPLE = `{
  "regionTransfers": [
    { "regionId": "USA", "toCode": "FRA" }
  ]
}`;

/** Escape hatch: paste any Impacts JSON and apply it verbatim. */
export function GmRawSection({ submit, busy }: { submit: GmSubmit; busy: boolean }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const gutter = useRef<HTMLDivElement>(null);

  const lineCount = Math.max(raw.split("\n").length, 8);
  const syntax = useMemo((): "empty" | "valid" | "invalid" => {
    if (!raw.trim()) return "empty";
    try {
      JSON.parse(raw);
      return "valid";
    } catch {
      return "invalid";
    }
  }, [raw]);

  const apply = () => {
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("Not valid JSON.");
      return;
    }
    const result = ImpactsSchema.safeParse(parsed);
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    void submit(result.data, "raw impacts");
  };

  const format = () => {
    try {
      setRaw(JSON.stringify(JSON.parse(raw), null, 2));
      setError("");
    } catch {
      setError("Not valid JSON — nothing to format.");
    }
  };

  return (
    <GmSection
      icon={Braces}
      title="Raw impacts"
      aside={<Badge tone="warning">escape hatch</Badge>}
      hint={
        <>
          Paste any <code>Impacts</code> JSON — <code>regionTransfers</code>, <code>polityChanges</code>,{" "}
          <code>unitOps</code>, <code>markerOps</code>… It is schema-checked, then applied verbatim:
          no sanity checks run.
        </>
      }
    >
      <div className={`${styles.editor} ${syntax === "invalid" ? styles.editorInvalid : ""}`}>
        <div className={styles.editorBar}>
          <span className={styles.editorFile}>impacts.json</span>
          <span className={`${styles.syntax} ${syntax === "valid" ? styles.syntaxOk : syntax === "invalid" ? styles.syntaxBad : ""}`}>
            {syntax === "valid" ? "valid JSON" : syntax === "invalid" ? "syntax error" : "empty"}
          </span>
          <span className={styles.editorTools}>
            <Button variant="ghost" size="sm" disabled={syntax !== "valid"} onClick={format} title="Pretty-print">
              Format
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(raw.trim())}
              onClick={() => setRaw(RAW_EXAMPLE)}
              title="Insert a small example"
            >
              Example
            </Button>
          </span>
        </div>
        <div className={styles.editorBody}>
          <div ref={gutter} className={styles.gutter} aria-hidden>
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <textarea
            className={styles.code}
            rows={10}
            wrap="off"
            spellCheck={false}
            aria-label="Impacts JSON"
            placeholder='{"regionTransfers":[{"regionId":"USA","toCode":"FRA"}]}'
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError("");
            }}
            onScroll={(e) => {
              if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
            }}
          />
        </div>
      </div>
      {error ? (
        <ul className={styles.issues}>
          {error.split("; ").map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.actions}>
        <Button variant="danger" disabled={busy || !raw.trim()} onClick={apply}>
          <WandSparkles size={14} /> Apply impacts
        </Button>
      </div>
    </GmSection>
  );
}
