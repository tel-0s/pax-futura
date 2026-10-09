import { newId, pairKey, type Fact, type NationSheet, type Rollup } from "@pax/domain";

const emptySheet = (): NationSheet => ({
  leader: "",
  government: "",
  econTrend: "",
  atWarWith: [],
  treaties: [],
});

/**
 * The incremental digest folded down a loom path:
 * rollup(node) = fold(rollup(parent), facts(node)). Pure, so branches diverge
 * for free — siblings fold from the same parent rollup.
 */
export const foldRollup = (parent: Rollup, facts: readonly Fact[], depth: number): Rollup => {
  const next = structuredClone(parent) as Rollup;
  const sheet = (code: string): NationSheet => (next.nations[code] ??= emptySheet());

  for (const fact of facts) {
    switch (fact.type) {
      case "war_started": {
        addUnique(sheet(fact.attacker).atWarWith, fact.defender);
        addUnique(sheet(fact.defender).atWarWith, fact.attacker);
        break;
      }
      case "war_ended": {
        for (const party of fact.parties) {
          sheet(party).atWarWith = sheet(party).atWarWith.filter(
            (enemy) => !fact.parties.includes(enemy),
          );
        }
        break;
      }
      case "treaty_signed": {
        for (const party of fact.parties) addUnique(sheet(party).treaties, fact.name);
        break;
      }
      case "treaty_broken": {
        for (const party of fact.parties) {
          sheet(party).treaties = sheet(party).treaties.filter((name) => name !== fact.name);
        }
        break;
      }
      case "leader_changed":
        sheet(fact.polity).leader = fact.newLeader;
        break;
      case "government_changed":
        sheet(fact.polity).government = fact.newSystem;
        break;
      case "economic_shift":
        sheet(fact.polity).econTrend = fact.direction;
        break;
      case "relationship_shift": {
        const key = pairKey(fact.pair[0], fact.pair[1]);
        const existing = next.relations[key] ?? { score: 0, lastReason: "" };
        next.relations[key] = {
          score: Math.max(-10, Math.min(10, existing.score + fact.delta)),
          lastReason: fact.reason,
        };
        break;
      }
      case "arc_update": {
        if (fact.status === "resolved") {
          next.openArcs = next.openArcs.filter((arc) => arc.arcId !== fact.arcId);
        } else {
          const arc = next.openArcs.find((entry) => entry.arcId === fact.arcId);
          if (arc) {
            arc.status = fact.status;
            arc.lastUpdatedDepth = depth;
            if (fact.title) arc.title = fact.title;
          } else {
            next.openArcs.push({
              arcId: fact.arcId || newId(),
              title: fact.title,
              status: fact.status,
              lastUpdatedDepth: depth,
            });
          }
        }
        break;
      }
      case "commitment": {
        if (fact.status === "made") {
          next.openCommitments.push({
            from: fact.from,
            to: fact.to,
            what: fact.what,
            deadline: fact.deadline ?? "",
          });
        } else {
          next.openCommitments = next.openCommitments.filter(
            (entry) => !(entry.from === fact.from && entry.to === fact.to && entry.what === fact.what),
          );
        }
        break;
      }
      // territory_change / polity_change / notable_event live in digests, not rollups.
      default:
        break;
    }
  }
  return next;
};

const addUnique = (list: string[], value: string): void => {
  if (!list.includes(value)) list.push(value);
};
