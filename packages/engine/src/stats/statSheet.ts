import {
  StatSheetEstimateSchema,
  emptyRollup,
  toLlmToolSchema,
  type StatSheet,
} from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { SavePort } from "../ports.ts";
import { ConflictError, NotFoundError } from "../loom/tree.ts";
import { factDigestLine, renderRollup } from "../facts/digest.ts";

export const STAT_SHEET_TOOL = toLlmToolSchema(
  "submit_stat_sheet",
  "Grounded 0-100 scores (stability, economy, military, diplomacy), a short assessment, and fact-traceable highlights for one nation.",
  StatSheetEstimateSchema,
);

export interface StatDeps {
  store: SavePort;
  llm: LlmClient;
  binding: ModelBinding;
}

/**
 * A nation's stat sheet at a node. Hard stats are computed exactly from the
 * snapshot; soft scores are model-estimated but anchored: the prompt carries
 * the parent node's sheet plus this turn's facts, and asks for adjustments
 * the facts justify — not fresh invention. Cached per (node, polity);
 * regenerated siblings naturally get their own sheets.
 */
export const getOrBuildStatSheet = async (
  deps: StatDeps,
  params: { nodeId: string; polity: string; force?: boolean },
): Promise<StatSheet> => {
  const { store, llm, binding } = deps;
  if (!params.force) {
    const cached = store.getStatSheet(params.nodeId, params.polity);
    if (cached) return cached;
  }

  const node = store.getNode(params.nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${params.nodeId}`);
  if (node.status !== "complete" || !node.worldBlobHash) {
    throw new ConflictError("Stat sheets need a completed node");
  }
  const world = store.getWorld(node.worldBlobHash);
  const polity = world.polities[params.polity];
  if (!polity) throw new NotFoundError(`Unknown polity: ${params.polity}`);

  const rollup =
    store.getRollup(params.nodeId) ??
    (node.parentId ? store.getRollup(node.parentId) : null) ??
    emptyRollup();
  const sheet = rollup.nations[params.polity];
  const hard = {
    regionsOwned: Object.values(world.regionOwnership).filter((owner) => owner === params.polity)
      .length,
    unitCount: world.units.filter((unit) => unit.ownerCode === params.polity).length,
    totalStrength: world.units
      .filter((unit) => unit.ownerCode === params.polity)
      .reduce((sum, unit) => sum + unit.strength, 0),
    reputation: polity.reputation,
    atWarWith: sheet?.atWarWith ?? [],
    treaties: sheet?.treaties ?? [],
  };

  const parentSheet = node.parentId ? store.getStatSheet(node.parentId, params.polity) : null;
  const nodeFacts = store.listFactsForNode(params.nodeId);
  const nodeEvents = store.listEventsForNode(params.nodeId);

  const request: LlmRequest = {
    system: [
      {
        cacheable: true,
        text: `You assess a nation's standing in a grand-strategy simulation. Score stability, economy, military, diplomacy, and security 0-100 (security = safety from external coercion or attack: threats, wars, hostile neighbors, protective alliances). Also estimate macro-economics: gdp with an era-appropriate gdpUnit (e.g. "USD billions" for modern eras, a notional output unit for pre-modern), growthPct, and inflationPct. Every score, figure, and highlight must be grounded in the provided data — do not invent developments. ${parentSheet ? "Previous scores and economic figures are given: adjust them only as far as this turn's facts justify (economies move slowly — keep the same gdpUnit and change gdp by plausible increments); unchanged areas keep their values." : "No previous sheet exists: derive baseline scores and era-plausible economic figures from the standing facts and measured position."}`,
      },
    ],
    messages: [
      {
        role: "user",
        text: [
          `Nation: ${polity.name || polity.code} [${polity.code}]${polity.tags.length > 0 ? ` — tags: ${polity.tags.join(", ")}` : ""}`,
          `Date: ${node.gameDate}`,
          `Measured position: ${hard.regionsOwned} region overrides, ${hard.unitCount} units (total strength ${hard.totalStrength}), reputation ${hard.reputation ?? "unset"}, at war with [${hard.atWarWith.join(", ") || "nobody"}], treaties [${hard.treaties.join("; ") || "none"}]`,
          parentSheet
            ? `Previous scores (last turn): stability ${parentSheet.stability}, economy ${parentSheet.economy}, military ${parentSheet.military}, diplomacy ${parentSheet.diplomacy}, security ${parentSheet.security}. Previous economics: gdp ${parentSheet.economics.gdp} ${parentSheet.economics.gdpUnit}, growth ${parentSheet.economics.growthPct}%, inflation ${parentSheet.economics.inflationPct}%.`
            : "",
          `Standing facts:\n${renderRollup(rollup).join("\n")}`,
          nodeFacts.length > 0
            ? `This turn's facts:\n${nodeFacts.map((fact) => `- ${factDigestLine(fact)}`).join("\n")}`
            : "",
          nodeEvents.length > 0
            ? `This turn's events:\n${nodeEvents.map((event) => `- ${event.title}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    tool: STAT_SHEET_TOOL,
    taskLabel: "statSheet",
  };

  const result = await llm.stream(request, binding).final();
  const estimate = StatSheetEstimateSchema.safeParse(result.structured);
  if (!estimate.success) {
    throw new ConflictError(
      `Stat sheet estimation failed: ${result.structuredError ?? estimate.error.issues[0]?.message}`,
    );
  }

  const statSheet: StatSheet = {
    ...estimate.data,
    polity: params.polity,
    nodeId: params.nodeId,
    hard,
  };
  store.setStatSheet(statSheet);
  return statSheet;
};
