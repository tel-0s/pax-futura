import { COUNTRY_ENTRIES, REGION_ENTRIES } from "./regionCatalogData.ts";

export { COUNTRY_ENTRIES, REGION_ENTRIES };

/**
 * Every id the map can actually paint: country codes (GID_0) plus every
 * sub-region feature id. Region transfers naming ids outside this set (and
 * outside the world's existing ownership keys) refer to nothing on the map.
 */
export const KNOWN_REGION_IDS: ReadonlySet<string> = new Set([
  ...COUNTRY_ENTRIES.map(([code]) => code),
  ...REGION_ENTRIES.map(([id]) => id),
]);

const NAMES = new Map<string, string>([...COUNTRY_ENTRIES, ...REGION_ENTRIES]);

/** Human name for a catalog id, or the id itself if unknown. */
export const regionDisplayName = (id: string): string => NAMES.get(id) ?? id;

/** The country-code vocabulary line used in prompts (compact, cacheable). */
export const countryCodeVocabulary = (): string =>
  COUNTRY_ENTRIES.map(([code]) => code).join(" ");
