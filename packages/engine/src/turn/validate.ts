import { KNOWN_REGION_IDS, type TurnResult, type WorldState } from "@pax/domain";

export interface ValidationOutcome {
  /** Problems worth a corrective retry (semantic, model-fixable). */
  errors: string[];
  /** Salvaged result with individually-invalid sub-ops dropped. */
  salvaged: TurnResult;
  /** What salvage dropped (logged, surfaced in debug). */
  dropped: string[];
}

/**
 * Semantic validation beyond the Zod shape: date sanity, referential
 * integrity of unit ops, region-transfer plausibility. Returns both the
 * error list (for a corrective retry) and a salvaged result (for the
 * deterministic fallback path) so the pipeline chooses the strategy.
 */
export const validateTurnResult = (
  result: TurnResult,
  world: WorldState,
  parentDate: string,
): ValidationOutcome => {
  const errors: string[] = [];
  const dropped: string[] = [];

  const parentTime = Date.parse(parentDate);
  const stopTime = Date.parse(result.stopDate);
  if (Number.isFinite(parentTime) && Number.isFinite(stopTime) && stopTime <= parentTime) {
    errors.push(
      `stopDate ${result.stopDate} does not advance past the current date ${parentDate}.`,
    );
  }

  // Long-context drift failure mode: the simulator degenerates to bare
  // headlines (description is schema-optional). One corrective retry usually
  // restores substance; salvage keeps the events either way.
  if (result.events.length > 0 && result.events.every((event) => !event.description.trim())) {
    errors.push(
      "Every event is a bare headline. Each event needs a description of 1-3 substantive sentences narrating what happened and why it matters.",
    );
  }

  const knownUnitIds = new Set(world.units.map((unit) => unit.id));
  const knownPolities = new Set(Object.keys(world.polities));

  const events = result.events.map((event, index) => {
    const impacts = { ...event.impacts };

    impacts.unitOps = impacts.unitOps.filter((op) => {
      if (op.op === "spawn") {
        if (op.unit.id && knownUnitIds.has(op.unit.id)) return true;
        if (op.unit.id === undefined) return true;
        knownUnitIds.add(op.unit.id);
        return true;
      }
      if (!knownUnitIds.has(op.unitId)) {
        dropped.push(`event ${index}: ${op.op} references unknown unit "${op.unitId}"`);
        return false;
      }
      if (op.op === "remove") knownUnitIds.delete(op.unitId);
      return true;
    });

    impacts.regionTransfers = impacts.regionTransfers.filter((transfer) => {
      if (!transfer.regionId.trim()) {
        dropped.push(`event ${index}: region transfer with empty regionId`);
        return false;
      }
      // Ids must exist on the map (GADM catalog) or already be in the world's
      // ownership table (scenarios may use their own region keys). Invented
      // ids would apply invisibly, so they are both flagged for a corrective
      // retry and dropped from the salvage path.
      if (
        !KNOWN_REGION_IDS.has(transfer.regionId) &&
        !(transfer.regionId in world.regionOwnership)
      ) {
        errors.push(
          `Region id "${transfer.regionId}" does not exist on the map. Use a real GADM id: a GID_0 country code ("USA") or a GID_1 sub-region id from the ownership vocabulary ("USA.5_1").`,
        );
        dropped.push(`event ${index}: transfer of unknown region id "${transfer.regionId}"`);
        return false;
      }
      return true;
    });

    for (const transfer of impacts.regionTransfers) {
      if (transfer.toCode !== null && !knownPolities.has(transfer.toCode)) {
        // A new polity may legitimately appear (secession) — require the model
        // to also register it via polityChanges; otherwise flag for retry.
        const registered = result.events.some((candidate) =>
          candidate.impacts.polityChanges.some((change) => change.code === transfer.toCode),
        );
        if (!registered) {
          errors.push(
            `Region ${transfer.regionId} transferred to unknown polity "${transfer.toCode}" with no matching polityChanges entry registering it.`,
          );
        }
      }
    }

    const eventTime = Date.parse(event.date);
    const clampedDate =
      Number.isFinite(eventTime) && Number.isFinite(stopTime) && eventTime > stopTime
        ? result.stopDate
        : event.date;
    if (clampedDate !== event.date) {
      dropped.push(`event ${index}: date ${event.date} clamped to stopDate`);
    }

    return { ...event, date: clampedDate, impacts };
  });

  return { errors, salvaged: { ...result, events }, dropped };
};
