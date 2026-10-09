import { useMemo } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Theme } from "@pax/domain";
import { ensurePmtilesProtocol, PMTILES_URLS } from "../../lib/pmtiles.ts";
import { setMapRef } from "../../lib/mapController.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { useWorldStore } from "../../stores/world.ts";
import { useUiStore } from "../../stores/ui.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { MapUnits } from "./MapUnits.tsx";

ensurePmtilesProtocol();

/**
 * The stage's map: pmtiles vector countries/regions painted from the world
 * snapshot through the theme's palette envelope. Country-level ownership
 * paints via GID_0; region overrides refine via GID_1 on top.
 */
export function MapStage() {
  const world = useWorldStore((state) => state.world);
  const themeId = useUiStore((state) => state.themeId);
  const setSelection = useUiStore((state) => state.setSelection);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));

  const palette = useMemo(
    () => (world ? buildPolityPalette(theme, world) : {}),
    [theme, world],
  );

  /**
   * GID_0 -> fill color: polities paint their own country code, and
   * country-level ownership entries (3-letter keys, e.g. a colonized "USA")
   * overlay that with the owner's color.
   */
  const countryFill = useMemo(() => {
    const colors: Record<string, string> = { ...palette };
    for (const [regionId, owner] of Object.entries(world?.regionOwnership ?? {})) {
      if (/^[A-Z]{3}$/.test(regionId)) colors[regionId] = palette[owner] ?? theme.map.land;
    }
    const entries = Object.entries(colors).flat();
    if (entries.length === 0) return theme.map.land;
    return ["match", ["get", "GID_0"], ...entries, theme.map.land] as unknown as string;
  }, [world, palette, theme.map.land]);

  /** GID_1 -> owner color for explicit region overrides. */
  const regionFill = useMemo(() => {
    if (!world) return null;
    const entries = Object.entries(world.regionOwnership).flatMap(([regionId, owner]) => [
      regionId,
      palette[owner] ?? theme.map.land,
    ]);
    if (entries.length === 0) return null;
    return ["match", ["get", "GID_1"], ...entries, "rgba(0,0,0,0)"] as unknown as string;
  }, [world, palette, theme.map.land]);

  const baseStyle = useMemo(
    () => buildBaseStyle(theme),
    [theme],
  );

  const onClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature) {
      setSelection({});
      return;
    }
    const gid1 = feature.properties?.GID_1 as string | undefined;
    const gid0 = feature.properties?.GID_0 as string | undefined;
    const owner = (gid1 && world?.regionOwnership[gid1]) || (gid0 && world?.regionOwnership[gid0]) || gid0;
    setSelection({
      ...(owner ? { polityCode: owner } : {}),
      ...(gid1 ? { regionId: gid1 } : {}),
    });
    if (owner) setLeftDrawer("inspector");
  };

  return (
    <Map
      ref={setMapRef}
      mapStyle={baseStyle}
      initialViewState={{ longitude: 8, latitude: 48, zoom: 3.4 }}
      interactiveLayerIds={["regions-fill", "countries-fill"]}
      onClick={onClick}
      attributionControl={false}
    >
      <Source id="countries" type="vector" url={PMTILES_URLS.countries} maxzoom={8}>
        <Layer
          id="countries-fill"
          type="fill"
          source-layer="countries"
          paint={{ "fill-color": countryFill, "fill-opacity": 0.85 }}
        />
        <Layer
          id="countries-outline"
          type="line"
          source-layer="countries"
          paint={{ "line-color": theme.map.boundary.line, "line-width": 1 }}
        />
      </Source>
      <Source id="regions" type="vector" url={PMTILES_URLS.regions} maxzoom={8}>
        {regionFill ? (
          <Layer
            id="regions-fill"
            type="fill"
            source-layer="regions"
            paint={{ "fill-color": regionFill, "fill-opacity": 0.9 }}
          />
        ) : null}
        <Layer
          id="regions-outline"
          type="line"
          source-layer="regions"
          minzoom={4}
          paint={{
            "line-color": theme.map.boundary.line,
            "line-width": 0.4,
            "line-opacity": 0.5,
          }}
        />
      </Source>
      <MapUnits world={world} palette={palette} />
    </Map>
  );
}

/** Minimal vector-only base style: water is the background. */
const buildBaseStyle = (theme: Theme) => ({
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: { "background-color": theme.map.water },
    },
  ],
});
