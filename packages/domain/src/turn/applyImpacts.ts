import "../globals.ts";
import type { Marker } from "../world/markers.ts";
import type { Unit } from "../world/units.ts";
import { clampUnitStrength } from "../world/units.ts";
import type { WorldState } from "../world/world.ts";
import type { EventDraft } from "./event.ts";
import type { MarkerOp, PolityChange, UnitOp } from "./impacts.ts";

/**
 * The pure fold from (world, events) to the next world. Lives in domain so the
 * engine and any preview UI share one implementation. Semantics ported from the
 * reference implementation's applyEventImpactsToWorld, including:
 * - tags: [] clears, null leaves unchanged (the model sends complete lists)
 * - spawn is idempotent by unit id (re-applied batches can't duplicate)
 * - units at 0 strength or "defeated" are dropped at the end of each op batch
 * - rebuilding a marker under an existing name replaces it; removal matches
 *   id first, then exact name (the model usually knows names, rarely ids)
 *
 * `newId` is injected so the fold stays deterministic under test.
 */
export const applyImpacts = (
  world: WorldState,
  events: readonly EventDraft[],
  newId: () => string,
): WorldState => {
  const next = structuredClone(world) as WorldState;

  for (const event of events) {
    const { regionTransfers, polityChanges, unitOps, markerOps } = event.impacts;

    for (const transfer of regionTransfers) {
      if (transfer.toCode === null) delete next.regionOwnership[transfer.regionId];
      else next.regionOwnership[transfer.regionId] = transfer.toCode;
    }

    for (const change of polityChanges) {
      applyPolityChange(next, change);
    }

    if (unitOps.length > 0) {
      next.units = applyUnitOps(next.units, unitOps, newId);
    }

    if (markerOps.length > 0) {
      next.markers = applyMarkerOps(next.markers, markerOps, newId);
    }
  }

  return next;
};

const applyPolityChange = (world: WorldState, change: PolityChange): void => {
  const existing = world.polities[change.code] ?? {
    code: change.code,
    name: "",
    color: "",
    aliases: [],
    note: "",
    reputation: null,
    tags: [],
    flag: "",
  };

  world.polities[change.code] = {
    ...existing,
    ...(change.name ? { name: change.name } : {}),
    ...(change.color ? { color: change.color } : {}),
    ...(change.aliases.length > 0 ? { aliases: change.aliases } : {}),
    ...(change.note ? { note: change.note } : {}),
    ...(change.reputation !== null
      ? { reputation: Math.max(0, Math.min(100, Math.round(change.reputation))) }
      : {}),
    ...(change.tags !== null ? { tags: change.tags } : {}),
  };
};

export const applyUnitOps = (
  units: readonly Unit[],
  ops: readonly UnitOp[],
  newId: () => string,
): Unit[] => {
  let next: Unit[] = [...units];

  for (const op of ops) {
    switch (op.op) {
      case "spawn": {
        const id = op.unit.id ?? newId();
        if (!next.some((unit) => unit.id === id)) {
          next.push({ ...op.unit, id, source: "ai", strength: clampUnitStrength(op.unit.strength) });
        }
        break;
      }
      case "move":
        next = next.map((unit) =>
          unit.id === op.unitId
            ? {
                ...unit,
                lng: op.toLng,
                lat: op.toLat,
                regionId: op.regionId || unit.regionId,
                status: "moving",
              }
            : unit,
        );
        break;
      case "strength":
        next = next.map((unit) =>
          unit.id === op.unitId
            ? {
                ...unit,
                strength: clampUnitStrength(op.strength),
                status: op.strength <= 0 ? "defeated" : unit.status,
              }
            : unit,
        );
        break;
      case "remove":
        next = next.filter((unit) => unit.id !== op.unitId);
        break;
    }
  }

  return next.filter((unit) => unit.strength > 0 && unit.status !== "defeated");
};

export const applyMarkerOps = (
  markers: readonly Marker[],
  ops: readonly MarkerOp[],
  newId: () => string,
): Marker[] => {
  let next: Marker[] = [...markers];

  for (const op of ops) {
    if (op.op === "build") {
      const marker: Marker = { ...op.marker, id: op.marker.id ?? newId() };
      next = [
        ...next.filter((entry) => entry.name.toLowerCase() !== marker.name.toLowerCase()),
        marker,
      ];
    } else {
      next = next.filter((entry) =>
        op.markerId ? entry.id !== op.markerId : entry.name.toLowerCase() !== op.name.toLowerCase(),
      );
    }
  }

  return next;
};
