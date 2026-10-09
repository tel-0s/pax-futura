import {
  PsycheSheetSchema,
  PsycheUpdatesSchema,
  toLlmToolSchema,
  type Fact,
  type GameEvent,
  type PsycheSheet,
  type Rollup,
  type WorldState,
} from "@pax/domain";
import type { LlmRequest } from "@pax/providers";
import type { ExtractionDeps } from "./extract.ts";
import type { NodeRow } from "../ports.ts";
import { factDigestLine } from "./digest.ts";

export const PSYCHE_TOOL = toLlmToolSchema(
  "submit_psyche_updates",
  "Updated leader psyche sheets for the nations whose disposition actually moved this turn. Nations whose disposition is unchanged must be omitted entirely.",
  PsycheUpdatesSchema,
);

/**
 * The psyche pass: evolve per-nation leader profiles (temperament, ambitions,
 * grudges, opinion of the player) from this turn's facts and events, so
 * nations remember across decades. Runs inside extraction after the fact
 * fold; returns the psyches map to store on the node's rollup.
 *
 * Costs nothing on turns where no foreign nation acted, and degrades to an
 * exact passthrough of the parent's psyches on any failure — a lost update is
 * always preferable to a lost memory.
 */
export const updatePsyches = async (
  deps: ExtractionDeps,
  params: {
    node: NodeRow;
    parentPsyches: Rollup["psyches"];
    facts: readonly Fact[];
    events: readonly GameEvent[];
  },
): Promise<Rollup["psyches"]> => {
  const { node, parentPsyches, facts, events } = params;
  try {
    if (!node.worldBlobHash) return parentPsyches;
    const world = deps.store.getWorld(node.worldBlobHash);
    const player = deps.store.getGame().playerPolity;

    const foreign = involvedForeignCodes({ world, player, facts, events });
    // A turn nobody else took part in cannot have moved anyone's disposition.
    if (foreign.length === 0) return parentPsyches;

    const request = buildPsycheRequest({ node, world, player, parentPsyches, facts, events, foreign });
    const result = await deps.llm.stream(request, deps.binding).final();
    return mergeUpdates(parentPsyches, result.structured, world, player);
  } catch (error) {
    console.warn(`Psyche update failed for node ${node.id}:`, error);
    return parentPsyches;
  }
};

/** Every polity other than the player that this turn's record actually names. */
const involvedForeignCodes = (params: {
  world: WorldState;
  player: string;
  facts: readonly Fact[];
  events: readonly GameEvent[];
}): string[] => {
  const { world, player, facts, events } = params;
  const involved = new Set<string>();
  for (const fact of facts) for (const code of factPolities(fact)) involved.add(code);
  for (const event of events) for (const code of eventPolities(event)) involved.add(code);
  involved.delete(player);
  return [...involved].filter((code) => Object.hasOwn(world.polities, code));
};

const factPolities = (fact: Fact): string[] => {
  switch (fact.type) {
    case "war_started":
      return [fact.attacker, fact.defender];
    case "war_ended":
      return fact.victor ? [...fact.parties, fact.victor] : [...fact.parties];
    case "treaty_signed":
      return [...fact.parties];
    case "treaty_broken":
      return [...fact.parties, fact.byWhom];
    case "relationship_shift":
      return [...fact.pair];
    case "commitment":
      return [fact.from, fact.to];
    case "notable_event":
      return [...fact.polities];
    case "leader_changed":
    case "government_changed":
    case "economic_shift":
    case "polity_change":
      return [fact.polity];
    case "territory_change":
      return [fact.from, fact.to].filter(Boolean);
    case "arc_update":
      return [];
  }
};

const eventPolities = (event: GameEvent): string[] =>
  [
    ...event.impacts.regionTransfers.flatMap((transfer) => [transfer.fromCode, transfer.toCode ?? ""]),
    ...event.impacts.polityChanges.map((change) => change.code),
    ...event.impacts.unitOps.flatMap((op) => (op.op === "spawn" ? [op.unit.ownerCode] : [])),
    ...event.impacts.markerOps.flatMap((op) => (op.op === "build" ? [op.marker.ownerCode] : [])),
    ...event.impacts.createdChats.flatMap((chat) => chat.participants),
  ].filter(Boolean);

