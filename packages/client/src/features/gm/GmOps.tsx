import { useState } from "react";
import { ImpactsSchema, UNIT_TYPES, type UnitType } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import type { GmSectionProps, GmSubmit } from "./GmDrawer.tsx";
import styles from "./gm.module.css";

/** Spawn or remove units directly (impacts: unitOps). */
export function GmUnitSection({ world, submit, busy }: GmSectionProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<UnitType>("infantry");
  const [owner, setOwner] = useState("");
  const [strength, setStrength] = useState("100");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");

  const coordsOk = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) && lng !== "" && lat !== "";

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
    <section className={styles.section}>
      <h3 className={styles.heading}>Units</h3>
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className={styles.row}>
        <label className={styles.selectRow}>
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as UnitType)}>
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectRow}>
          <span>Owner</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Select…</option>
            {Object.values(world.polities).map((p) => (
              <option key={p.code} value={p.code}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <Field label="Strength" type="number" value={strength} onChange={(e) => setStrength(e.target.value)} />
        <Field label="Lng" type="number" value={lng} onChange={(e) => setLng(e.target.value)} />
        <Field label="Lat" type="number" value={lat} onChange={(e) => setLat(e.target.value)} />
      </div>
      <Button variant="primary" disabled={busy || !owner || !coordsOk} onClick={spawn}>
        Spawn unit
      </Button>
      {world.units.length > 0 ? (
        <ul className={styles.list}>
          {world.units.map((unit) => (
            <li key={unit.id} className={styles.listItem}>
              <span>
                {unit.name} · {unit.ownerCode} · {unit.strength}
              </span>
              <button
                className={styles.iconButton}
                title="Remove unit"
                disabled={busy}
                onClick={() =>
                  void submit(
                    { unitOps: [{ op: "remove", unitId: unit.id, note: "GM removal" }] },
                    `remove ${unit.name}`,
                  )
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Build or remove map markers (impacts: markerOps). */
export function GmMarkerSection({ world, submit, busy }: GmSectionProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("landmark");
  const [owner, setOwner] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");

  const coordsOk = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) && lng !== "" && lat !== "";

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
    <section className={styles.section}>
      <h3 className={styles.heading}>Markers</h3>
      <div className={styles.row}>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} />
      </div>
      <div className={styles.row}>
        <label className={styles.selectRow}>
          <span>Owner</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">(none)</option>
            {Object.values(world.polities).map((p) => (
              <option key={p.code} value={p.code}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <Field label="Lng" type="number" value={lng} onChange={(e) => setLng(e.target.value)} />
        <Field label="Lat" type="number" value={lat} onChange={(e) => setLat(e.target.value)} />
      </div>
      <Button variant="primary" disabled={busy || !name.trim() || !coordsOk} onClick={build}>
        Build marker
      </Button>
      {world.markers.length > 0 ? (
        <ul className={styles.list}>
          {world.markers.map((marker) => (
            <li key={marker.id} className={styles.listItem}>
              <span>
                {marker.name} · {marker.kind}
              </span>
              <button
                className={styles.iconButton}
                title="Remove marker"
                disabled={busy}
                onClick={() =>
                  void submit(
                    { markerOps: [{ op: "remove", markerId: marker.id, name: marker.name, note: "GM removal" }] },
                    `remove ${marker.name}`,
                  )
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Escape hatch: paste any Impacts JSON and apply it verbatim. */
export function GmRawSection({ submit, busy }: { submit: GmSubmit; busy: boolean }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

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

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Raw impacts</h3>
      <TextAreaField
        label="Impacts JSON (regionTransfers, polityChanges, unitOps, markerOps…)"
        rows={5}
        placeholder='{"regionTransfers":[{"regionId":"USA","toCode":"FRA"}]}'
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      {error ? <p className={styles.error}>{error}</p> : null}
      <Button variant="primary" disabled={busy || !raw.trim()} onClick={apply}>
        Apply impacts
      </Button>
    </section>
  );
}
