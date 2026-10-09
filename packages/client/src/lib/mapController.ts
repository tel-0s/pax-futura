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
  // Dev-only handle for poking the live map from the console / test drivers.
  if (import.meta.env.DEV) (window as unknown as { __paxMap?: unknown }).__paxMap = ref?.getMap() ?? null;
};

/**
 * How much of the map each side's chrome hides, in px. Panels that float over
 * the map mark themselves `data-occludes="top|bottom|left|right"` (top bar,
 * dock, rail, drawers, the event card); camera moves aim for the centre of
 * what's actually visible instead of the canvas centre.
 */
export const occlusion = (): { top: number; bottom: number; left: number; right: number } => {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  const map = mapRef?.getMap();
  if (!map) return pad;
  const box = map.getContainer().getBoundingClientRect();
  for (const element of document.querySelectorAll<HTMLElement>("[data-occludes]")) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const side = element.dataset.occludes;
    if (side === "top") pad.top = Math.max(pad.top, rect.bottom - box.top);
    else if (side === "bottom") pad.bottom = Math.max(pad.bottom, box.bottom - rect.top);
    else if (side === "left") pad.left = Math.max(pad.left, rect.right - box.left);
    else if (side === "right") pad.right = Math.max(pad.right, box.right - rect.left);
  }
  // Never let chrome claim more than ~70% of an axis — keep a usable window.
  const fit = (a: number, b: number, size: number): [number, number] => {
    const limit = size * 0.7;
    const total = a + b;
    return total > limit ? [(a * limit) / total, (b * limit) / total] : [a, b];
  };
  [pad.top, pad.bottom] = fit(pad.top, pad.bottom, box.height);
  [pad.left, pad.right] = fit(pad.left, pad.right, box.width);
  return pad;
};

/**
 * Camera moves run a frame late so a panel that opens in the same action
 * (the event card, the inspector) has laid out before we measure around it.
 */
const afterLayout = (run: () => void): void => {
  requestAnimationFrame(() => requestAnimationFrame(run));
};

export const flyTo = (lng: number, lat: number, zoom = 4.5): void => {
  afterLayout(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const pad = occlusion();
    map.flyTo({
      center: [lng, lat],
      zoom,
      duration: 1200,
      offset: [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2],
    });
  });
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
  afterLayout(() => {
    const pad = occlusion();
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: { top: pad.top + 60, bottom: pad.bottom + 60, left: pad.left + 60, right: pad.right + 60 },
        maxZoom: 6,
        duration: 1200,
      },
    );
  });
  return true;
};
