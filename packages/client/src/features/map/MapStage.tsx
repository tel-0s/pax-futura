import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Theme } from "@pax/domain";
import { ensurePmtilesProtocol, PMTILES_URLS } from "../../lib/pmtiles.ts";
import { setMapRef } from "../../lib/mapController.ts";
import { buildBaseStyle, buildSky, spaceColor, vignetteColor } from "../../lib/map/mapStyle.ts";
import { installPatternProvider, patternName } from "../../lib/map/patterns.ts";
import { buildOwnership, inFilter, matchExpression, ownerAt, type Ownership } from "../../lib/map/ownership.ts";
import { bandColor, buildPolityPalette, territoryColor } from "../../theme/palette.ts";
import { useWorldStore } from "../../stores/world.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useSessionStore } from "../../stores/session.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { MapUnits } from "./MapUnits.tsx";
import { PolityLabels } from "./PolityLabels.tsx";
import { HoverCard, type HoverInfo } from "./HoverCard.tsx";
import { MapOrnaments } from "./MapOrnaments.tsx";
import { EventPing } from "./EventPing.tsx";
import styles from "./MapStage.module.css";

ensurePmtilesProtocol();

// regions-hit (invisible, every province from z3.6) sits on top so clicks and
// hovers know the province everywhere, not only where one changed hands.
const INTERACTIVE = ["regions-hit", "regions-fill", "countries-fill"];

export type ZoomTier = "far" | "mid" | "near";
const hidden = { visibility: "none" } as const;
const shown = { visibility: "visible" } as const;

/**
 * The stage's map, drawn like an atlas plate: sea (pattern + graticule),
 * coast treatment, precomposited territory fills, region overrides, texture,
 * disputed hatching, inked borders and owner bands, then hover/selection and
 * the DOM layer (labels, forces, pings, ornaments). Every color and choice
 * comes from the theme; ownership comes from one inverted structure.
 */
