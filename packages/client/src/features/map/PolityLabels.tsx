import { useEffect, useState, type RefObject } from "react";
import { Marker, type MapRef } from "react-map-gl/maplibre";
import type { Theme, WorldState } from "@pax/domain";
import { computeLabels, type PlacedLabel } from "../../lib/map/labels.ts";
import { useUiStore } from "../../stores/ui.ts";
import { occlusion } from "../../lib/mapController.ts";
import type { Ownership } from "../../lib/map/ownership.ts";
import styles from "./MapStage.module.css";

/**
 * Polity names set in the theme's label face (Barlow caps on the deck, Fell
 * small caps on parchment, VT323 on the big board) — DOM, not symbol layers,
 * because the minimal base style has no glyph server and because the theme's
 * own typography is the point. Placement recomputes when the map settles.
 */
export function PolityLabels({
  mapRef,
  world,
  ownership,
  theme,
  playerCode,
  selected,
  ready,
}: {
  ready: boolean;
  mapRef: RefObject<MapRef | null>;
  world: WorldState | null;
  ownership: Ownership;
  theme: Theme;
  playerCode: string | null;
  selected: string | null;
}) {
  const [labels, setLabels] = useState<PlacedLabel[]>([]);
  const conversationsOpen = useUiStore((state) => state.conversationsOpen);
  const leftDrawerOpen = useUiStore((state) => state.leftDrawer !== null);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !world) {
      setLabels([]);
      return;
    }
    const label = theme.map.label;
    const font = {
      family: label.font || theme.font.display,
      weight: theme.style.heading.weight,
      tracking: parseFloat(label.tracking) || 0,
      uppercase: label.case === "uppercase",
      scale: label.scale,
    };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (cancelled) return;
      try {
        // Measure the chrome actually floating over the map (top bar, dock,
        // rail, drawers) — the same occluders the camera steers around.
        const pad = occlusion();
        setLabels(
          computeLabels(map, world, ownership, playerCode, font, {
            top: pad.top + 8,
            bottom: pad.bottom + 8,
            left: pad.left + 8,
            right: pad.right + 8,
          }),
        );
      } catch (error) {
        console.warn("label placement failed:", error);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 80);
    };
    // `idle` alone races mount: if tiles finished before this effect
    // attached, it has already fired. Tile arrivals for our sources (and
    // camera settles) re-run placement too — debounced, so a burst of tiles
    // costs one pass.
    const onSourceData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if ((event.sourceId === "countries" || event.sourceId === "regions") && event.isSourceLoaded) schedule();
    };
    map.on("idle", schedule);
    map.on("moveend", schedule);
    map.on("sourcedata", onSourceData);
    // Measure with the real face, once it has actually loaded.
    void document.fonts.load(`${font.weight} 16px ${font.family}`).catch(() => {}).finally(schedule);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off("idle", schedule);
      map.off("moveend", schedule);
      map.off("sourcedata", onSourceData);
    };
  }, [mapRef, ready, world, ownership, theme, playerCode, conversationsOpen, leftDrawerOpen]);

  return (
    <>
      {labels.map((label) => (
        <Marker
          key={label.key}
          longitude={label.lng}
          latitude={label.lat}
          anchor="center"
          style={{ pointerEvents: "none" }}
        >
          <div
            className={[
              styles.label,
              label.isPlayer ? styles.labelPlayer : "",
              label.code === selected ? styles.labelSelected : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ fontSize: `${label.size}px` }}
          >
            {label.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </Marker>
      ))}
    </>
  );
}
