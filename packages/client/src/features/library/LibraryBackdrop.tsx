import { useEffect, useMemo, useRef } from "react";
import Map, { Layer, Source, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { COUNTRY_ENTRIES, type Theme } from "@pax/domain";
import { ensurePmtilesProtocol, PMTILES_URLS } from "../../lib/pmtiles.ts";
import { buildBaseStyle, buildSky, spaceColor } from "../../lib/map/mapStyle.ts";
import { installPatternProvider, patternName } from "../../lib/map/patterns.ts";
import { polityFillColor, territoryColor } from "../../theme/palette.ts";
import styles from "./LibraryScreen.module.css";

ensurePmtilesProtocol();

/**
 * The library's living backdrop: the whole world painted as a political map
 * in the active theme's cartography — every country its own realm — drifting
 * slowly east. Purely decorative: no interaction, paused when the tab hides
 * and frozen for reduced-motion users.
 */
export function LibraryBackdrop({ theme }: { theme: Theme }) {
  const ref = useRef<MapRef | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const projection = theme.map.projection;

  const fill = useMemo(() => {
    const entries = COUNTRY_ENTRIES.flatMap(([code]) => [
      code,
      territoryColor(theme, polityFillColor(theme, code)),
    ]);
    return ["match", ["get", "GID_0"], ...entries, theme.map.land] as unknown as string;
  }, [theme]);
  const baseStyle = useMemo(() => buildBaseStyle(theme), [theme]);
  const sky = useMemo(() => buildSky(theme, projection), [theme, projection]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const map = ref.current?.getMap();
      if (!map || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(64, now - last);
      last = now;
      const center = map.getCenter();
      map.jumpTo({ center: [((center.lng + dt * 0.0016 + 540) % 360) - 180, center.lat] });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const coast = theme.map.coast;
  const coastColor = coast.color || theme.map.boundary.line;
  const texture = theme.map.landTexture === "none" ? null : patternName(`land-${theme.map.landTexture}` as "land-paper", theme);

  return (
    <div className={styles.backdrop} style={{ background: spaceColor(theme) }} aria-hidden>
      <div className={projection === "globe" ? styles.globeStage : styles.flatStage}>
      <Map
        ref={(instance) => {
          ref.current = instance;
          const map = instance?.getMap();
          if (map) installPatternProvider(map, () => themeRef.current);
        }}
        mapStyle={baseStyle}
        projection={{ type: projection }}
        {...(sky ? { sky } : {})}
        initialViewState={{ longitude: 20, latitude: projection === "globe" ? 24 : 30, zoom: projection === "globe" ? 2.05 : 1.6 }}
        interactive={false}
        attributionControl={false}
      >
        <Source id="countries" type="vector" url={PMTILES_URLS.countries} maxzoom={8} />
        <Layer
          id="bd-coast"
          type="line"
          source="countries"
          source-layer="countries"
          layout={{ visibility: coast.style === "none" ? "none" : "visible" }}
          paint={{
            "line-color": coastColor,
            "line-width": coast.style === "ripples" ? 0.8 : coast.width * 1.2,
            "line-blur": coast.style === "ripples" ? 0 : coast.width,
            "line-gap-width": coast.style === "ripples" ? coast.width * 1.4 : 0,
            "line-opacity": coast.opacity * 0.8,
          }}
        />
        <Layer id="bd-fill" type="fill" source="countries" source-layer="countries" paint={{ "fill-color": fill }} />
        <Layer
          id="bd-texture"
          type="fill"
          source="countries"
          source-layer="countries"
          layout={{ visibility: texture ? "visible" : "none" }}
          paint={{ ...(texture ? { "fill-pattern": texture } : {}), "fill-opacity": theme.map.textureStrength }}
        />
        <Layer
          id="bd-borders"
          type="line"
          source="countries"
          source-layer="countries"
          paint={{ "line-color": theme.map.boundary.line, "line-width": 0.6, "line-opacity": 0.8 }}
        />
      </Map>
      </div>
      <div className={styles.backdropShade} />
    </div>
  );
}
