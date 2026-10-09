import { GazetteSchema, toLlmToolSchema, type Gazette, type GameEvent } from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { GameRow, NodeRow, SavePort } from "../ports.ts";
import { NotFoundError } from "../loom/tree.ts";

export interface GazetteDeps {
  store: SavePort;
  /** Utility/extractor role — one small call per gazette. */
  llm: LlmClient;
  binding: ModelBinding;
}

const GAZETTE_TOOL = toLlmToolSchema(
  "submit_gazette",
  "A period-styled front page for one turn: masthead, dateline, motto, and 1-8 articles drawn from the turn's events.",
  GazetteSchema,
);

const IMPORTANCE_RANK: Record<GameEvent["importance"], number> = { pivotal: 0, major: 1, minor: 2 };

/**
 * One turn's front page from its events, written in period voice by a single
 * model call — a chronicler's proclamation in a medieval game, a broadsheet
 * in an industrial one, a wire feed in a modern one. Falls back to a
 * deterministic events->articles mapping (never throws for a model reason):
 * no events at all skips the call entirely, and any model failure or invalid
 * payload returns the same fallback shape.
 */
export const buildGazette = async (deps: GazetteDeps, nodeId: string): Promise<Gazette> => {
  const { store } = deps;
  const node = store.getNode(nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${nodeId}`);

  // A front page is a historical artifact: once printed it stays printed
  // (and a billed call is never repeated). Only real model output is pinned —
  // fallbacks stay uncached so a later open can retry the model.
  const stored = store.getGazette(nodeId);
  if (stored) return stored;

  const game = store.getGame();
  const events = store.listEventsForNode(nodeId);
  const fallback = fallbackGazette(game, node, events);

  if (events.length === 0) return fallback;

  try {
    const request = buildGazetteRequest(store, game, node, events);
    const result = await deps.llm.stream(request, deps.binding).final();
    const parsed = GazetteSchema.safeParse(result.structured);
    if (!parsed.success) throw new Error(result.structuredError ?? "invalid gazette");
    store.setGazette(nodeId, parsed.data);
    return parsed.data;
  } catch (error) {
    console.warn(`Gazette generation failed (node ${nodeId}):`, error);
    return fallback;
  }
};

const fallbackGazette = (game: GameRow, node: NodeRow, events: readonly GameEvent[]): Gazette => ({
  masthead: `The ${game.title} Gazette`,
  dateline: node.gameDate,
  motto: "",
  articles:
    events.length > 0
      ? [...events]
          .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance])
          .slice(0, 8)
          .map((event) => ({
            headline: event.title,
            body: event.description,
            kind: event.kind,
          }))
      : [{ headline: "A quiet day", body: "Nothing of note reached the printing house.", kind: "dispatch" }],
});

const playerNationName = (store: SavePort, game: GameRow, node: NodeRow): string => {
  if (!node.worldBlobHash) return game.playerPolity;
  try {
    const world = store.getWorld(node.worldBlobHash);
    return world.polities[game.playerPolity]?.name || game.playerPolity;
  } catch {
    return game.playerPolity;
  }
};

/** Rough register hint from the game year; the model infers exact tone. */
const eraVoiceHint = (gameDate: string): string => {
  const year = Number(gameDate.slice(0, 4)) || 1936;
  if (year < 1500) return "a medieval chronicler's proclamation: ornate, formal, reads aloud in a hall";
  if (year < 1750) return "an early-modern printer's broadsheet: florid, moralizing, long compound sentences";
  if (year < 1920) return "a 19th-century newspaper: telegraphic, byline-heavy, penny-press urgency";
  if (year < 1990) return "a mid-20th-century wire-service newspaper: crisp, declarative, front-page gravity";
  if (year < 2035) return "a modern digital newsroom: punchy headlines, tight leads";
  return "a near-future wire/newsfeed: terse alerts, sensor-network and dispatch tone";
};

const buildGazetteRequest = (
  store: SavePort,
  game: GameRow,
  node: NodeRow,
  events: readonly GameEvent[],
): LlmRequest => {
  const nation = playerNationName(store, game, node);
  const ranked = [...events].sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);
  const eventLines = ranked
    .slice(0, 12)
    .map(
      (event, index) =>
        `${index + 1}. [${event.importance}/${event.kind}] ${event.title} — ${event.description || "(no further detail)"}`,
    )
    .join("\n");

  return {
    system: [
      {
        cacheable: true,
        text: `You are the editorial voice of "${game.title}", a grand-strategy chronicle. Write today's front page for ${nation} in ${eraVoiceHint(node.gameDate)}. The masthead should riff on the game's title as a period-appropriate publication name; the motto is one short era-appropriate line beneath it. The lead article (first in the list) must cover the most important event provided. Ground every article in the supplied events — do not invent new happenings. Write in the register you inferred; do not name or explain that register.`,
      },
    ],
    messages: [
      {
        role: "user",
        text: `Game date: ${node.gameDate}\nPlayer nation: ${nation}\n\nThis turn's events, most important first:\n${eventLines}`,
      },
    ],
    tool: GAZETTE_TOOL,
    taskLabel: "gazette",
  };
};
