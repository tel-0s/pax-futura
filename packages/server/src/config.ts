import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerConfig {
  /** Directory holding app.sqlite and per-game save files. */
  dataDir: string;
  /** Directory holding map archives (regions/countries/cities pmtiles). */
  mapAssetsDir: string;
  port: number;
}

export const loadConfig = (): ServerConfig => {
  const dataDir = resolve(process.env.PAX_DATA_DIR ?? resolve(import.meta.dirname, "../../../saves"));
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    mapAssetsDir: resolve(
      process.env.PAX_MAP_ASSETS_DIR ?? resolve(import.meta.dirname, "../../../assets"),
    ),
    port: Number(process.env.PAX_PORT ?? 8787),
  };
};
