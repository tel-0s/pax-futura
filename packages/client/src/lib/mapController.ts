import type { MapRef } from "react-map-gl/maplibre";
import type { GameEvent, WorldState } from "@pax/domain";

/**
 * Camera control shared across features without prop drilling: MapStage
 * registers its map ref; event cards, the inspector, and the top bar drive
 * the view through it. All lookups are best-effort — vector features can
 * only be found in loaded tiles, so a miss just leaves the camera alone.
 */
let mapRef: MapRef | null = null;

export const setMapRef = (ref: MapRef | null): void => {
  mapRef = ref;
};

export const flyTo = (lng: number, lat: number, zoom = 4.5): void => {
  mapRef?.getMap().flyTo({ center: [lng, lat], zoom, duration: 1200 });
};

/** Fit the camera to a country's rendered geometry (GID_0). */
export const focusCountry = (code: string): boolean =>
  focusFeatures("countries", "countries", ["==", ["get", "GID_0"], code]);

/** Fit the camera to a region's rendered geometry (GID_1). */
export const focusRegion = (regionId: string): boolean =>
  focusFeatures("regions", "regions", ["==", ["get", "GID_1"], regionId]);

/**
 * Center on a polity: country geometry first; landless actors fall back to
 * their units, then their structures. Returns false when nothing anchors it.
 */
export const focusPolity = (code: string, world: WorldState | null): boolean => {
  if (focusCountry(code)) return true;
  const unit = world?.units.find((entry) => entry.ownerCode === code);
  if (unit) {
    flyTo(unit.lng, unit.lat, 5);
    return true;
  }
  const marker = world?.markers.find((entry) => entry.ownerCode === code);
  if (marker) {
    flyTo(marker.lng, marker.lat, 5);
    return true;
  }
  return false;
};

/**
 * Center the map on where an event happened. An explicit coordinate (set by
 * the simulator or the cartographer pass) wins outright; otherwise the event's
 * impacts are walked for something anchorable.
 */
export const focusEvent = (event: GameEvent): boolean => {
  const { lng, lat } = event;
  if (lng !== undefined && lat !== undefined && Number.isFinite(lng) && Number.isFinite(lat)) {
    flyTo(lng, lat, 5);
    return true;
  }
  for (const op of event.impacts.unitOps) {
    if (op.op === "move") {
      flyTo(op.toLng, op.toLat, 5);
      return true;
    }
    if (op.op === "spawn") {
      flyTo(op.unit.lng, op.unit.lat, 5);
      return true;
    }
  }
  for (const op of event.impacts.markerOps) {
    if (op.op === "build") {
      flyTo(op.marker.lng, op.marker.lat, 5);
      return true;
    }
  }
  for (const transfer of event.impacts.regionTransfers) {
    if (focusRegion(transfer.regionId)) return true;
    if (transfer.toCode && focusCountry(transfer.toCode)) return true;
  }
  for (const change of event.impacts.polityChanges) {
    if (focusCountry(change.code)) return true;
  }
  for (const chat of event.impacts.createdChats) {
    const participant = chat.participants[0];
    if (participant && focusCountry(participant)) return true;
  }
  return false;
};

const focusFeatures = (
  source: string,
  sourceLayer: string,
  filter: unknown,
): boolean => {
  const map = mapRef?.getMap();
  if (!map || !map.getSource(source)) return false;
  const features = map.querySourceFeatures(source, {
    sourceLayer,
    filter: filter as never,
  });
  if (features.length === 0) return false;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const lngs: number[] = [];
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      lngs.push(coords[0]);
      minLng = Math.min(minLng, coords[0]);
      maxLng = Math.max(maxLng, coords[0]);
      minLat = Math.min(minLat, coords[1] as number);
      maxLat = Math.max(maxLat, coords[1] as number);
      return;
    }
    for (const child of coords) visit(child);
  };
  for (const feature of features) {
    visit((feature.geometry as { coordinates?: unknown }).coordinates);
  }
  if (!Number.isFinite(minLng)) return false;

  // Antimeridian-crossing geometries (Russia, USA/Aleutians, Fiji, NZ) span
  // near-±180 and a naive box frames the whole globe. Recompute in a 0..360
  // frame when the span is implausibly wide; fitBounds accepts lng > 180.
  if (maxLng - minLng > 180) {
    let minShift = Infinity;
    let maxShift = -Infinity;
    for (const lng of lngs) {
      const shifted = lng < 0 ? lng + 360 : lng;
      minShift = Math.min(minShift, shifted);
      maxShift = Math.max(maxShift, shifted);
    }
    if (maxShift - minShift < maxLng - minLng) {
      minLng = minShift;
      maxLng = maxShift;
    }
  }
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 120, maxZoom: 6, duration: 1200 },
  );
  return true;
};
