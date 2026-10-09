import { useMemo } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { WorldState } from "@pax/domain";
import { UnitSymbol } from "../../components/UnitSymbol.tsx";
import { structureIcon } from "../../components/StructureIcon.tsx";
import { useUiStore } from "../../stores/ui.ts";
import type { ZoomTier } from "./MapStage.tsx";
import styles from "./MapUnits.module.css";

interface Props {
  world: WorldState | null;
  palette: Record<string, string>;
  /** Detail level: far = compact counters + structure dots. */
  tier: ZoomTier;
}

/**
 * Units and structures as DOM markers: the base style ships no glyphs or
 * sprites, so symbol layers are unavailable — counts are small enough that
 * one element per entity is cheap. Units are NATO-style counters in their
 * owner's color; structures are small seals with a kind icon.
 */
export function MapUnits({ world, palette, tier }: Props) {
  const setSelection = useUiStore((state) => state.setSelection);
  const openLeftDrawer = useUiStore((state) => state.openLeftDrawer);

  const units = useMemo(() => {
    if (!world) return null;
    return world.units.map((unit) => {
      const classes = [
        styles.unit,
        tier === "far" ? styles.compact : "",
        unit.status === "engaged" ? styles.engaged : "",
        unit.status === "moving" ? styles.moving : "",
        unit.status === "pending" ? styles.pending : "",
        unit.status === "defeated" ? styles.defeated : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <Marker
          key={unit.id}
          longitude={unit.lng}
          latitude={unit.lat}
          anchor="center"
          // Click must be handled here with the ORIGINAL event stopped: the
          // map's own native click listener (country select -> inspector)
          // fires before React's delegated handler ever sees a button click,
          // and would immediately override the Forces drawer.
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            setSelection({ polityCode: unit.ownerCode });
            openLeftDrawer("forces");
          }}
        >
          <button
            type="button"
            className={classes}
            title={`${unit.name} (${unit.type}, ${unit.ownerCode}) — strength ${unit.strength}, ${unit.status}`}
          >
            <UnitSymbol type={unit.type} color={palette[unit.ownerCode]} size={22} />
            <span className={styles.strength}>{formatStrength(unit.strength)}</span>
          </button>
        </Marker>
      );
    });
  }, [world, palette, tier, setSelection, openLeftDrawer]);

  const structures = useMemo(() => {
    if (!world) return null;
    return world.markers.map((marker) => {
      const Icon = structureIcon(marker.kind);
      return (
        <Marker key={marker.id} longitude={marker.lng} latitude={marker.lat} anchor="center">
          <span
            className={`${styles.structure} ${styles[tier]}`}
            style={marker.ownerCode && palette[marker.ownerCode] ? { color: palette[marker.ownerCode] } : undefined}
            title={`${marker.name} (${marker.kind}${marker.ownerCode ? `, ${marker.ownerCode}` : ""})`}
          >
            <span className={styles.structureInner}>
              <Icon size={11} strokeWidth={2.2} />
            </span>
          </span>
        </Marker>
      );
    });
  }, [world, palette, tier]);

  return (
    <>
      {structures}
      {units}
    </>
  );
}

const formatStrength = (value: number): string => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value));
