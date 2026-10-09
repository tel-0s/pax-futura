import type { Fact, FactConfidence, PsycheSheet, Rollup } from "@pax/domain";

/** An ungraded fact is one the engine or the player's own court knows firsthand. */
export const factConfidence = (fact: Fact): FactConfidence => fact.confidence ?? "confirmed";

/**
 * The intel marker every reader of the digest inherits for free — simulator
 * prompt, era summaries, chronicle and search all render through this line, so
 * one prefix is the whole fog layer.
 */
const confidenceMark = (fact: Fact): string => {
  switch (factConfidence(fact)) {
    case "reported":
      return "(reported) ";
    case "rumored":
      return "(rumor) ";
    case "confirmed":
      return "";
  }
};

/** One compact deterministic line per fact — the mid-term history tier. */
export const factDigestLine = (fact: Fact): string => confidenceMark(fact) + factBody(fact);

const factBody = (fact: Fact): string => {
  switch (fact.type) {
    case "war_started":
      return `war_started ${fact.attacker}->${fact.defender} (${fact.cause})`;
    case "war_ended":
      return `war_ended ${fact.parties.join("+")} (${fact.outcome}${fact.victor ? `, victor ${fact.victor}` : ""})`;
    case "treaty_signed":
      return `treaty "${fact.name}" (${fact.kind}) ${fact.parties.join("+")}`;
    case "treaty_broken":
      return `treaty_broken "${fact.name}" by ${fact.byWhom}`;
    case "leader_changed":
      return `leader ${fact.polity}: ${fact.newLeader} (${fact.how})`;
    case "government_changed":
      return `government ${fact.polity}: ${fact.newSystem}`;
    case "economic_shift":
      return `economy ${fact.polity}: ${fact.direction} (${fact.driver})`;
    case "relationship_shift":
      return `relations ${fact.pair.join("~")} ${fact.delta > 0 ? "+" : ""}${fact.delta} (${fact.reason})`;
    case "arc_update":
      return `arc "${fact.title}": ${fact.status}`;
    case "commitment":
      return `commitment ${fact.from}->${fact.to}: ${fact.what} [${fact.status}]`;
    case "notable_event":
      return `notable: ${fact.headline}`;
    case "territory_change":
      return `territory ${fact.regionName || fact.regionId}: ${fact.from || "?"}->${fact.to}`;
    case "polity_change":
      return `polity ${fact.polity} changed: ${Object.keys(fact.changes).join(",")}`;
  }
};

/**
 * One compact line for a nation's standing disposition — shared by the
 * simulator's NATIONS block and the advisor's foreign-courts context.
 * Empty string when the sheet says nothing yet.
 */
export const psycheFragment = (sheet: PsycheSheet): string =>
  [
    sheet.temperament ? `psyche: ${sheet.temperament}` : "",
    sheet.ambitions.length > 0 ? `wants ${sheet.ambitions.join(", ")}` : "",
    sheet.grudges.length > 0 ? `grudges: ${sheet.grudges.join("; ")}` : "",
    sheet.opinionOfPlayer !== 0 || sheet.opinionReason
      ? `sees us ${signed(sheet.opinionOfPlayer)}${sheet.opinionReason ? ` (${sheet.opinionReason})` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** Render the always-present rollup section for the simulator prompt. */
export const renderRollup = (rollup: Rollup): string[] => {
  const lines: string[] = [];
  for (const [code, sheet] of Object.entries(rollup.nations)) {
    const parts = [
      sheet.leader ? `leader ${sheet.leader}` : "",
      sheet.government ? `gov ${sheet.government}` : "",
      sheet.econTrend ? `economy ${sheet.econTrend}` : "",
      sheet.atWarWith.length > 0 ? `at war with ${sheet.atWarWith.join(", ")}` : "",
      sheet.treaties.length > 0 ? `treaties: ${sheet.treaties.join("; ")}` : "",
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`- ${code}: ${parts.join(" · ")}`);
  }
  for (const [pair, relation] of Object.entries(rollup.relations)) {
    lines.push(`- relations ${pair}: ${relation.score} (${relation.lastReason})`);
  }
  for (const arc of rollup.openArcs) {
    lines.push(`- OPEN ARC "${arc.title}" (${arc.status}, turn ${arc.lastUpdatedDepth})`);
  }
  for (const commitment of rollup.openCommitments) {
    lines.push(
      `- OPEN COMMITMENT ${commitment.from}->${commitment.to}: ${commitment.what}${commitment.deadline ? ` by ${commitment.deadline}` : ""}`,
    );
  }
  return lines.length > 0 ? lines : ["(no standing facts yet)"];
};
