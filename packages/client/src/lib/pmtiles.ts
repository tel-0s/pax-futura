import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

let registered = false;

/** Register the pmtiles:// protocol with MapLibre exactly once. */
export const ensurePmtilesProtocol = (): void => {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  registered = true;
};

export const PMTILES_URLS = {
  countries: `pmtiles://${location.origin}/assets/countries.pmtiles`,
  regions: `pmtiles://${location.origin}/assets/regions.pmtiles`,
  cities: `pmtiles://${location.origin}/assets/cities.pmtiles`,
};
