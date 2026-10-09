import type { Rollup, TurnInput, WorldState } from "@pax/domain";
import { ERA_SPAN, TurnResultSchema, toLlmToolSchema } from "@pax/domain";
import type { LlmRequest, SystemBlock } from "@pax/providers";
import type { GameRow, NodeRow, SavePort } from "../ports.ts";
import { CORE_MODULES, DIFFICULTY_DIRECTIVES } from "./modules.ts";
import { factDigestLine, psycheFragment, renderRollup } from "../facts/digest.ts";

export const TURN_TOOL = toLlmToolSchema(
  "submit_turn_result",
  "The simulated turn: stop date, one-line summary, and 1-30 dated events with world impacts.",
  TurnResultSchema,
);

/** How many recent ancestor turns get their events included verbatim. */
const RECENT_TURNS = 6;

/**
 * Assemble the simulator request from the loom path. Stable modules first
 * (cacheable), then the volatile world/history/orders context as the user
 * message. Tiered fact digests replace the raw recent window in the
 * extraction phase; the section layout is already final.
 */
export const buildTurnRequest = (params: {
  store: SavePort;
  game: GameRow;
  parent: NodeRow;
  world: WorldState;
  input: TurnInput;
  signal?: AbortSignal;
}): LlmRequest => {
  const { store, game, parent, world, input } = params;

  const system: SystemBlock[] = CORE_MODULES.map((module) => ({
    text: module.text,
    cacheable: true,
  }));
  system.push({
    text:
      DIFFICULTY_DIRECTIVES[game.difficulty] ?? DIFFICULTY_DIRECTIVES.standard!,
  });
  if (world.simulationRules) {
    system.push({ text: `Scenario rules: ${world.simulationRules}` });
  }

  const path = store.pathToRoot(parent.id);
  const recentNodes = path.slice(-RECENT_TURNS);
  const olderNodes = path.slice(0, -RECENT_TURNS);
  const recentEvents = store
    .listEventsForNodes(recentNodes.map((node) => node.id))
    .map((event) => `- ${event.date}: ${event.title}${event.description ? ` — ${event.description}` : ""}`);

  // Tiered history: standing facts (rollup) are always present; the oldest
  // spans collapse to era chronicles; mid-term turns compress to one digest
  // line-group each; only recent turns verbatim. Each node appears in exactly
  // one tier, so a chronicled node drops out of the digest list.
  const rollup = store.getRollup(parent.id);
  const chronicle = renderEraChronicle(store, olderNodes);
  const digestLines = olderNodes
    .filter((node) => !chronicle.covered.has(node.id))
    .map((node) => {
      const facts = store.listFactsForNode(node.id);
      if (facts.length === 0) return "";
      return `- T${node.depth} (${node.gameDate}): ${facts.map(factDigestLine).join("; ")}`;
    })
    .filter(Boolean);

  const sections = [
    section("SITUATION", [
      `Player nation: ${polityLabel(world, game.playerPolity)}.`,
      `Current date: ${parent.gameDate}. Turn ${parent.depth + 1}.`,
      `Simulate ${input.jumpDays} days${input.stopPolicy === "nextNotable" ? ", stopping early at the next notable development" : ""}. stopDate must be after ${parent.gameDate} and within the span.`,
    ]),
    section("NATIONS", describeNations(world, rollup)),
    section("REGION VOCABULARY (regionId -> owner)", describeRegions(world)),
    section("FORCES", describeUnits(world)),
    world.markers.length > 0 ? section("STRUCTURES", describeMarkers(world)) : "",
    rollup ? section("STANDING FACTS (wars, treaties, arcs, commitments in force)", renderRollup(rollup)) : "",
    chronicle.lines.length > 0 ? section("ERA CHRONICLE (older history)", chronicle.lines) : "",
    digestLines.length > 0 ? section("EARLIER HISTORY (compressed fact digests)", digestLines) : "",
    section("RECENT EVENTS (context only — do not restate)", recentEvents.length > 0 ? recentEvents : ["(none)"]),
    section(
      "PLAYER ORDERS FOR THIS TURN",
      input.actions.length > 0
        ? input.actions.map((action) => `- ${action.title}: ${action.text || action.rawInput}`)
        : ["(no explicit orders — simulate the world's own momentum)"],
    ),
  ].filter(Boolean);

  return {
    system,
    messages: [{ role: "user", text: sections.join("\n\n") }],
    tool: TURN_TOOL,
    ...(params.signal ? { signal: params.signal } : {}),
    taskLabel: "simulateTurn",
  };
};