const buildPsycheRequest = (params: {
  node: NodeRow;
  world: WorldState;
  player: string;
  parentPsyches: Rollup["psyches"];
  facts: readonly Fact[];
  events: readonly GameEvent[];
  foreign: readonly string[];
}): LlmRequest => {
  const { node, world, player, parentPsyches, facts, events, foreign } = params;
  const playerName = world.polities[player]?.name || player;

  const sections = [
    `Polity catalog: ${Object.values(world.polities)
      .map((polity) => `${polity.code}=${polity.name || polity.code}`)
      .join(", ")}`,
    `Player nation: ${player} (${playerName}). "opinionOfPlayer" is each OTHER nation's disposition toward ${player}; never write a sheet for ${player} itself.`,
    `Nations that acted this turn: ${foreign.join(", ")}`,
    `Current psyches (unchanged nations must be omitted from your answer): ${JSON.stringify(parentPsyches)}`,
    `This turn (${node.gameDate}) facts:\n${
      facts.length > 0 ? facts.map((fact) => `- ${factDigestLine(fact)}`).join("\n") : "- (none recorded)"
    }`,
    `Events:\n${
      events.length > 0
        ? events
            .map((event) => `- ${event.date}: ${event.title}${event.description ? ` — ${event.description}` : ""}`)
            .join("\n")
        : "- (none)"
    }`,
  ];

  return {
    system: [
      {
        cacheable: true,
        text: `You maintain the standing psychological profile of each nation's leadership in a grand-strategy simulation: temperament, up to three live ambitions, up to three standing grudges, and their disposition toward the player's nation (-3 hostile to +3 warm) with a one-clause reason.

Return an updated sheet ONLY for a nation whose disposition genuinely moved this turn — a grudge gained or resolved, an ambition adopted, abandoned or achieved, a real shift in how they see the player. Carry every unchanged nation forward by OMITTING it; omission is the default and most turns should update at most one or two nations. A sheet you do return replaces the old one wholly, so restate the parts that still hold.

Sheets are terse phrases, never prose: "cautious, legalistic" not a paragraph. Grudges and ambitions cite their origin turn or date when it is known, e.g. "FRA broke the grain pact (1938-04)". Use canonical polity codes from the catalog. Ground every change in the facts and events given; invent nothing.`,
      },
    ],
    messages: [{ role: "user", text: sections.join("\n\n") }],
    tool: PSYCHE_TOOL,
    taskLabel: "updatePsyches",
  };
};

/**
 * Parent map + this turn's updates. Entry-by-entry so one malformed sheet
 * costs only itself, and unknown codes never enter the world's memory.
 */
const mergeUpdates = (
  parentPsyches: Rollup["psyches"],
  structured: unknown,
  world: WorldState,
  player: string,
): Rollup["psyches"] => {
  const updates = (structured as { updates?: unknown } | null | undefined)?.updates;
  if (!Array.isArray(updates)) return parentPsyches;

  const merged: Record<string, PsycheSheet> = { ...parentPsyches };
  for (const entry of updates) {
    if (!entry || typeof entry !== "object") continue;
    const { code, sheet } = entry as { code?: unknown; sheet?: unknown };
    // The player's own polity never gets a psyche: "opinionOfPlayer" about
    // yourself is nonsense the simulator would faithfully echo back.
    if (typeof code !== "string" || code === player || !Object.hasOwn(world.polities, code)) continue;
    const parsed = PsycheSheetSchema.safeParse(clampSheet(sheet));
    if (!parsed.success) continue;
    merged[code] = parsed.data;
  }
  return merged;
};

/** Trim over-long lists to the schema's bound rather than losing the sheet. */
const clampSheet = (sheet: unknown): unknown => {
  if (!sheet || typeof sheet !== "object") return sheet;
  const record = sheet as Record<string, unknown>;
  return {
    ...record,
    ...(Array.isArray(record.ambitions) ? { ambitions: record.ambitions.slice(0, 3) } : {}),
    ...(Array.isArray(record.grudges) ? { grudges: record.grudges.slice(0, 3) } : {}),
  };
};