export function MapStage() {
  const world = useWorldStore((state) => state.world);
  const themeId = useUiStore((state) => state.themeId);
  const projectionPref = useUiStore((state) => state.mapProjection);
  const selection = useUiStore((state) => state.selection);
  const setSelection = useUiStore((state) => state.setSelection);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const playerCode = useSessionStore((state) => state.meta?.playerPolity ?? null);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  const projection = projectionPref === "theme" ? theme.map.projection : projectionPref;

  const mapRef = useRef<MapRef | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [tier, setTier] = useState<ZoomTier>("mid");
  const hoverKey = useRef("");
  const hoverPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const palette = useMemo(() => (world ? buildPolityPalette(theme, world) : {}), [theme, world]);
  const ownership = useMemo(() => buildOwnership(world), [world]);
  const changes = useOwnershipChanges(ownership);
  const paint = useMemo(() => buildTerritoryPaint(theme, palette, ownership), [theme, palette, ownership]);
  const baseStyle = useMemo(() => buildBaseStyle(theme), [theme]);
  const sky = useMemo(() => buildSky(theme, projection), [theme, projection]);

  // Detail tier for DOM markers; state only changes when a threshold is crossed.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const update = () => {
      const zoom = map.getZoom();
      setTier(zoom < 3.9 ? "far" : zoom < 5.4 ? "mid" : "near");
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
    };
  }, [ready]);

  const attachRef = useCallback((ref: MapRef | null) => {
    mapRef.current = ref;
    setMapRef(ref);
    const map = ref?.getMap();
    if (map) installPatternProvider(map, () => themeRef.current);
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) installPatternProvider(map, () => themeRef.current);
    setReady(true);
  }, []);

  const onMouseMove = (event: MapLayerMouseEvent) => {
    hoverPoint.current = { x: event.point.x, y: event.point.y };
    const props = event.features?.[0]?.properties as { GID_0?: string; GID_1?: string } | undefined;
    const owner = ownerAt(ownership, props);
    const key = props ? `${owner ?? ""}|${props.GID_0 ?? ""}|${props.GID_1 ?? ""}` : "";
    if (key === hoverKey.current) return;
    hoverKey.current = key;
    setHover(props ? { owner, gid0: props.GID_0 ?? null, gid1: props.GID_1 ?? null } : null);
  };

  const onMouseLeave = () => {
    hoverKey.current = "";
    setHover(null);
  };

  const onClick = (event: MapLayerMouseEvent) => {
    const props = event.features?.[0]?.properties as { GID_0?: string; GID_1?: string } | undefined;
    if (!props) {
      setSelection({});
      return;
    }
    const owner = ownerAt(ownership, props) ?? props.GID_0;
    setSelection({
      ...(owner ? { polityCode: owner } : {}),
      ...(props.GID_1 ? { regionId: props.GID_1 } : {}),
    });
    if (owner) useUiStore.getState().openLeftDrawer("inspector");
    else setLeftDrawer(null);
  };

  // Hover + selection resolve to owner territory: every country and region
  // override the owner paints (or the bare country, for terra incognita).
  const hoverCountries = hover?.owner ? (ownership.countriesOf[hover.owner] ?? []) : hover?.gid0 ? [hover.gid0] : [];
  const hoverRegions = hover?.owner ? (ownership.regionsOf[hover.owner] ?? []) : [];
  const selected = selection.polityCode;
  const selectedCountries = selected ? (ownership.countriesOf[selected] ?? []) : [];
  const selectedRegions = selected ? (ownership.regionsOf[selected] ?? []) : [];
  const playerCountries = playerCode ? (ownership.countriesOf[playerCode] ?? []) : [];
  const playerRegions = playerCode ? (ownership.regionsOf[playerCode] ?? []) : [];

  const { map } = theme;
  const coast = map.coast;
  const coastColor = coast.color || map.boundary.line;
  const dark = theme.meta.scheme === "dark";
  const dash = map.boundaryDash.length ? map.boundaryDash : undefined;
  const textureName =
    map.landTexture === "none" ? null : patternName(`land-${map.landTexture}` as "land-paper", theme);

  return (
    <div
      className={styles.stage}
      style={{ background: spaceColor(theme) }}
      data-projection={projection}
    >
      <Map
        ref={attachRef}
        mapStyle={baseStyle}
        projection={{ type: projection }}
        {...(sky ? { sky } : {})}
        initialViewState={{ longitude: 12, latitude: 42, zoom: 3.2 }}
        minZoom={1.2}
        maxZoom={9}
        interactiveLayerIds={INTERACTIVE}
        onLoad={onLoad}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        cursor={hover?.owner ? "pointer" : "default"}
        attributionControl={false}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
      >
        <Source id="countries" type="vector" url={PMTILES_URLS.countries} maxzoom={8} />
        <Source id="regions" type="vector" url={PMTILES_URLS.regions} maxzoom={8} />

        {/* ── Coast treatment (beneath the opaque land) ─────────────── */}
        <Layer
          id="coast-shadow"
          type="line"
          source="countries"
          source-layer="countries"
          layout={coast.style === "shadow" ? shown : hidden}
          paint={{
            "line-color": coastColor,
            "line-width": coast.width,
            "line-blur": coast.width,
            "line-opacity": coast.opacity,
            "line-translate": [0, Math.max(1, coast.width * 0.3)],
          }}
        />
        <Layer
          id="coast-glow-wide"
          type="line"
          source="countries"
          source-layer="countries"
          layout={coast.style === "glow" ? shown : hidden}
          paint={{
            "line-color": coastColor,
            "line-width": coast.width * 2.4,
            "line-blur": coast.width * 1.8,
            "line-opacity": coast.opacity * 0.5,
          }}
        />
        <Layer
          id="coast-glow-tight"
          type="line"
          source="countries"
          source-layer="countries"
          layout={coast.style === "glow" ? shown : hidden}
          paint={{
            "line-color": coastColor,
            "line-width": Math.max(2, coast.width * 0.7),
            "line-blur": Math.max(1, coast.width * 0.45),
            "line-opacity": coast.opacity,
          }}
        />
        {[1, 2, 3, 4].map((ring) => (
          <Layer
            key={ring}
            id={`coast-ripple-${ring}`}
            type="line"
            source="countries"
            source-layer="countries"
            layout={coast.style === "ripples" ? shown : hidden}
            paint={{
              "line-color": coastColor,
              "line-width": ring === 1 ? 0.9 : 0.6,
              "line-gap-width": ring * coast.width * 1.5,
              "line-opacity": coast.opacity * (1.05 - ring * 0.22),
            }}
          />
        ))}

        {/* ── Territory ─────────────────────────────────────────────── */}
        <Layer
          id="countries-fill"
          type="fill"
          source="countries"
          source-layer="countries"
          paint={{ "fill-color": paint.countryFill as string, "fill-antialias": true }}
        />
        <Layer
          id="regions-fill"
          type="fill"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", Object.keys(ownership.regionOwner)) as never}
          paint={{ "fill-color": paint.regionFill as string }}
        />
        <Layer
          id="land-texture"
          type="fill"
          source="countries"
          source-layer="countries"
          layout={textureName ? shown : hidden}
          paint={{
            ...(textureName ? { "fill-pattern": textureName } : {}),
            "fill-opacity": map.textureStrength,
            "fill-antialias": false,
          }}
        />
        <Layer
          id="disputed-countries"
          type="fill"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", ownership.claimedCountries) as never}
          paint={{ "fill-pattern": patternName("disputed", theme), "fill-opacity": 0.55 }}
        />
        <Layer
          id="disputed-regions"
          type="fill"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", ownership.claimedRegions) as never}
          paint={{ "fill-pattern": patternName("disputed", theme), "fill-opacity": 0.55 }}
        />

        {/* ── Ink: region lines, borders, owner bands ───────────────── */}
        <Layer
          id="regions-outline"
          type="line"
          source="regions"
          source-layer="regions"
          minzoom={3.6}
          paint={{
            "line-color": map.boundary.line,
            "line-width": ["interpolate", ["linear"], ["zoom"], 3.6, 0.3, 7, 0.8],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.6, 0, 4.4, dark ? 0.35 : 0.45],
            "line-dasharray": [2, 2],
          }}
        />
        <Layer
          id="country-bands"
          type="line"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", Object.keys(ownership.countryOwner)) as never}
          layout={map.borderBand > 0 ? { ...shown, "line-join": "round" } : hidden}
          paint={{
            "line-color": paint.countryBand as string,
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, map.borderBand * 0.6, 6, map.borderBand * 1.6],
            "line-offset": ["interpolate", ["linear"], ["zoom"], 2, map.borderBand * 0.3, 6, map.borderBand * 0.8],
            "line-opacity": dark ? 0.55 : 0.5,
            "line-blur": dark ? 1 : 0.6,
          }}
        />
        <Layer
          id="region-bands"
          type="line"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", Object.keys(ownership.regionOwner)) as never}
          layout={map.borderBand > 0 ? { ...shown, "line-join": "round" } : hidden}
          paint={{
            "line-color": paint.regionBand as string,
            "line-width": map.borderBand * 0.8,
            "line-offset": map.borderBand * 0.4,
            "line-opacity": dark ? 0.5 : 0.45,
          }}
        />
        <Layer
          id="countries-outline"
          type="line"
          source="countries"
          source-layer="countries"
          layout={{ "line-join": "round" }}
          paint={{
            "line-color": map.boundary.line,
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 4, 1, 8, 1.8],
            "line-opacity": dark ? 0.9 : 0.85,
            ...(dash ? { "line-dasharray": dash } : {}),
          }}
        />

        {/* ── The player's realm: a quiet accent rim ─────────────────── */}
        <Layer
          id="player-rim-countries"
          type="line"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", playerCountries) as never}
          paint={{
            "line-color": theme.color.accent.base,
            "line-width": dark ? 3 : 1.6,
            "line-blur": dark ? 3 : 0.4,
            "line-opacity": dark ? 0.55 : 0.6,
            "line-offset": dark ? 1.5 : 0.8,
          }}
        />
        <Layer
          id="player-rim-regions"
          type="line"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", playerRegions) as never}
          paint={{
            "line-color": theme.color.accent.base,
            "line-width": dark ? 3 : 1.6,
            "line-blur": dark ? 3 : 0.4,
            "line-opacity": dark ? 0.5 : 0.55,
            "line-offset": dark ? 1.5 : 0.8,
          }}
        />

        {/* Invisible province hit-target (see INTERACTIVE). */}
        <Layer
          id="regions-hit"
          type="fill"
          source="regions"
          source-layer="regions"
          minzoom={3.6}
          paint={{ "fill-color": map.land, "fill-opacity": 0 }}
        />

        {/* ── What just changed hands (fades out after a turn lands) ── */}
        <Layer
          id="changed-countries-fill"
          type="fill"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", changes.countries) as never}
          paint={{
            "fill-color": theme.color.semantic.warning,
            "fill-opacity": changes.lit ? 0.32 : 0,
            "fill-opacity-transition": { duration: 1800, delay: 0 },
          }}
        />
        <Layer
          id="changed-regions-fill"
          type="fill"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", changes.regions) as never}
          paint={{
            "fill-color": theme.color.semantic.warning,
            "fill-opacity": changes.lit ? 0.34 : 0,
            "fill-opacity-transition": { duration: 1800, delay: 0 },
          }}
        />
        <Layer
          id="changed-countries-line"
          type="line"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", changes.countries) as never}
          paint={{
            "line-color": theme.color.semantic.warning,
            "line-width": 3.5,
            "line-blur": 2,
            "line-opacity": changes.lit ? 0.95 : 0,
            "line-opacity-transition": { duration: 1800, delay: 0 },
          }}
        />
        <Layer
          id="changed-regions-line"
          type="line"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", changes.regions) as never}
          paint={{
            "line-color": theme.color.semantic.warning,
            "line-width": 2,
            "line-blur": 1,
            "line-opacity": changes.lit ? 0.95 : 0,
            "line-opacity-transition": { duration: 1800, delay: 0 },
          }}
        />

        {/* ── Hover + selection ─────────────────────────────────────── */}
        <Layer
          id="hover-countries"
          type="fill"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", hoverCountries) as never}
          paint={{ "fill-color": map.hoverFill, "fill-opacity": dark ? 0.16 : 0.22 }}
        />
        <Layer
          id="hover-regions"
          type="fill"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", hoverRegions) as never}
          paint={{ "fill-color": map.hoverFill, "fill-opacity": dark ? 0.16 : 0.22 }}
        />
        <Layer
          id="selection-glow"
          type="line"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", selectedCountries) as never}
          paint={{
            "line-color": map.selectionOutline,
            "line-width": 7,
            "line-blur": 6,
            "line-opacity": dark ? 0.55 : 0.3,
          }}
        />
        <Layer
          id="selection-countries"
          type="line"
          source="countries"
          source-layer="countries"
          filter={inFilter("GID_0", selectedCountries) as never}
          paint={{ "line-color": map.selectionOutline, "line-width": 2 }}
        />
        <Layer
          id="selection-regions"
          type="line"
          source="regions"
          source-layer="regions"
          filter={inFilter("GID_1", selectedRegions) as never}
          paint={{ "line-color": map.selectionOutline, "line-width": 2 }}
        />

        <PolityLabels
          mapRef={mapRef}
          world={world}
          ownership={ownership}
          theme={theme}
          playerCode={playerCode}
          selected={selected ?? null}
          ready={ready}
        />
        <MapUnits world={world} palette={palette} tier={tier} />
        <EventPing />
      </Map>

      <div
        className={styles.vignette}
        style={{ opacity: map.vignette, color: vignetteColor(theme) }}
        aria-hidden
      />
      <MapOrnaments theme={theme} projection={projection} mapRef={mapRef} ready={ready} />
      <HoverCard info={hover} pointRef={hoverPoint} world={world} palette={palette} />
    </div>
  );
}

