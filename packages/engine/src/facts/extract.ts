import {
  DERIVED_FACT_TYPES,
  FactBatchSchema,
  emptyRollup,
  newId,
  toLlmToolSchema,
  type Fact,
  type FactConfidence,
} from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { SavePort } from "../ports.ts";
import type { Emit } from "../loom/tree.ts";
import { deriveFacts } from "./derive.ts";
import { foldRollup } from "./rollup.ts";
import { updatePsyches } from "./psyche.ts";
import { maybeSummarizeEras } from "./summarize.ts";
import { maybeInitiateContact } from "./idleDiplomacy.ts";

export const FACTS_TOOL = toLlmToolSchema(
  "submit_facts",
  "Structured facts extracted from the turn's events: wars, treaties, leadership, economics, relationship shifts, ongoing arcs, commitments, and notable headlines.",
  FactBatchSchema,
);

export interface ExtractionDeps {
  store: SavePort;
  llm: LlmClient;
  binding: ModelBinding;
  emit: Emit;
}

/**
 * One ancestor whose extraction failed must not amnesia every descendant:
 * fold from the NEAREST ancestor that has a rollup, not straight from empty.
 */
const nearestAncestorRollup = (store: SavePort, parentId: string) => {
  const path = store.pathToRoot(parentId);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const rollup = store.getRollup(path[index]!.id);
    if (rollup) return rollup;
  }
  return emptyRollup();
};

/**
 * The post-turn extraction job: deterministic facts from impacts + semantic
 * facts from the (configurable) extractor model, folded into the node's
 * rollup. Node-keyed throughout, so regenerated siblings each get their own
 * ledger folded from the same parent — branching costs nothing.
 */
