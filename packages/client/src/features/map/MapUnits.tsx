import { useMemo } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { WorldState } from "@pax/domain";
import { UNIT_STATUS_TONE, unitGlyph } from "../../lib/unitDisplay.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./MapUnits.module.css";

/** Structure glyphs for the kinds scenarios use most; anything else falls back. */
const STRUCTURE_GLYPHS: Record<string, string> = {
  base: "⛫",
  port: "⚓",
  embassy: "🏛",
  silo: "🚀",
};

const structureGlyph = (kind: string): string => STRUCTURE_GLYPHS[kind] ?? "▲";

interface Props {
  world: WorldState | null;
  palette: Record<string, string>;
}

/**
 * Units and structures as DOM markers: the base style ships no glyphs or
 * sprites, so symbol layers are unavailable — counts are small enough that
 * one element per entity is cheap.
 */
export function MapUnits({ world, palette }: Props) {
  const setSelection = useUiStore((state) => state.setSelection);
  const openLeftDrawer = useUiStore((state) => state.openLeftDrawer);

  const units = useMemo(() => {
    if (!world) return null;
    return world.units.map((unit) => {
      const tone = UNIT_STATUS_TONE[unit.status];
      const classes = [
        styles.unit,
        tone === "danger" ? styles.danger : tone === "warning" ? styles.warning : "",
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
            style={{ borderColor: palette[unit.ownerCode] }}
            title={`${unit.name} (${unit.type}, ${unit.ownerCode}) — strength ${unit.strength}, ${unit.status}`}
          >
            <span className={styles.glyph}>{unitGlyph(unit.type)}</span>
            <span className={styles.strength}>{unit.strength}</span>
          </button>
        </Marker>
      );
    });
  }, [world, palette, setSelection, openLeftDrawer]);

  const structures = useMemo(() => {
    if (!world) return null;
    return world.markers.map((marker) => (
      <Marker key={marker.id} longitude={marker.lng} latitude={marker.lat} anchor="center">
        <span
          className={styles.structure}
          title={`${marker.name} (${marker.kind}${marker.ownerCode ? `, ${marker.ownerCode}` : ""})`}
        >
          {structureGlyph(marker.kind)}
        </span>
      </Marker>
    ));
  }, [world]);

  return (
    <>
      {structures}
      {units}
    </>
  );
}
