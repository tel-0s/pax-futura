import { useMemo } from "react";
import { UNIT_STRENGTH_MAX, type Polity, type Unit } from "@pax/domain";
import { Drawer } from "../../components/Drawer.tsx";
import { flyTo } from "../../lib/mapController.ts";
import { UNIT_STATUS_TONE, unitGlyph } from "../../lib/unitDisplay.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import styles from "./forces.module.css";

/** Close enough to read the theatre, far enough to keep neighbours in frame. */
const UNIT_FOCUS_ZOOM = 5.5;

// CSS-module lookups are index signatures under noUncheckedIndexedAccess.
const TONE_CLASS: Record<"neutral" | "warning" | "danger", string | undefined> = {
  neutral: styles.toneNeutral,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

interface ForceGroup {
  code: string;
  polity: Polity | undefined;
  units: Unit[];
  strength: number;
}

/** Every tracked unit in the world, grouped by owner: the player's own order
 *  of battle first, then the powers fielding the most. */
export function ForcesDrawer() {
  const world = useWorldStore((state) => state.world);
  const playerPolity = useSessionStore((state) => state.meta?.playerPolity);
  const selectedCode = useUiStore((state) => state.selection.polityCode);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);

  const groups = useMemo(
    () => groupForces(world?.units ?? [], world?.polities ?? {}, playerPolity, selectedCode),
    [world, playerPolity, selectedCode],
  );
  const total = groups.reduce((sum, group) => sum + group.units.length, 0);

  return (
    <Drawer side="left" title="Forces" onClose={() => setLeftDrawer(null)}>
      {total === 0 ? (
        <p className={styles.empty}>
          No forces are tracked yet. Units appear here once the simulator fields them in a turn — or
          once you spawn them yourself from the GM drawer (✎).
        </p>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <GroupSection
              key={group.code}
              group={group}
              isPlayer={group.code === playerPolity}
              isSelected={group.code === selectedCode}
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}

function GroupSection({
  group,
  isPlayer,
  isSelected,
}: {
  group: ForceGroup;
  isPlayer: boolean;
  isSelected: boolean;
}) {
  const flag = group.polity?.flag ?? "";
  return (
    <section className={`${styles.group} ${isSelected ? styles.groupSelected : ""}`}>
      <header className={styles.groupHead}>
        {flag ? (
          flag.startsWith("data:") ? (
            <img src={flag} alt="" className={styles.flag} />
          ) : (
            <span aria-hidden="true">{flag}</span>
          )
        ) : null}
        <span className={styles.groupName}>{group.polity?.name || group.code}</span>
        {isPlayer ? <span className={styles.you}>you</span> : null}
        <span className={styles.groupStats}>
          {group.units.length} · {group.strength}
        </span>
      </header>
      <ul className={styles.units}>
        {group.units.map((unit) => (
          <UnitRow key={unit.id} unit={unit} />
        ))}
      </ul>
    </section>
  );
}

function UnitRow({ unit }: { unit: Unit }) {
  const toneClass = TONE_CLASS[UNIT_STATUS_TONE[unit.status]] ?? "";
  const share = Math.max(0, Math.min(1, unit.strength / UNIT_STRENGTH_MAX));
  return (
    <li>
      <button
        type="button"
        className={styles.unit}
        title={unit.note || `Center the map on ${unit.name}`}
        onClick={() => flyTo(unit.lng, unit.lat, UNIT_FOCUS_ZOOM)}
      >
        <span className={styles.glyph} aria-hidden="true">
          {unitGlyph(unit.type)}
        </span>
        <span className={styles.unitText}>
          <span className={styles.unitName}>{unit.name}</span>
          <span className={styles.unitMeta}>
            {unit.type} · {unit.status}
            {unit.regionId ? ` · ${unit.regionId}` : ""}
          </span>
        </span>
        <span className={styles.strength}>
          <span className={styles.strengthValue}>{unit.strength}</span>
          <span className={styles.bar}>
            <span
              className={`${styles.barFill} ${toneClass}`}
              style={{ width: `${share * 100}%` }}
            />
          </span>
        </span>
      </button>
    </li>
  );
}

/** Player first, then the current map selection, then most units first. */
function groupForces(
  units: Unit[],
  polities: Record<string, Polity>,
  playerPolity: string | undefined,
  selectedCode: string | undefined,
): ForceGroup[] {
  const byOwner = new Map<string, ForceGroup>();
  for (const unit of units) {
    let group = byOwner.get(unit.ownerCode);
    if (!group) {
      group = { code: unit.ownerCode, polity: polities[unit.ownerCode], units: [], strength: 0 };
      byOwner.set(unit.ownerCode, group);
    }
    group.units.push(unit);
    group.strength += unit.strength;
  }

  const rank = (group: ForceGroup): number => {
    if (group.code === playerPolity) return 0;
    if (group.code === selectedCode) return 1;
    return 2;
  };
  return [...byOwner.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.units.length - a.units.length ||
      (a.polity?.name || a.code).localeCompare(b.polity?.name || b.code),
  );
}