export const runExtraction = async (deps: ExtractionDeps, nodeId: string): Promise<void> => {
  const { store, llm, binding, emit } = deps;
  const node = store.getNode(nodeId);
  if (!node || node.status !== "complete" || !node.worldBlobHash) return;

  try {
    store.setExtractionStatus(nodeId, "pending");
    const events = store.listEventsForNode(nodeId);
    const derived = deriveFacts(events);
    const parentRollup = node.parentId ? nearestAncestorRollup(store, node.parentId) : emptyRollup();

    let extracted: Fact[] = [];
    if (events.length > 0) {
      const world = store.getWorld(node.worldBlobHash);
      const player = store.getGame().playerPolity;
      const playerName = world.polities[player]?.name || player;
      const request: LlmRequest = {
        system: [
          {
            cacheable: true,
            text: `You extract structured facts from strategy-game event narratives. Report only what the events state or clearly imply; use canonical polity codes from the catalog; reuse open arc ids instead of opening duplicates; do not report territory or polity-attribute changes (the engine derives those). Emit relationship_shift only for meaningful shifts. Prefer fewer, higher-signal facts.

Every fact also carries an intelligence grade in "confidence", written from the player nation's vantage — its court knows its own affairs far better than distant ones:
- "confirmed": the player's nation is a party to the fact, or it happened in an event the player's nation took part in or witnessed at close range (its neighbours, its wars, its treaties, its own soil).
- "reported": dealings among other powers that reach the player's court secondhand — a treaty between two foreign states, a distant war, a far-off leadership change.
- "rumored": the narration hedges — whispers, rumours, unconfirmed reports, "it is said", claims attributed to no one. Hedged phrasing outranks distance: a rumour about the player's own borders is still "rumored".
Grade every fact you emit.`,
          },
        ],
        messages: [
          {
            role: "user",
            text: [
              `Polity catalog: ${Object.values(world.polities)
                .map((polity) => `${polity.code}=${polity.name || polity.code}`)
                .join(", ")}`,
              `Player nation: ${player} (${playerName}) — grade confidence from ITS vantage.`,
              `Open arcs: ${
                parentRollup.openArcs.length > 0
                  ? parentRollup.openArcs.map((arc) => `${arc.arcId}: ${arc.title}`).join("; ")
                  : "(none)"
              }`,
              `Events:\n${events
                .map((event) => `- ${event.date}: ${event.title}${event.description ? ` — ${event.description}` : ""}`)
                .join("\n")}`,
            ].join("\n\n"),
          },
        ],
        tool: FACTS_TOOL,
        taskLabel: "extractFacts",
      };

      const stream = llm.stream(request, binding);
      const result = await stream.final();
      const batch = FactBatchSchema.safeParse(result.structured);
      if (batch.success) {
        extracted = batch.data.facts
          .filter((fact) => !DERIVED_FACT_TYPES.has(fact.type))
          .map((fact) =>
            fact.type === "arc_update" && !fact.arcId ? { ...fact, arcId: newId() } : fact,
          )
          .map((fact) => gradeFact(fact, player));
      }
    }

    // Before the transaction: the psyche pass is a model call, and the fold
    // (a structuredClone of the parent) would otherwise carry the parent's
    // psyches through untouched — the merged map wins.
    const facts = [...derived, ...extracted];
    const psyches = await updatePsyches(deps, {
      node,
      parentPsyches: parentRollup.psyches,
      facts,
      events,
    });

    store.transaction(() => {
      // Derived facts are stored ungraded on purpose: an absent grade reads as
      // "confirmed", and what the engine computed from applied impacts is the
      // one thing the player's court cannot be wrong about.
      store.insertFacts(nodeId, derived, "derived");
      if (extracted.length > 0) store.insertFacts(nodeId, extracted, "extracted", derived.length);
      store.setRollup(nodeId, { ...foldRollup(parentRollup, facts, node.depth), psyches });
      store.setExtractionStatus(nodeId, "done");
    });
    emit({ type: "facts.updated", nodeId });

    // Era summarization is a separate, best-effort concern: its failures must
    // never mark extraction failed (it runs long games' compaction, not facts).
    try {
      const written = await maybeSummarizeEras(deps, nodeId);
      // New summaries arrive after the facts signal above — fire again so an
      // open chronicle reader learns the era just settled.
      if (written > 0) emit({ type: "facts.updated", nodeId });
    } catch (eraError) {
      console.warn(`Era summarization failed for node ${nodeId}:`, eraError);
    }

    // Last, and just as best-effort: this turn may have given some nation a
    // reason to call on the player unprompted. It swallows its own failures;
    // the guard here is belt-and-braces so a knock at the door can never mark
    // a completed extraction failed.
    try {
      await maybeInitiateContact(deps, nodeId);
    } catch (contactError) {
      console.warn(`Idle diplomacy failed for node ${nodeId}:`, contactError);
    }
  } catch (error) {
    // The status write can itself fail (e.g. DB closed mid-teardown) — the
    // queue's .catch is the last line of defense, never an escaped rejection.
    try {
      store.setExtractionStatus(nodeId, "failed");
    } catch {
      // ignore: the save is gone or closing
    }
    console.warn(`Fact extraction failed for node ${nodeId}:`, error);
  }
};

/**
 * A model that ignored the grading instructions (or an older one that never
 * saw them) must not silently promote foreign hearsay to gospel: fall back to
 * the vantage rule — the player's own affairs are confirmed, the rest arrives
 * secondhand. An explicit grade from the extractor always wins.
 */
const gradeFact = (fact: Fact, player: string): Fact => {
  if (fact.confidence) return fact;
  const confidence: FactConfidence = factPolityCodes(fact).includes(player)
    ? "confirmed"
    : "reported";
  return { ...fact, confidence };
};

/**
 * Twin of the private helper in psyche.ts (which asks the same question for a
 * different purpose). Kept local rather than shared so the two can drift: this
 * one answers "is the player a party to it", not "who acted this turn".
 */
const factPolityCodes = (fact: Fact): string[] => {
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
