import { FactSchema, RollupSchema, newId, type Fact, type Rollup } from "@pax/domain";
import type { Db } from "../openDb.ts";

/** Polity codes a fact is about, for the subject index. */
const subjectsOf = (fact: Fact): string[] => {
  switch (fact.type) {
    case "war_started":
      return [fact.attacker, fact.defender];
    case "war_ended":
    case "treaty_signed":
    case "treaty_broken":
      return fact.parties;
    case "leader_changed":
    case "government_changed":
    case "economic_shift":
      return [fact.polity];
    case "relationship_shift":
      return [...fact.pair];
    case "commitment":
      return [fact.from, fact.to];
    case "notable_event":
      return fact.polities;
    case "territory_change":
      return [fact.from, fact.to].filter(Boolean);
    case "polity_change":
      return [fact.polity];
    case "arc_update":
      return [];
  }
};

export const insertFacts = (
  db: Db,
  nodeId: string,
  facts: readonly Fact[],
  source: "derived" | "extracted",
  startSeq = 0,
): void => {
  const stmt = db.prepare(
    `INSERT INTO facts (id, node_id, seq, type, payload_json, subjects_json, arc_id, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  facts.forEach((fact, index) => {
    stmt.run(
      newId(),
      nodeId,
      startSeq + index,
      fact.type,
      JSON.stringify(fact),
      JSON.stringify(subjectsOf(fact)),
      fact.type === "arc_update" ? fact.arcId : "",
      source,
      Date.now(),
    );
  });
};

export const listFactsForNode = (db: Db, nodeId: string): Fact[] => {
  const rows = db
    .prepare("SELECT payload_json FROM facts WHERE node_id = ? ORDER BY seq")
    .all(nodeId) as Array<{ payload_json: string }>;
  return rows.map((row) => FactSchema.parse(JSON.parse(row.payload_json)));
};

export const setRollup = (db: Db, nodeId: string, rollup: Rollup): void => {
  db.prepare(
    `INSERT INTO node_rollups (node_id, rollup_json) VALUES (?, ?)
     ON CONFLICT (node_id) DO UPDATE SET rollup_json = excluded.rollup_json`,
  ).run(nodeId, JSON.stringify(rollup));
};

export const getRollup = (db: Db, nodeId: string): Rollup | null => {
  const row = db.prepare("SELECT rollup_json FROM node_rollups WHERE node_id = ?").get(nodeId) as
    | { rollup_json: string }
    | undefined;
  return row ? RollupSchema.parse(JSON.parse(row.rollup_json)) : null;
};
