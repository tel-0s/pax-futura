import { useMemo, useState } from "react";
import { MapPin, Swords } from "lucide-react";
import {
  UNIT_STRENGTH_MAX,
  regionDisplayName,
  type Marker,
  type Polity,
  type Unit,
} from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { structureIcon } from "../../components/StructureIcon.tsx";
import { UnitSymbol } from "../../components/UnitSymbol.tsx";
import { flyTo } from "../../lib/mapController.ts";
import { UNIT_STATUS_TONE } from "../../lib/unitDisplay.ts";
import { useSessionStore } from "../../stores/session.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import styles from "./forces.module.css";

/** Close enough to read the theatre, far enough to keep neighbours in frame. */
const UNIT_FOCUS_ZOOM = 5.5;
/** Structures are points, not formations — come in a little closer. */
const STRUCTURE_FOCUS_ZOOM = 6.5;

// CSS-module lookups are index signatures under noUncheckedIndexedAccess.
const TONE_CLASS: Record<"neutral" | "warning" | "danger", string | undefined> = {
  neutral: styles.toneNeutral,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

const BADGE_TONE = { neutral: "default", warning: "warning", danger: "danger" } as const;

/** Order-of-battle arms: land formations, then the fleets, then the air. */
const BRANCHES: ReadonlyArray<{ id: string; label: string; types: ReadonlyArray<Unit["type"]> }> = [
  { id: "land", label: "Land", types: ["infantry", "armor", "artillery", "garrison"] },
  { id: "sea", label: "Sea", types: ["naval"] },
  { id: "air", label: "Air", types: ["air"] },
];

interface ForceGroup {
  code: string;
  polity: Polity | undefined;
  units: Unit[];
  structures: Marker[];
  strength: number;
}

const formatNumber = (value: number): string => value.toLocaleString("en-US");

/** Every tracked unit and structure in the world, grouped by owner: the
 *  player's own order of battle first, then the powers fielding the most. */
export function ForcesDrawer() {
  const world = useWorldStore((state) => state.world);
  const playerPolity = useSessionStore((state) => state.meta?.playerPolity);
  const selectedCode = useUiStore((state) => state.selection.polityCode);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));

  const palette = useMemo(() => (world ? buildPolityPalette(theme, world) : {}), [theme, world]);
  const groups = useMemo(
    () =>
      groupForces(world?.units ?? [], world?.markers ?? [], world?.polities ?? {}, playerPolity, selectedCode),
    [world, playerPolity, selectedCode],
  );
  const units = world?.units ?? [];
  const structureCount = world?.markers.length ?? 0;
  const strength = units.reduce((sum, unit) => sum + unit.strength, 0);
  const engaged = units.filter((unit) => unit.status === "engaged").length;

  return (
    <Drawer
      side="left"
      wide
      title="Forces"
      kicker="Order of battle"
      icon={<Swords size={16} />}
      onClose={() => setLeftDrawer(null)}
    >
      {units.length === 0 && structureCount === 0 ? (
        <div className={styles.empty}>
          <Swords size={24} aria-hidden />
          <p>
            No forces are tracked yet. Units appear here once the simulator fields them in a turn — or
            once you spawn them yourself from the Game master panel (G).
          </p>
        </div>
      ) : (
        <>
          <dl className={styles.summary}>
            <Stat label="Units" value={formatNumber(units.length)} />
            <Stat label="Strength" value={formatNumber(strength)} />
            <Stat label="Engaged" value={formatNumber(engaged)} alert={engaged > 0} />
            <Stat label="Structures" value={formatNumber(structureCount)} />
          </dl>
          <div className={styles.groups}>
            {groups.map((group) => (
              <GroupSection
                key={group.code || "unaffiliated"}
                group={group}
                color={palette[group.code]}
                isPlayer={group.code === playerPolity}
                isSelected={group.code === selectedCode}
              />
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`${styles.stat} ${alert ? styles.statAlert : ""}`}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

function GroupSection({
  group,
  color,
  isPlayer,
  isSelected,
}: {
  group: ForceGroup;
  color: string | undefined;
  isPlayer: boolean;
  isSelected: boolean;
}) {
  const name = group.polity?.name || group.code || "Unaffiliated";
  const branches = BRANCHES.map((branch) => ({
    ...branch,
    units: group.units
      .filter((unit) => branch.types.includes(unit.type))
      .sort((a, b) => b.strength - a.strength),
  })).filter((branch) => branch.units.length > 0);

  return (
    <section
      className={[styles.group, isSelected ? styles.groupSelected : "", isPlayer ? styles.groupPlayer : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <header className={styles.groupHead}>
        {/* No palette color (unowned sites): the shield falls back to muted ink. */}
        <span className={styles.flagSlot}>
          <PolityFlag flag={group.polity?.flag} color={color} size={22} />
        </span>
        <div className={styles.groupTitle}>
          <span className={styles.groupName}>{name}</span>
          <span className={styles.groupMeta}>
            {[
              group.units.length > 0 ? `${group.units.length} unit${group.units.length === 1 ? "" : "s"}` : "",
              group.structures.length > 0
                ? `${group.structures.length} structure${group.structures.length === 1 ? "" : "s"}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {isPlayer ? <Badge tone="accent">you</Badge> : null}
        {group.units.length > 0 ? (
          <span className={styles.groupStrength} title="Total strength">
            {formatNumber(group.strength)}
          </span>
        ) : null}
      </header>

      {branches.map((branch) => (
        <div key={branch.id} className={styles.branch}>
          <div className={styles.branchHead}>
            <span className="pfKicker">{branch.label}</span>
            <span className={styles.branchRule} />
            <span className={styles.branchStats}>
              {branch.units.length} · {formatNumber(branch.units.reduce((sum, unit) => sum + unit.strength, 0))}
            </span>
          </div>
          <ul className={styles.units}>
            {branch.units.map((unit) => (
              <UnitRow key={unit.id} unit={unit} color={color} />
            ))}
          </ul>
        </div>
      ))}

      {group.structures.length > 0 ? <Structures structures={group.structures} /> : null}
    </section>
  );
}

function UnitRow({ unit, color }: { unit: Unit; color: string | undefined }) {
  const tone = UNIT_STATUS_TONE[unit.status];
  const toneClass = TONE_CLASS[tone] ?? "";
  const share = Math.max(0, Math.min(1, unit.strength / UNIT_STRENGTH_MAX));
  return (
    <li>
      <button
        type="button"
        className={`${styles.unit} ${unit.status === "defeated" ? styles.unitDefeated : ""}`}
        title={unit.note || `Center the map on ${unit.name}`}
        onClick={() => flyTo(unit.lng, unit.lat, UNIT_FOCUS_ZOOM)}
      >
        <span className={styles.symbol}>
          <UnitSymbol type={unit.type} color={color} size={26} />
        </span>
        <span className={styles.unitText}>
          <span className={styles.unitName}>{unit.name}</span>
          <span className={styles.unitMeta}>
            <span className={styles.unitType}>{unit.type}</span>
            {unit.regionId ? (
              <>
                <MapPin size={10} aria-hidden className={styles.metaPin} />
                <span className={styles.unitRegion}>{regionDisplayName(unit.regionId)}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className={styles.unitSide}>
          <span className={styles.unitTop}>
            {unit.status === "idle" ? (
              <span className={styles.idle}>idle</span>
            ) : (
              <Badge tone={BADGE_TONE[tone]}>{unit.status}</Badge>
            )}
            <span className={styles.strengthValue}>{formatNumber(unit.strength)}</span>
          </span>
          {/* Strength bar: track is full width, fill is strength / UNIT_STRENGTH_MAX. */}
          <span className={styles.bar}>
            <span className={`${styles.barFill} ${toneClass}`} style={{ width: `${share * 100}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Structures fold into a kind tally (a power can hold a hundred landmarks);
 * picking a kind lists its sites, and a site click flies the map there.
 */
function Structures({ structures }: { structures: Marker[] }) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  const kinds = useMemo(() => {
    const byKind = new Map<string, Marker[]>();
    for (const marker of structures) {
      const list = byKind.get(marker.kind) ?? [];
      list.push(marker);
      byKind.set(marker.kind, list);
    }
    return [...byKind.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [structures]);
  const openList = kinds.find(([kind]) => kind === openKind)?.[1] ?? [];

  return (
    <div className={styles.structures}>
      <div className={styles.branchHead}>
        <span className="pfKicker">Structures</span>
        <span className={styles.branchRule} />
        <span className={styles.branchStats}>{structures.length}</span>
      </div>
      <div className={styles.kinds} role="group" aria-label="Structure kinds">
        {kinds.map(([kind, list]) => {
          const Icon = structureIcon(kind);
          const active = kind === openKind;
          return (
            <button
              key={kind}
              type="button"
              className={`${styles.kind} ${active ? styles.kindActive : ""} pfChamfer`}
              aria-pressed={active}
              title={active ? "Hide this list" : `List every ${kind.replaceAll("_", " ")}`}
              onClick={() => setOpenKind(active ? null : kind)}
            >
              <Icon size={13} aria-hidden />
              <span className={styles.kindLabel}>{kind.replaceAll("_", " ")}</span>
              <span className={styles.kindCount}>{list.length}</span>
            </button>
          );
        })}
      </div>
      {openList.length > 0 ? (
        <ul className={styles.sites}>
          {openList.map((marker) => {
            const Icon = structureIcon(marker.kind);
            return (
              <li key={marker.id}>
                <button
                  type="button"
                  className={styles.site}
                  title={marker.note || `Center the map on ${marker.name}`}
                  onClick={() => flyTo(marker.lng, marker.lat, STRUCTURE_FOCUS_ZOOM)}
                >
                  <Icon size={12} aria-hidden className={styles.siteIcon} />
                  <span className={styles.siteName}>{marker.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Player first, then the current map selection, then most units first. */
function groupForces(
  units: Unit[],
  markers: Marker[],
  polities: Record<string, Polity>,
  playerPolity: string | undefined,
  selectedCode: string | undefined,
): ForceGroup[] {
  const byOwner = new Map<string, ForceGroup>();
  const groupFor = (code: string): ForceGroup => {
    let group = byOwner.get(code);
    if (!group) {
      group = { code, polity: polities[code], units: [], structures: [], strength: 0 };
      byOwner.set(code, group);
    }
    return group;
  };
  for (const unit of units) {
    const group = groupFor(unit.ownerCode);
    group.units.push(unit);
    group.strength += unit.strength;
  }
  for (const marker of markers) groupFor(marker.ownerCode).structures.push(marker);

  const rank = (group: ForceGroup): number => {
    if (group.code === playerPolity) return 0;
    if (group.code === selectedCode) return 1;
    // Unowned structures trail every named power.
    return group.code ? 2 : 3;
  };
  return [...byOwner.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.units.length - a.units.length ||
      b.structures.length - a.structures.length ||
      (a.polity?.name || a.code).localeCompare(b.polity?.name || b.code),
  );
}