/**
 * The oldest tier: every complete ERA_SPAN-wide span lying entirely outside the
 * recent window that already has a stored summary. Store reads only — assembly
 * never generates (summaries are written by the post-turn extraction job), so a
 * span still awaiting its summary simply stays in the digest tier.
 */
const renderEraChronicle = (
  store: SavePort,
  olderNodes: readonly NodeRow[],
): { lines: string[]; covered: Set<string> } => {
  const byDepth = new Map(olderNodes.map((node) => [node.depth, node]));
  const lastDepth = olderNodes.at(-1)?.depth ?? -1;
  const lines: string[] = [];
  const covered = new Set<string>();

  for (let end = ERA_SPAN; end <= lastDepth; end += ERA_SPAN) {
    const start = end - ERA_SPAN + 1;
    const startNode = byDepth.get(start);
    const endNode = byDepth.get(end);
    if (!startNode || !endNode) continue;
    const era = store.getEraSummary(startNode.id, endNode.id);
    if (!era) continue;

    lines.push(`### ${era.title} (${era.startDate} → ${era.endDate})`, era.summary);
    if (era.openThreads.length > 0) {
      lines.push("Open threads:", ...era.openThreads.map((thread) => `- ${thread}`));
    }
    for (let depth = start; depth <= end; depth += 1) {
      const node = byDepth.get(depth);
      if (node) covered.add(node.id);
    }
  }
  return { lines, covered };
};

const section = (title: string, lines: readonly string[]): string =>
  `## ${title}\n${lines.join("\n")}`;

const polityLabel = (world: WorldState, code: string): string => {
  const polity = world.polities[code];
  return polity?.name ? `${polity.name} (${code})` : code;
};

const describeNations = (world: WorldState, rollup: Rollup | null): string[] => {
  const entries = Object.values(world.polities);
  if (entries.length === 0) return ["(no registered nations)"];
  return entries.map((polity) => {
    const sheet = rollup?.psyches[polity.code];
    const parts = [
      `${polity.name || polity.code} [${polity.code}]`,
      polity.tags.length > 0 ? `tags: ${polity.tags.join(", ")}` : "",
      polity.reputation !== null ? `reputation: ${polity.reputation}/100` : "",
      polity.note ? `note: ${polity.note}` : "",
      // What this nation remembers — the thread that makes decades cohere.
      sheet ? psycheFragment(sheet) : "",
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });
};

const describeRegions = (world: WorldState): string[] => {
  const entries = Object.entries(world.regionOwnership);
  if (entries.length === 0) return ["(no region overrides — country-level ownership applies)"];
  return entries.map(([regionId, owner]) => `- ${regionId} -> ${owner}`);
};

const describeUnits = (world: WorldState): string[] => {
  if (world.units.length === 0) return ["(no tracked units)"];
  return world.units.map(
    (unit) =>
      `- [${unit.id}] ${unit.name} (${unit.type}, ${unit.ownerCode}) strength ${unit.strength}, at ${unit.lat.toFixed(1)},${unit.lng.toFixed(1)}${unit.regionId ? ` in ${unit.regionId}` : ""}, ${unit.status}`,
  );
};

const describeMarkers = (world: WorldState): string[] =>
  world.markers.map(
    (marker) => `- [${marker.id}] ${marker.name} (${marker.kind}${marker.ownerCode ? `, ${marker.ownerCode}` : ""})`,
  );
