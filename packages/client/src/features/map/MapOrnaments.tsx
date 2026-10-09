import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Globe, LocateFixed, Map as MapIcon, Minus, Plus } from "lucide-react";
import type { Theme } from "@pax/domain";
import type { Projection } from "../../lib/map/mapStyle.ts";
import { focusPolity } from "../../lib/mapController.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import styles from "./MapOrnaments.module.css";

/**
 * Furniture over the map: the theme's ornament (HUD frame, compass rose +
 * cartouche, or nothing) plus the camera controls every theme gets. Shifts
 * clear of the conversations drawer so controls are never buried.
 */
export function MapOrnaments({
  theme,
  projection,
  mapRef,
  ready,
}: {
  theme: Theme;
  projection: Projection;
  mapRef: RefObject<MapRef | null>;
  ready: boolean;
}) {
  const conversationsOpen = useUiStore((state) => state.conversationsOpen);
  const kind = theme.map.ornament;
  // The conversations drawer is wide (440px) and floats 8px off the edge.
  const inset = { "--pf-map-right-inset": conversationsOpen ? "456px" : "0px" } as CSSProperties;

  return (
    <div className={styles.layer} style={inset} data-ornament={kind}>
      {kind === "hud" ? <HudFrame mapRef={mapRef} ready={ready} /> : null}
      {kind === "compass" ? (
        <>
          <CompassRose />
          <Cartouche />
        </>
      ) : null}
      <MapControls theme={theme} projection={projection} mapRef={mapRef} />
    </div>
  );
}

function HudFrame({ mapRef, ready }: { mapRef: RefObject<MapRef | null>; ready: boolean }) {
  const [readout, setReadout] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    let frame = 0;
    let pending: { lng: number; lat: number } | null = null;
    const onMove = (event: { lngLat: { lng: number; lat: number } }) => {
      pending = event.lngLat;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setReadout(pending);
        });
      }
    };
    const onOut = () => setReadout(null);
    const onZoom = () => setZoom(map.getZoom());
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    map.on("zoom", onZoom);
    onZoom();
    return () => {
      cancelAnimationFrame(frame);
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
      map.off("zoom", onZoom);
    };
  }, [mapRef, ready]);

  return (
    <>
      <div className={styles.hudFrame} aria-hidden />
      <div className={styles.hudReadout}>
        <span className={styles.hudDot} />
        <span>{readout ? formatCoord(readout.lat, "N", "S") : "--.--°"}</span>
        <span>{readout ? formatCoord(readout.lng, "E", "W") : "--.--°"}</span>
        <span className={styles.hudZoom}>Z{zoom.toFixed(1)}</span>
      </div>
    </>
  );
}

function CompassRose() {
  // Sixteen-point rose: long cardinal blades, short intercardinal ones,
  // a ring of ticks, and the north blade in the accent (rubric) color.
  const blades = [0, 90, 180, 270];
  const minor = [45, 135, 225, 315];
  return (
    <svg className={styles.compass} viewBox="-60 -60 120 120" aria-hidden>
      <circle r="44" className={styles.compassRing} />
      <circle r="40" className={styles.compassRingFine} />
      {Array.from({ length: 64 }, (_, i) => (
        <line
          key={i}
          x1="0"
          y1={i % 4 === 0 ? -40 : -42}
          x2="0"
          y2="-44"
          transform={`rotate(${i * 5.625})`}
          className={styles.compassTick}
        />
      ))}
      {minor.map((angle) => (
        <g key={angle} transform={`rotate(${angle})`}>
          <path d="M0 -30 L5 0 L0 4 Z" className={styles.bladeLight} />
          <path d="M0 -30 L-5 0 L0 4 Z" className={styles.bladeDark} />
        </g>
      ))}
      {blades.map((angle) => (
        <g key={angle} transform={`rotate(${angle})`}>
          <path d="M0 -52 L8 0 L0 6 Z" className={angle === 0 ? styles.bladeNorth : styles.bladeLight} />
          <path d="M0 -52 L-8 0 L0 6 Z" className={angle === 0 ? styles.bladeNorthDark : styles.bladeDark} />
        </g>
      ))}
      <circle r="3.2" className={styles.compassHub} />
      <text y="-54" className={styles.compassN}>
        N
      </text>
    </svg>
  );
}

function Cartouche() {
  const date = useLoomStore((state) =>
    state.currentNodeId ? state.nodes[state.currentNodeId]?.gameDate : undefined,
  );
  const playerName = useWorldStore((state) => {
    const code = useSessionStore.getState().meta?.playerPolity;
    return code ? state.world?.polities[code]?.name || code : "";
  });
  const year = date ? parseInt(date, 10) : NaN;
  return (
    <div className={`${styles.cartouche} pfTitle`}>
      <span className={styles.cartoucheKicker}>Mappa Mundi</span>
      {playerName ? <span className={styles.cartoucheTitle}>{playerName}</span> : null}
      {Number.isFinite(year) && year > 0 ? (
        <span className={styles.cartoucheYear}>Anno Domini {roman(year)}</span>
      ) : null}
    </div>
  );
}

function MapControls({
  theme,
  projection,
  mapRef,
}: {
  theme: Theme;
  projection: Projection;
  mapRef: RefObject<MapRef | null>;
}) {
  const setMapProjection = useUiStore((state) => state.setMapProjection);
  const playerCode = useSessionStore((state) => state.meta?.playerPolity);
  const map = () => mapRef.current?.getMap();
  const toggleProjection = () => {
    const next: Projection = projection === "globe" ? "mercator" : "globe";
    setMapProjection(next === theme.map.projection ? "theme" : next);
  };
  return (
    <div className={styles.controls}>
      <button className={styles.control} title="Zoom in" onClick={() => map()?.zoomIn()}>
        <Plus size={15} />
      </button>
      <button className={styles.control} title="Zoom out" onClick={() => map()?.zoomOut()}>
        <Minus size={15} />
      </button>
      <span className={styles.controlRule} />
      <button
        className={styles.control}
        title={projection === "globe" ? "Flat map" : "Globe"}
        onClick={toggleProjection}
      >
        {projection === "globe" ? <MapIcon size={15} /> : <Globe size={15} />}
      </button>
      {playerCode ? (
        <button
          className={styles.control}
          title="Center on my realm"
          onClick={() => focusPolity(playerCode, useWorldStore.getState().world)}
        >
          <LocateFixed size={15} />
        </button>
      ) : null}
    </div>
  );
}

const formatCoord = (value: number, positive: string, negative: string): string =>
  `${Math.abs(value).toFixed(2).padStart(6, "0")}°${value >= 0 ? positive : negative}`;

const roman = (value: number): string => {
  if (value >= 4000) return String(value);
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let rest = value;
  let out = "";
  for (const [n, glyph] of table) {
    while (rest >= n) {
      out += glyph;
      rest -= n;
    }
  }
  return out;
};