/**
 * Territory that changed hands when the map steps FORWARD one turn (the new
 * snapshot's node is the old one's child: a turn landing, a step down the
 * path, a time-lapse frame). Lit on arrival, faded by paint transition,
 * cleared once dark. Loom previews jumping sideways don't count.
 */
const useOwnershipChanges = (ownership: Ownership) => {
  const forNodeId = useWorldStore((state) => state.forNodeId);
  const previous = useRef<{ nodeId: string | null; ownership: Ownership } | null>(null);
  const [changes, setChanges] = useState<{ countries: string[]; regions: string[]; lit: boolean }>({
    countries: [],
    regions: [],
    lit: false,
  });

  useEffect(() => {
    const before = previous.current;
    previous.current = { nodeId: forNodeId, ownership };
    if (!before || before.nodeId === forNodeId) return;
    const dark = { countries: [], regions: [], lit: false };
    // Any other kind of move (sideways preview, checkout jump) puts out a
    // glow still burning — its fade timers died with the previous effect.
    if (!forNodeId || useLoomStore.getState().nodes[forNodeId]?.parentId !== before.nodeId) {
      setChanges((current) => (current.countries.length || current.regions.length ? dark : current));
      return;
    }
    const diff = (a: Record<string, string>, b: Record<string, string>) =>
      [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => a[id] !== b[id]);
    const countries = diff(before.ownership.countryOwner, ownership.countryOwner);
    const regions = diff(before.ownership.regionOwner, ownership.regionOwner);
    if (!countries.length && !regions.length) {
      setChanges((current) => (current.countries.length || current.regions.length ? dark : current));
      return;
    }
    setChanges({ countries, regions, lit: true });
    const fade = setTimeout(() => setChanges((current) => ({ ...current, lit: false })), 3800);
    const clear = setTimeout(() => setChanges(dark), 6000);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [forNodeId, ownership]);

  return changes;
};

/** Precomposited fills and bands keyed by GID, from one ownership truth. */
const buildTerritoryPaint = (
  theme: Theme,
  palette: Record<string, string>,
  ownership: Ownership,
) => {
  const land = theme.map.land;
  const line = theme.map.boundary.line;
  const fillOf = (owner: string) => (palette[owner] ? territoryColor(theme, palette[owner]) : land);
  const bandOf = (owner: string) => (palette[owner] ? bandColor(theme, palette[owner]) : line);
  const map = <T,>(record: Record<string, string>, fn: (owner: string) => T) =>
    Object.fromEntries(Object.entries(record).map(([id, owner]) => [id, fn(owner)])) as Record<string, string>;
  return {
    countryFill: matchExpression("GID_0", map(ownership.countryOwner, fillOf), land),
    regionFill: matchExpression("GID_1", map(ownership.regionOwner, fillOf), land),
    countryBand: matchExpression("GID_0", map(ownership.countryOwner, bandOf), line),
    regionBand: matchExpression("GID_1", map(ownership.regionOwner, bandOf), line),
  };
};
