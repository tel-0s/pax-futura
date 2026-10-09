import type { Fact, GameEvent } from "@pax/domain";

/**
 * Facts the engine can compute exactly from applied impacts — never ask a
 * model to restate what the engine already knows.
 */
export const deriveFacts = (events: readonly GameEvent[]): Fact[] => {
  const facts: Fact[] = [];
  for (const event of events) {
    for (const transfer of event.impacts.regionTransfers) {
      facts.push({
        type: "territory_change",
        regionId: transfer.regionId,
        regionName: transfer.regionName,
        from: transfer.fromCode,
        to: transfer.toCode ?? "",
      });
    }
    for (const change of event.impacts.polityChanges) {
      const changes: Record<string, unknown> = {};
      if (change.name) changes.name = change.name;
      if (change.reputation !== null) changes.reputation = change.reputation;
      if (change.tags !== null) changes.tags = change.tags;
      if (change.note) changes.note = change.note;
      if (Object.keys(changes).length > 0) {
        facts.push({ type: "polity_change", polity: change.code, changes });
      }
    }
  }
  return facts;
};
