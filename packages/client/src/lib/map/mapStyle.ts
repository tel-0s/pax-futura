import type { SkySpecification, StyleSpecification } from "maplibre-gl";
import type { Theme } from "@pax/domain";
import { alpha, mix } from "../../theme/color.ts";
import { patternName, type PatternKind } from "./patterns.ts";

export type Projection = "mercator" | "globe";

/**
 * The static half of the map: sea, sea pattern, graticule, projection and
 * (on the globe) atmosphere. The dynamic half — territory, borders, labels —
 * is declared as react-map-gl children over this base.
 */
export const buildBaseStyle = (theme: Theme): StyleSpecification => {
  const { map } = theme;
  const waterPattern =
    map.waterPattern === "none" ? null : patternName(`water-${map.waterPattern}` as PatternKind, theme);
  const dash = map.boundaryDash.length ? map.boundaryDash : null;

  return {
    version: 8,
    // Territory recolours (a turn landing, loom previews, time-lapse frames)
    // cross-fade instead of snapping.
    transition: { duration: 450, delay: 0 },
    sources: {
      graticule: { type: "geojson", data: graticule(), maxzoom: 6 },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": map.water },
      },
      // Depth: a soft lighter wash so open ocean isn't a flat slab.
      ...(waterPattern
        ? [
            {
              id: "water-pattern",
              type: "background" as const,
              paint: {
                "background-pattern": waterPattern,
                "background-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.9, 6, 0.55],
              },
            } as StyleSpecification["layers"][number],
          ]
        : []),
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: {
          "line-color": map.graticule,
          "line-width": ["case", ["==", ["get", "major"], true], 1.1, 0.6],
          "line-opacity": theme.meta.scheme === "dark" ? 0.9 : 0.55,
          ...(dash ? { "line-dasharray": [4, 3] } : {}),
        },
      },
    ],
  };
};

/** Globe atmosphere (react-map-gl owns `sky`/`projection` as props). */
export const buildSky = (theme: Theme, projection: Projection): SkySpecification | undefined => {
  const atmosphere = theme.map.atmosphere;
  if (projection !== "globe" || !atmosphere) return undefined;
  return {
    "sky-color": atmosphere.space,
    "horizon-color": atmosphere.horizon,
    "fog-color": atmosphere.space,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.9,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, atmosphere.glow, 5, atmosphere.glow * 0.6, 7, 0],
  } as SkySpecification;
};

/** Color for space around the globe (CSS background behind the canvas). */
export const spaceColor = (theme: Theme): string =>
  theme.map.atmosphere?.space ?? mix(theme.map.water, theme.color.surface[0], 0.5);

/** Soft vignette color: ink on paper, darkness on screens. */
export const vignetteColor = (theme: Theme): string =>
  theme.meta.scheme === "light"
    ? alpha(mix(theme.color.text.secondary, theme.map.water, 0.2), 0.55)
    : alpha(theme.color.surface[0], 0.9);

/** Lines every 10° (majors every 30°), densified so they curve on the globe. */
const graticule = () => {
  const features: Array<{
    type: "Feature";
    properties: { major: boolean };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }> = [];
  for (let lng = -180; lng <= 180; lng += 10) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lng, lat]);
    features.push({
      type: "Feature",
      properties: { major: lng % 30 === 0 },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    const coords: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    features.push({
      type: "Feature",
      properties: { major: lat === 0 || lat % 30 === 0 },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection" as const, features };
};
