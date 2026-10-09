import type { WorldState } from "@pax/domain";

/**
 * The map's ownership truth, inverted for rendering. Country-level entries
 * (GID_0, 3-letter keys) overlay polity self-ownership; region entries
 * (GID_1) refine on top. Every layer — fills, bands, hover, selection,
 * labels — reads this one structure so they can never disagree.
 */
export interface Ownership {
  /** GID_0 -> owning polity code (self-owned polities + country transfers). */
  countryOwner: Record<string, string>;
  /** GID_1 -> owning polity code (explicit region overrides only). */
  regionOwner: Record<string, string>;
  /** polity -> GID_0s it paints. */
  countriesOf: Record<string, string[]>;
  /** polity -> GID_1 overrides it paints. */
  regionsOf: Record<string, string[]>;
  /** GID_0s / GID_1s with competing claimants (disputed hatching). */
  claimedCountries: string[];
  claimedRegions: string[];
}

const COUNTRY_KEY = /^[A-Z]{3}$/;

export const buildOwnership = (world: WorldState | null): Ownership => {
  const countryOwner: Record<string, string> = {};
  const regionOwner: Record<string, string> = {};
  if (world) {
    for (const code of Object.keys(world.polities)) {
      if (COUNTRY_KEY.test(code)) countryOwner[code] = code;
    }
    for (const [id, owner] of Object.entries(world.regionOwnership)) {
      if (COUNTRY_KEY.test(id)) countryOwner[id] = owner;
      else regionOwner[id] = owner;
    }
  }
  const countriesOf: Record<string, string[]> = {};
  const regionsOf: Record<string, string[]> = {};
  for (const [id, owner] of Object.entries(countryOwner)) (countriesOf[owner] ??= []).push(id);
  for (const [id, owner] of Object.entries(regionOwner)) (regionsOf[owner] ??= []).push(id);

  const claimedCountries: string[] = [];
  const claimedRegions: string[] = [];
  for (const [id, claimants] of Object.entries(world?.regionClaimants ?? {})) {
    if (!claimants.length) continue;
    if (COUNTRY_KEY.test(id)) claimedCountries.push(id);
    else claimedRegions.push(id);
  }
  return { countryOwner, regionOwner, countriesOf, regionsOf, claimedCountries, claimedRegions };
};

/** Owner of whatever is under a feature's properties: region override first. */
export const ownerAt = (
  ownership: Ownership,
  props: { GID_0?: string; GID_1?: string } | undefined,
): string | null => {
  if (!props) return null;
  if (props.GID_1 && ownership.regionOwner[props.GID_1]) return ownership.regionOwner[props.GID_1]!;
  if (props.GID_0 && ownership.countryOwner[props.GID_0]) return ownership.countryOwner[props.GID_0]!;
  return null;
};

/** MapLibre `match` expression id -> value, with a fallback. */
export const matchExpression = (
  property: "GID_0" | "GID_1",
  entries: Record<string, string>,
  fallback: string,
): unknown => {
  const flat = Object.entries(entries).flat();
  if (flat.length === 0) return fallback;
  return ["match", ["get", property], ...flat, fallback];
};

/** Filter matching any of the ids (an always-false filter when empty). */
export const inFilter = (property: "GID_0" | "GID_1", ids: readonly string[]): unknown =>
  ids.length ? ["in", ["get", property], ["literal", ids]] : ["==", ["get", property], "\u0000"];
